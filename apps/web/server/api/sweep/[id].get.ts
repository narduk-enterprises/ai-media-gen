/**
 * GET /api/sweep/[id]
 *
 * Fetch all generations belonging to a sweep by sweepId.
 * Returns the sweep's generations with their media items, ordered by creation time.
 */
import { eq, desc } from 'drizzle-orm'

import { generations, mediaItems } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const sweepId = getRouterParam(event, 'id')

  if (!sweepId) {
    throw createError({ statusCode: 400, message: 'Sweep ID is required' })
  }

  const db = useDatabase(event)

  // Find all generations for this user that have this sweepId in settings
  const userGens = await db.select()
    .from(generations)
    .where(eq(generations.userId, user.id))
    .orderBy(desc(generations.createdAt))

  // Filter by sweepId in settings JSON
  const sweepGens = userGens.filter(gen => {
    try {
      const s = JSON.parse(gen.settings || '{}')
      return s.sweepId === sweepId
    } catch { return false }
  })

  if (sweepGens.length === 0) {
    throw createError({ statusCode: 404, message: 'Sweep not found' })
  }

  // Fetch media items for each generation
  const results = await Promise.all(
    sweepGens.map(async (gen) => {
      const items = await db.select()
        .from(mediaItems)
        .where(eq(mediaItems.generationId, gen.id))

      const settings = JSON.parse(gen.settings || '{}')

      return {
        id: gen.id,
        prompt: gen.prompt,
        sweepLabel: settings.sweepLabel || '',
        settings,
        items: items.map(item => ({
          id: item.id,
          type: item.type,
          status: item.status,
          url: item.url?.startsWith('data:') ? `/api/media/${item.id}` : item.url,
          error: item.error,
        })),
        createdAt: gen.createdAt,
      }
    })
  )

  // Extract common prompt (all sweep items share same prompt)
  const prompt = sweepGens[0]?.prompt || ''

  return {
    sweepId,
    prompt,
    totalVariants: results.length,
    generations: results,
  }
})
