import { eq, and, desc, count, sql } from 'drizzle-orm'
import { requireAuth } from '../utils/auth'
import { generations, mediaItems } from '../database/schema'

/**
 * GET /api/generations
 *
 * Returns a flat list of completed media items (images/videos) with their
 * generation context (prompt, settings). Pagination is by media items,
 * not by generations, so the client always gets exactly `limit` items.
 *
 * Params:
 *   limit   - max media items (default 20, max 100)
 *   offset  - pagination offset (media-item level)
 *   type    - optional media type filter: 'image' | 'video' | 'all' (default: 'all')
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 20, 100)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const typeFilter = String(query.type || 'all')
  const allUsers = query.allUsers === 'true'

  // Base conditions: completed media with a URL
  const conditions = [
    eq(mediaItems.status, 'complete'),
    sql`${mediaItems.url} IS NOT NULL AND ${mediaItems.url} != ''`,
  ]
  
  // Filter by user unless allUsers is true
  if (!allUsers) {
    conditions.push(eq(generations.userId, user.id))
  }

  // Optional type filter
  if (typeFilter === 'image' || typeFilter === 'video') {
    conditions.push(eq(mediaItems.type, typeFilter))
  }

  const whereClause = and(...conditions)!

  // Count total visible media items
  const countResult = await db
    .select({ total: count() })
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(whereClause)
  const total = countResult[0]?.total ?? 0

  // Fetch paginated media items with generation context
  const rows = await db
    .select({
      // Media item fields
      id: mediaItems.id,
      type: mediaItems.type,
      url: mediaItems.url,
      status: mediaItems.status,
      parentId: mediaItems.parentId,
      itemPrompt: mediaItems.prompt,
      qualityScore: mediaItems.qualityScore,
      submittedAt: mediaItems.submittedAt,
      completedAt: mediaItems.completedAt,
      // Generation fields
      generationId: generations.id,
      prompt: generations.prompt,
      settings: generations.settings,
      createdAt: generations.createdAt,
    })
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(whereClause)
    .orderBy(desc(mediaItems.completedAt), desc(mediaItems.createdAt))
    .limit(limit)
    .offset(offset)

  // Shape the response
  const items = rows.map(row => {
    // Extract sweepId from settings JSON if present
    let sweepId: string | null = null
    if (row.settings) {
      try {
        const s = JSON.parse(row.settings)
        if (s.sweepId) sweepId = s.sweepId
      } catch { /* ignore */ }
    }

    return {
      id: row.id,
      type: row.type,
      url: row.url?.startsWith('data:') ? `/api/media/${row.id}` : row.url,
      status: row.status,
      parentId: row.parentId,
      prompt: row.itemPrompt || row.prompt,
      qualityScore: row.qualityScore,
      submittedAt: row.submittedAt,
      completedAt: row.completedAt,
      generationId: row.generationId,
      generationPrompt: row.prompt,
      settings: row.settings,
      createdAt: row.createdAt,
      sweepId,
    }
  })

  return { items, total, limit, offset }
})
