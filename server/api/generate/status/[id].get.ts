/**
 * GET /api/generate/status/[id]
 *
 * Returns current status for a single media item.
 * Pure read-only — no inline RunPod polling.
 */
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../../utils/auth'
import { mediaItems } from '../../../database/schema'

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
