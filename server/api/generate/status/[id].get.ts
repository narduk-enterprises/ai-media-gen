import { eq } from 'drizzle-orm'
import { requireAuth } from '../../../utils/auth'
import { mediaItems, generations } from '../../../database/schema'

/**
 * Read-only status endpoint for a single media item.
 * Just returns current DB state — no RunPod calls.
 * The cron queue processor is the sole authority for advancing state.
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
