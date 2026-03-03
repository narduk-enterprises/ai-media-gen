import { eq } from 'drizzle-orm'

import { mediaItems, generations } from '../../database/schema'
import { z } from 'zod'

const updateSchema = z.object({
  scores: z.array(z.object({
    id: z.string(),
    score: z.number().min(0).max(10),
  })),
})

/**
 * POST /api/scoring/update
 * Batch update quality scores for media items.
 * Body: { scores: [{ id: string, score: number }] }
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase(event)
  const body = await readValidatedBody(event, updateSchema.parse)

  // Verify all items belong to the user
  const userGens = await db
    .select({ id: generations.id })
    .from(generations)
    .where(eq(generations.userId, user.id))

  const genIds = new Set(userGens.map(g => g.id))

  let updated = 0
  for (const { id, score } of body.scores) {
    // Verify ownership
    const [item] = await db
      .select({ generationId: mediaItems.generationId })
      .from(mediaItems)
      .where(eq(mediaItems.id, id))

    if (!item || !genIds.has(item.generationId)) continue

    await db
      .update(mediaItems)
      .set({ qualityScore: score })
      .where(eq(mediaItems.id, id))

    updated++
  }

  return { updated, total: body.scores.length }
})
