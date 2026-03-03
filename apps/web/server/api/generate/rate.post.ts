/**
 * POST /api/generate/rate
 *
 * Rate a media item with a quality score (1-10).
 * Used by the LTX2 Tester for tracking which presets produce the best results.
 */
import { eq } from 'drizzle-orm'

import { mediaItems, generations } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase(event)
  const body = await readBody(event)

  const { itemId, score } = body
  if (!itemId || typeof score !== 'number' || score < 0 || score > 10) {
    throw createError({ statusCode: 400, message: 'Missing itemId or invalid score (0-10)' })
  }

  // Verify ownership
  const [item] = await db.select({ id: mediaItems.id, generationId: mediaItems.generationId })
    .from(mediaItems)
    .where(eq(mediaItems.id, itemId))
    .limit(1)

  if (!item) {
    throw createError({ statusCode: 404, message: 'Item not found' })
  }

  const [gen] = await db.select({ userId: generations.userId })
    .from(generations)
    .where(eq(generations.id, item.generationId))
    .limit(1)

  if (!gen || gen.userId !== user.id) {
    throw createError({ statusCode: 403, message: 'Not your item' })
  }

  // Update quality score
  await db.update(mediaItems)
    .set({ qualityScore: score })
    .where(eq(mediaItems.id, itemId))

  console.log(`[Rate] Item ${itemId.slice(0, 8)} rated ${score}/10`)

  return { ok: true }
})
