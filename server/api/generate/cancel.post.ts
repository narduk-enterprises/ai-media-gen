import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems } from '../../database/schema'
import { updateGenerationStatus } from '../../utils/queueProcessor'

const cancelSchema = {
  parse: (body: any) => {
    if (!body?.itemId || typeof body.itemId !== 'string') {
      throw new Error('itemId is required')
    }
    return { itemId: body.itemId as string }
  },
}

/**
 * Cancel a queued item — only works if status is 'queued' (not yet submitted to RunPod).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const body = await readBody(event)

  let itemId: string
  try {
    ;({ itemId } = cancelSchema.parse(body))
  } catch {
    throw createError({ statusCode: 400, message: 'itemId is required' })
  }

  const db = useDatabase()
  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)).limit(1)

  if (!item) {
    throw createError({ statusCode: 404, message: 'Item not found' })
  }

  if (item.status !== 'queued') {
    throw createError({
      statusCode: 400,
      message: `Cannot cancel item with status '${item.status}' — only queued items can be cancelled`,
    })
  }

  await db.update(mediaItems)
    .set({ status: 'cancelled', error: 'Cancelled by user' })
    .where(eq(mediaItems.id, itemId))

  // Update parent generation status
  await updateGenerationStatus(db, item.generationId)

  console.log(`[Queue] 🚫 Item ${itemId.slice(0, 8)} cancelled by user`)

  return { success: true, itemId }
})
