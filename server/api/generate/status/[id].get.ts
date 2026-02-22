import { eq } from 'drizzle-orm'
import { requireAuth } from '../../../utils/auth'
import { mediaItems, generations } from '../../../database/schema'
import { checkRunPodJob } from '../../../utils/ai'
import { uploadImageToR2, useMediaBucket } from '../../../utils/r2'

/**
 * Status endpoint for a single media item.
 *
 * ACTIVE POLLING: If the item is still processing, actively checks RunPod
 * for completion and updates the DB before responding.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const itemId = getRouterParam(event, 'id')

  if (!itemId) {
    throw createError({ statusCode: 400, message: 'Item ID is required' })
  }

  const db = useDatabase()
  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)).limit(1)

  if (!item) {
    throw createError({ statusCode: 404, message: 'Media item not found' })
  }

  // ── Active RunPod check for processing items ──────────────────────
  if (item.status === 'processing' && item.runpodJobId) {
    try {
      const apiUrl = item.metadata
        ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return undefined } })()
        : undefined

      const result = await checkRunPodJob(item.runpodJobId, apiUrl)

      if (result) {
        if (result.status === 'COMPLETED' && result.output?.output?.data) {
          // Guard against race: re-check item is still processing before writing
          const [fresh] = await db.select({ status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, item.id)).limit(1)
          if (fresh?.status === 'processing') {
            const base64Data = result.output.output.data
            const isVideo = item.type === 'video'
            const mediaBucket = useMediaBucket(event)

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
          }
        } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
          const error = result.error || `RunPod job ${result.status.toLowerCase()}`
          await db.update(mediaItems)
            .set({ status: 'failed', error })
            .where(eq(mediaItems.id, item.id))

          item.status = 'failed'
          item.error = error
        }
      }
    } catch (e: any) {
      console.warn(`[Status] Check failed for ${item.id.slice(0, 8)}:`, e.message)
    }
  }

  // Transform R2 paths for serving
  const url = item.url?.startsWith('data:') ? `/api/media/${item.id}` : item.url

  return {
    item: {
      id: item.id,
      type: item.type,
      url,
      status: item.status,
      parentId: item.parentId,
      error: item.error,
    },
  }
})
