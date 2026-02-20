import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems } from '../../database/schema'
import { updateGenerationStatus } from '../../utils/queueProcessor'

/**
 * Cancel a queued or processing item.
 * - Queued items: immediately marked as cancelled
 * - Processing items: calls RunPod cancel API, then marks as cancelled
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const body = await readBody<{ itemId: string }>(event)

  if (!body?.itemId) {
    throw createError({ statusCode: 400, message: 'itemId is required' })
  }

  const db = useDatabase()
  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, body.itemId)).limit(1)

  if (!item) {
    throw createError({ statusCode: 404, message: 'Item not found' })
  }

  if (item.status !== 'queued' && item.status !== 'processing') {
    throw createError({
      statusCode: 400,
      message: `Cannot cancel item with status '${item.status}' — only queued/processing items can be cancelled`,
    })
  }

  // For processing items with a RunPod job, try to cancel on RunPod
  if (item.status === 'processing' && item.runpodJobId) {
    try {
      const config = useRuntimeConfig()
      const apiKey = config.aiApiKey
      const apiUrl = item.metadata
        ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return config.aiApiUrl } })()
        : config.aiApiUrl

      await $fetch(`${apiUrl}/cancel/${item.runpodJobId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 5_000,
      })
      console.log(`[Queue] 🚫 Cancelled RunPod job ${item.runpodJobId} for item ${item.id.slice(0, 8)}`)
    } catch (e: any) {
      // Don't fail the cancel if RunPod cancel fails — still mark as cancelled in DB
      console.warn(`[Queue] ⚠️ RunPod cancel failed for ${item.id.slice(0, 8)}:`, e.message)
    }
  }

  await db.update(mediaItems)
    .set({ status: 'cancelled', error: 'Cancelled by user' })
    .where(eq(mediaItems.id, body.itemId))

  // Update parent generation status
  await updateGenerationStatus(db, item.generationId)

  console.log(`[Queue] 🚫 Item ${body.itemId.slice(0, 8)} cancelled by user (was ${item.status})`)

  return { success: true, itemId: body.itemId }
})
