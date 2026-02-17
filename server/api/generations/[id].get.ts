import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generations, mediaItems } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Generation ID required' })
  }

  const db = useDatabase()

  const gen = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, user.id)))
    .limit(1)

  if (!gen[0]) {
    throw createError({ statusCode: 404, message: 'Generation not found' })
  }

  const items = await db
    .select()
    .from(mediaItems)
    .where(eq(mediaItems.generationId, id))

  return {
    generation: gen[0],
    items,
  }
})
