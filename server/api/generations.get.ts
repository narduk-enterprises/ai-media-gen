import { eq, desc, count, and, inArray, sql } from 'drizzle-orm'
import { requireAuth } from '../utils/auth'
import { generations, mediaItems } from '../database/schema'

/**
 * GET /api/generations
 *
 * Params:
 *   limit   - max results (default 50, max 100)
 *   offset  - pagination offset
 *   type    - optional media type filter: 'image' | 'video' | 'all' (default: 'all')
 *
 * When type is set, only returns generations that have at least one
 * completed media item of that type. This ensures images are always
 * loadable even if the most recent 1000 generations were videos.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const typeFilter = String(query.type || 'all')

  // Build WHERE clause for generations
  const genConditions = [eq(generations.userId, user.id)]

  // If filtering by type, restrict to generations that have matching media
  if (typeFilter === 'image' || typeFilter === 'video') {
    const matchingGenIds = db
      .select({ id: mediaItems.generationId })
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.type, typeFilter),
          eq(mediaItems.status, 'complete'),
          sql`${mediaItems.url} IS NOT NULL AND ${mediaItems.url} != ''`
        )
      )
      .groupBy(mediaItems.generationId)

    genConditions.push(inArray(generations.id, matchingGenIds))
  }

  const whereClause = genConditions.length === 1 ? genConditions[0]! : and(...genConditions)!

  // Get total count for pagination
  const countResult = await db
    .select({ total: count() })
    .from(generations)
    .where(whereClause)
  const total = countResult[0]?.total ?? 0

  const gens = await db
    .select()
    .from(generations)
    .where(whereClause)
    .orderBy(desc(generations.createdAt))
    .limit(limit)
    .offset(offset)

  // Fetch media items for each generation — only include complete items with URLs
  const results = await Promise.all(
    gens.map(async (gen) => {
      const items = await db
        .select()
        .from(mediaItems)
        .where(eq(mediaItems.generationId, gen.id))

      // Only return complete items with valid URLs for the gallery
      const visibleItems = items
        .filter(item => item.status === 'complete' && item.url && item.url !== '')
        .map((item) => ({
          ...item,
          url: item.url?.startsWith('data:')
            ? `/api/media/${item.id}`
            : item.url,
        }))

      return { ...gen, items: visibleItems }
    }),
  )

  // Filter out generations with no visible items (can happen if all items are non-complete)
  const visibleResults = results.filter(r => r.items.length > 0)

  return { generations: visibleResults, total, limit, offset }
})
