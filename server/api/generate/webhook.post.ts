/**
 * POST /api/generate/webhook
 *
 * Webhook endpoint called by pod_server.py when a job completes.
 * This enables instant gallery updates instead of waiting for cron polling.
 *
 * The pod sends: { jobId, status, data?, error? }
 * We look up the media item by runpodJobId, upload to R2, update DB.
 *
 * Security: Validates a shared secret token to prevent unauthorized calls.
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'
import { uploadImageToR2 } from '../../utils/r2'
import { updateGenerationStatus } from '../../utils/queueProcessor'

export default defineEventHandler(async (event) => {
  // ── Auth: check webhook secret ──
  const config = useRuntimeConfig()
  const webhookSecret = config.webhookSecret || ''
  const authHeader = getHeader(event, 'authorization') || ''
  const token = authHeader.replace('Bearer ', '')

  if (!webhookSecret || token !== webhookSecret) {
    console.warn('[Webhook] ❌ Unauthorized callback attempt')
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { jobId, status, data, error } = body

  if (!jobId || !status) {
    throw createError({ statusCode: 400, message: 'Missing jobId or status' })
  }

  const db = useDatabase()
  const mediaBucket = useMediaBucket(event)

  // Find the media item by runpodJobId
  const [item] = await db.select()
    .from(mediaItems)
    .where(eq(mediaItems.runpodJobId, jobId))
    .limit(1)

  if (!item) {
    console.warn(`[Webhook] ⚠️ No media item found for job ${jobId}`)
    return { ok: false, reason: 'item_not_found' }
  }

  // Already completed — skip
  if (item.status === 'complete' || item.status === 'failed') {
    return { ok: true, reason: 'already_resolved' }
  }

  if (status === 'COMPLETED' && data) {
    try {
      const isVideo = item.type === 'video'
      let url: string

      if (mediaBucket) {
        url = await uploadImageToR2(mediaBucket, item.id, data, isVideo ? 'video/mp4' : 'image/png')
      } else {
        const mime = isVideo ? 'video/mp4' : 'image/png'
        url = `data:${mime};base64,${data}`
      }

      await db.update(mediaItems)
        .set({ url, status: 'complete' })
        .where(eq(mediaItems.id, item.id))
      await updateGenerationStatus(db, item.generationId)

      console.log(`[Webhook] ✅ Completed ${item.id.slice(0, 8)} (${item.type}) via callback`)
      return { ok: true, itemId: item.id }
    } catch (e: any) {
      console.error(`[Webhook] ❌ Upload failed for ${item.id.slice(0, 8)}:`, e.message)
      return { ok: false, reason: 'upload_failed' }
    }
  } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
    const errMsg = error || `Job ${status.toLowerCase()}`
    await db.update(mediaItems)
      .set({ status: 'failed', error: errMsg })
      .where(eq(mediaItems.id, item.id))
    await updateGenerationStatus(db, item.generationId)

    console.log(`[Webhook] ❌ Failed ${item.id.slice(0, 8)}: ${errMsg}`)
    return { ok: true, itemId: item.id }
  }

  return { ok: false, reason: 'unhandled_status' }
})
