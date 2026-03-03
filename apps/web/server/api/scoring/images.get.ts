import { eq, and, isNull } from 'drizzle-orm'

import { mediaItems, generations } from '../../database/schema'

/**
 * GET /api/scoring/images?scored=false
 * Returns media items (images only) for quality scoring.
 * Pass ?scored=false to get only unscored items (default).
 * Pass ?scored=all to get everything.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase(event)
  const query = getQuery(event)
  const scoredFilter = (query.scored as string) || 'false'

  // Get all generation IDs for this user
  const userGens = await db
    .select({ id: generations.id })
    .from(generations)
    .where(eq(generations.userId, user.id))

  if (!userGens.length) return { items: [], total: 0 }

  const genIds = userGens.map(g => g.id)

  // Get media items (images only) for those generations
  let allItems = await db
    .select({
      id: mediaItems.id,
      generationId: mediaItems.generationId,
      url: mediaItems.url,
      type: mediaItems.type,
      status: mediaItems.status,
      qualityScore: mediaItems.qualityScore,
    })
    .from(mediaItems)
    .where(eq(mediaItems.type, 'image'))

  // Filter to only this user's items
  allItems = allItems.filter(item => genIds.includes(item.generationId))

  // Filter by scored status
  if (scoredFilter === 'false') {
    allItems = allItems.filter(item => item.qualityScore === null)
  }

  // Only include complete items with URLs
  allItems = allItems.filter(item => item.status === 'complete' && item.url)

  // Transform URLs (same as generations endpoint)
  const items = allItems.map(item => ({
    ...item,
    url: item.url?.startsWith('data:')
      ? `/api/media/${item.id}`
      : item.url,
  }))

  return { items, total: items.length }
})
