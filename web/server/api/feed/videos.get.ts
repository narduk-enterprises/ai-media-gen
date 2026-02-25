import { eq, and, desc, sql } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems, generations } from '../../database/schema'

/**
 * GET /api/feed/videos
 *
 * Dedicated feed endpoint — returns completed videos with a single
 * efficient JOIN query instead of the N+1 pattern in /api/generations.
 *
 * Query params:
 *   limit  — max items per page (default 10, max 50)
 *   offset — pagination offset (default 0)
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDatabase()
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 10, 50)
  const offset = Math.max(Number(query.offset) || 0, 0)

  // Single query: JOIN media_items + generations for completed videos
  const videos = await db
    .select({
      id: mediaItems.id,
      url: mediaItems.url,
      type: mediaItems.type,
      status: mediaItems.status,
      prompt: generations.prompt,
      createdAt: mediaItems.createdAt,
    })
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(
      and(
        eq(mediaItems.type, 'video'),
        eq(mediaItems.status, 'complete'),
        sql`${mediaItems.url} IS NOT NULL`,
        sql`${mediaItems.url} != ''`
      )
    )
    .orderBy(desc(mediaItems.completedAt), desc(mediaItems.createdAt))
    .limit(limit)
    .offset(offset)

  // Get total count for "has more" check (also a single query)
  const [countResult] = await db
    .select({ total: sql<number>`count(*)` })
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.type, 'video'),
        eq(mediaItems.status, 'complete'),
        sql`${mediaItems.url} IS NOT NULL`,
        sql`${mediaItems.url} != ''`
      )
    )

  return {
    videos,
    total: countResult?.total ?? 0,
    limit,
    offset,
    hasMore: offset + limit < (countResult?.total ?? 0),
  }
})
