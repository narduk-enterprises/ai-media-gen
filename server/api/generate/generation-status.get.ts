import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { checkRunPodJob } from '../../utils/ai'
import { useMediaBucket, uploadImageToR2 } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

const GIVE_UP_MS = 10 * 60 * 1000 // 10 min — mark items without a job ID as failed

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
  const pending = items.filter(i => i.status === 'processing')

  if (pending.length > 0) {
    const mediaBucket = useMediaBucket(event)
    const now = Date.now()

    // Check RunPod for every processing item — this is the sole driver of
    // completion. No background work exists; each frontend poll advances state.
    for (const item of pending) {
      if (item.runpodJobId) {
        try {
          const result = await checkRunPodJob(item.runpodJobId)
          if (!result) continue // still running on RunPod

          if (result.status === 'COMPLETED' && result.output?.output?.data) {
            let url: string
            if (mediaBucket) {
              url = await uploadImageToR2(mediaBucket, item.id, result.output.output.data)
            } else {
              url = `data:image/png;base64,${result.output.output.data}`
            }
            await db.update(mediaItems)
              .set({ url, status: 'complete' })
              .where(eq(mediaItems.id, item.id))
            item.url = url
            item.status = 'complete'
            console.log(`[Status] ✅ ${item.id.slice(0, 8)} complete`)
          } else {
            const error = result.error || `RunPod job ${result.status.toLowerCase()}`
            await db.update(mediaItems)
              .set({ status: 'failed', error })
              .where(eq(mediaItems.id, item.id))
            item.status = 'failed'
            item.error = error
          }
        } catch {
          // RunPod API hiccup — leave as processing, next poll will retry
        }
      } else if (item.createdAt && now - new Date(item.createdAt).getTime() > GIVE_UP_MS) {
        await db.update(mediaItems)
          .set({ status: 'failed', error: 'Generation timed out — no job ID' })
          .where(eq(mediaItems.id, item.id))
        item.status = 'failed'
        item.error = 'Generation timed out — no job ID'
      }
    }

    // Update generation status when all items are resolved
    if (gen[0].status === 'processing') {
      const allResolved = items.every(i => i.status === 'complete' || i.status === 'failed')
      if (allResolved) {
        const allFailed = items.every(i => i.status === 'failed')
        const anyFailed = items.some(i => i.status === 'failed')
        const status = allFailed ? 'failed' : anyFailed ? 'partial' : 'complete'
        await db.update(generations)
          .set({ status })
          .where(eq(generations.id, generationId))
        gen[0].status = status
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
