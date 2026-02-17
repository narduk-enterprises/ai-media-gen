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

  return {
    item: {
      id: item.id,
      type: item.type,
      url: item.url,
      status: item.status,
      parentId: item.parentId,
    },
  }
})
