import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generations, mediaItems } from '../../database/schema'

/**
 * Read-only generation status endpoint.
 * Returns current DB state for a generation and all its items.
 * No RunPod calls — the cron queue processor handles all state transitions.
 */
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
