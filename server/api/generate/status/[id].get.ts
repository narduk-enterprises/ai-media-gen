import { eq } from 'drizzle-orm'
import { requireAuth } from '../../../utils/auth'
import { checkRunPodJob } from '../../../utils/ai'
import { useMediaBucket, uploadImageToR2 } from '../../../utils/r2'
import { mediaItems, generations } from '../../../database/schema'

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

  // Drive completion: check RunPod for processing items on every poll
  if (item.status === 'processing' && item.runpodJobId) {
    const itemApiUrl = item.metadata ? JSON.parse(item.metadata).apiUrl : undefined
    try {
      const result = await checkRunPodJob(item.runpodJobId, itemApiUrl)
      if (result?.status === 'COMPLETED' && result.output?.output?.data) {
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

        await db.update(mediaItems).set({ url, status: 'complete' }).where(eq(mediaItems.id, item.id))
        item.url = url
        item.status = 'complete'
        console.log(`[Status] ✅ ${item.id.slice(0, 8)} complete (${item.type})`)

        // Update parent generation
        if (item.generationId) {
          const siblings = await db.select().from(mediaItems).where(eq(mediaItems.generationId, item.generationId))
          if (siblings.every(s => s.status === 'complete' || s.status === 'failed')) {
            const allFailed = siblings.every(s => s.status === 'failed')
            const anyFailed = siblings.some(s => s.status === 'failed')
            await db.update(generations)
              .set({ status: allFailed ? 'failed' : anyFailed ? 'partial' : 'complete' })
              .where(eq(generations.id, item.generationId))
          }
        }
      } else if (result?.status === 'FAILED' || result?.status === 'CANCELLED' || result?.status === 'TIMED_OUT') {
        const error = result.error || `RunPod job ${result.status.toLowerCase()}`
        await db.update(mediaItems).set({ status: 'failed', error }).where(eq(mediaItems.id, item.id))
        item.status = 'failed'
        item.error = error
      }
    } catch {
      // RunPod API hiccup — leave as processing, next poll will retry
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
