/**
 * POST /api/generate/webhook
 *
 * Webhook endpoint called by pod_server.py when a job completes.
 * Enables instant gallery updates instead of waiting for cron polling.
 *
 * Uses shared completeMediaItem() for all completion logic.
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'
import { useMediaBucket } from '../../utils/r2'
import { completeMediaItem } from '../../utils/completeItem'

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

  // Build a RunPodResult-compatible object from the webhook payload
  const result = {
    status,
    output: data ? { output: { data } } : undefined,
    error: error || undefined,
  }

  const outcome = await completeMediaItem(db, mediaBucket, item.id, result)

  if (outcome === 'already_resolved') {
    return { ok: true, reason: 'already_resolved' }
  }

  console.log(`[Webhook] ${outcome === 'completed' ? '✅' : '❌'} ${item.id.slice(0, 8)} via callback`)
  return { ok: true, itemId: item.id, outcome }
})
