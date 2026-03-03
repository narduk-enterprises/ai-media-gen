/**
 * GET /api/generate/generation-status
 *
 * Returns current status for a generation and all its media items.
 * Pure read-only — no inline RunPod polling.
 */
import { eq } from 'drizzle-orm'

import { generations, mediaItems } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const query = getQuery(event)
  const generationId = query.id as string

  if (!generationId) {
    throw createError({ statusCode: 400, message: 'Generation ID is required' })
  }

  const db = useDatabase(event)

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
