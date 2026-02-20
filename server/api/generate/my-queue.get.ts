/**
 * GET /api/generate/my-queue
 *
 * Single unified endpoint returning all active queue items for the current user.
 * Replaces per-generation polling — one request gets everything.
 *
 * Also does inline RunPod status checks for processing items so the client
 * gets the freshest possible data with minimal requests.
 */
import { eq, and, isNull, desc, or, inArray } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generations, mediaItems } from '../../database/schema'
import { checkRunPodJob } from '../../utils/ai'
import { uploadImageToR2, useMediaBucket } from '../../utils/r2'
import { updateGenerationStatus } from '../../utils/queueProcessor'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()

  // Get all non-dismissed items for this user (join through generations)
  const userGenerations = await db.select({ id: generations.id })
    .from(generations)
    .where(eq(generations.userId, user.id))

  if (userGenerations.length === 0) {
    return { items: [], stats: { queued: 0, processing: 0, complete: 0, failed: 0 } }
  }

  const genIds = userGenerations.map(g => g.id)

  // Fetch all non-dismissed items across all user's generations
  const items = await db.select().from(mediaItems)
    .where(and(
      inArray(mediaItems.generationId, genIds),
      isNull(mediaItems.dismissedAt),
    ))
    .orderBy(desc(mediaItems.createdAt))
    .limit(100) // cap to prevent huge payloads

  // ── Active RunPod check for processing items ──────────────────────
  const processingItems = items.filter(i => i.status === 'processing' && i.runpodJobId)

  if (processingItems.length > 0) {
    const mediaBucket = useMediaBucket(event)

    // Check up to 10 processing items inline (don't hold the request too long)
    const toCheck = processingItems.slice(0, 10)

    await Promise.allSettled(toCheck.map(async (item) => {
      try {
        const apiUrl = item.metadata
          ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return undefined } })()
          : undefined

        const result = await checkRunPodJob(item.runpodJobId!, apiUrl)
        if (!result) return // still running

        if (result.status === 'COMPLETED' && result.output?.output?.data) {
          const base64Data = result.output.output.data
          const isVideo = item.type === 'video'

          let url: string
          if (mediaBucket) {
            url = await uploadImageToR2(mediaBucket, item.id, base64Data, isVideo ? 'video/mp4' : 'image/png')
          } else {
            const mime = isVideo ? 'video/mp4' : 'image/png'
            url = `data:${mime};base64,${base64Data}`
          }

          await db.update(mediaItems)
            .set({ url, status: 'complete' })
            .where(eq(mediaItems.id, item.id))

          item.url = url
          item.status = 'complete'
          await updateGenerationStatus(db, item.generationId)
        } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
          const error = result.error || `RunPod job ${result.status.toLowerCase()}`
          await db.update(mediaItems)
            .set({ status: 'failed', error })
            .where(eq(mediaItems.id, item.id))

          item.status = 'failed'
          item.error = error
          await updateGenerationStatus(db, item.generationId)
        }
      } catch (e: any) {
        console.warn(`[Queue] Check failed for ${item.id.slice(0, 8)}:`, e.message)
      }
    }))
  }

  // Build stats
  let queued = 0, processing = 0, complete = 0, failed = 0
  for (const item of items) {
    if (item.status === 'queued') queued++
    else if (item.status === 'processing') processing++
    else if (item.status === 'complete') complete++
    else if (item.status === 'failed' || item.status === 'cancelled') failed++
  }

  // Transform items for response
  const transformedItems = items.map(item => ({
    id: item.id,
    generationId: item.generationId,
    type: item.type,
    prompt: item.prompt || '',
    status: item.status,
    url: item.url?.startsWith('data:') ? `/api/media/${item.id}` : item.url,
    parentId: item.parentId,
    error: item.error,
    createdAt: item.createdAt,
  }))

  return {
    items: transformedItems,
    stats: { queued, processing, complete, failed },
  }
})
