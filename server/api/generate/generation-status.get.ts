import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { checkRunPodJob } from '../../utils/ai'
import { useMediaBucket, uploadImageToR2 } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

const STALE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

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

  // Try to recover stale items that have a RunPod job ID before giving up
  const now = Date.now()
  const mediaBucket = useMediaBucket(event)

  for (const item of items) {
    if (item.status !== 'processing' || !item.createdAt) continue
    const age = now - new Date(item.createdAt).getTime()
    if (age <= STALE_THRESHOLD_MS) continue

    // Item is stale — try RunPod recovery if we have a job ID
    if (item.runpodJobId) {
      try {
        const result = await checkRunPodJob(item.runpodJobId)
        if (result?.status === 'COMPLETED' && result.output?.output?.data) {
          const base64Data = result.output.output.data
          let url: string
          if (mediaBucket) {
            url = await uploadImageToR2(mediaBucket, item.id, base64Data)
          } else {
            url = `data:image/png;base64,${base64Data}`
          }
          await db.update(mediaItems)
            .set({ url, status: 'complete' })
            .where(eq(mediaItems.id, item.id))
          item.url = url
          item.status = 'complete'
          console.log(`[Recovery] ✅ Recovered item ${item.id.slice(0, 8)} from RunPod job ${item.runpodJobId}`)
          continue
        }
        if (result?.status === 'FAILED' || result?.status === 'CANCELLED' || result?.status === 'TIMED_OUT') {
          const error = `RunPod job ${result.status.toLowerCase()}: ${result.error || 'Unknown error'}`
          await db.update(mediaItems)
            .set({ status: 'failed', error })
            .where(eq(mediaItems.id, item.id))
          item.status = 'failed'
          item.error = error
          continue
        }
        // result is null → job still running or network issue; don't expire yet
        if (result === null) continue
      } catch {
        // Recovery attempt failed — fall through to timeout
      }
    }

    // No job ID or recovery failed — mark as timed out
    await db.update(mediaItems)
      .set({ status: 'failed', error: 'Generation timed out' })
      .where(eq(mediaItems.id, item.id))
    item.status = 'failed'
    item.error = 'Generation timed out'
  }

  // If all items resolved, update the generation status too
  if (gen[0].status === 'processing') {
    const allResolved = items.every(i => i.status === 'complete' || i.status === 'failed')
    if (allResolved) {
      const allFailed = items.every(i => i.status === 'failed')
      const anyFailed = items.some(i => i.status === 'failed')
      await db.update(generations)
        .set({ status: allFailed ? 'failed' : anyFailed ? 'partial' : 'complete' })
        .where(eq(generations.id, generationId))
      gen[0].status = allFailed ? 'failed' : anyFailed ? 'partial' : 'complete'
    }
  }

  // Transform base64 data URIs to serving paths to reduce payload
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
