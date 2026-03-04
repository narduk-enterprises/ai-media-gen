/**
 * POST /api/generate/retry
 *
 * Re-queues a failed/cancelled media item by resetting its status to 'queued'.
 * The cron's submit phase will pick it up and re-submit to RunPod.
 */
import { eq } from 'drizzle-orm'

import { generations, mediaItems } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { itemId } = await readBody<{ itemId: string }>(event)

  if (!itemId) {
    throw createError({ statusCode: 400, message: 'itemId is required' })
  }

  const db = useDatabase(event)

  // Get the media item and verify ownership
  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)).limit(1)
  if (!item) throw createError({ statusCode: 404, message: 'Item not found' })

  const [gen] = await db.select().from(generations).where(eq(generations.id, item.generationId)).limit(1)
  if (!gen || gen.userId !== user.id) throw createError({ statusCode: 404, message: 'Item not found' })

  // Only retry failed or cancelled items
  if (item.status !== 'failed' && item.status !== 'cancelled') {
    throw createError({ statusCode: 400, message: `Cannot retry item with status '${item.status}'` })
  }

  // Verify it has comfyInput to re-submit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  let meta: any = null
  try { meta = item.metadata ? JSON.parse(item.metadata) : null } catch {}
  if (!meta?.comfyInput) {
    throw createError({ statusCode: 400, message: 'Item has no RunPod input — cannot retry' })
  }

  // Reset to queued
  await db.update(mediaItems)
    .set({
      status: 'queued',
      error: null,
      runpodJobId: null,
      submittedAt: null,
    })
    .where(eq(mediaItems.id, itemId))

  // Update generation status back to processing
  await db.update(generations)
    .set({ status: 'processing' })
    .where(eq(generations.id, item.generationId))

  return { ok: true, status: 'queued' }
})
