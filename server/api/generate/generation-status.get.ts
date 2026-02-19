import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generations, mediaItems } from '../../database/schema'
import { checkRunPodJob } from '../../utils/ai'
import { uploadImageToR2, useMediaBucket } from '../../utils/r2'

/**
 * Generation status endpoint.
 * Returns current DB state for a generation and all its items.
 *
 * ACTIVE POLLING: If any items are still processing, actively checks RunPod
 * for completion and updates the DB in-place. This eliminates the lag between
 * RunPod completing a job and the UI showing the result.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const query = getQuery(event)
  const generationId = query.id as string

  if (!generationId) {
    throw createError({ statusCode: 400, message: 'Generation ID is required' })
  }

  const db = useDatabase()

  const gen = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1)
  if (!gen[0]) {
    throw createError({ statusCode: 404, message: 'Generation not found' })
  }

  const items = await db.select().from(mediaItems).where(eq(mediaItems.generationId, generationId))

  // ── Active RunPod check for processing items ──────────────────────
  const processingItems = items.filter(i => i.status === 'processing' && i.runpodJobId)

  if (processingItems.length > 0) {
    const mediaBucket = useMediaBucket(event)

    for (const item of processingItems) {
      try {
        const apiUrl = item.metadata
          ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return undefined } })()
          : undefined

        const result = await checkRunPodJob(item.runpodJobId!, apiUrl)
        if (!result) continue // still running

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

          // Update in-memory for the response
          item.url = url
          item.status = 'complete'
        } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
          const error = result.error || `RunPod job ${result.status.toLowerCase()}`
          await db.update(mediaItems)
            .set({ status: 'failed', error })
            .where(eq(mediaItems.id, item.id))

          item.status = 'failed'
          item.error = error
        }
      } catch (e: any) {
        // Don't fail the whole request if one check fails
        console.warn(`[Status] Check failed for ${item.id.slice(0, 8)}:`, e.message)
      }
    }
  }

  const transformedItems = items.map((item) => ({
    ...item,
    url: item.url?.startsWith('data:')
      ? `/api/media/${item.id}`
      : item.url,
  }))

  return {
    generation: gen[0],
    items: transformedItems,
  }
})
