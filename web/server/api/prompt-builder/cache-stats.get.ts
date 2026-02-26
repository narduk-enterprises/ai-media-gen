/**
 * GET /api/prompt-builder/cache-stats
 *
 * Returns prompt cache statistics: total count, by media type, fill rate, etc.
 */
import { promptCache } from '../../database/schema'
import { sql, count } from 'drizzle-orm'

export default defineEventHandler(async () => {
  const db = useDatabase()

  const [totalResult, byTypeResult, newestResult, oldestResult] = await Promise.all([
    db.select({ count: count() }).from(promptCache),
    db.select({
      mediaType: promptCache.mediaType,
      count: count(),
    }).from(promptCache).groupBy(promptCache.mediaType),
    db.select({ newest: sql<string>`MAX(created_at)` }).from(promptCache),
    db.select({ oldest: sql<string>`MIN(created_at)` }).from(promptCache),
  ])

  const total = totalResult[0]?.count ?? 0
  const target = 100  // matches CACHE_TARGET
  const byType: Record<string, number> = {}
  for (const row of byTypeResult) {
    byType[row.mediaType || 'unknown'] = row.count
  }

  return {
    total,
    target,
    fillPercent: total > 0 ? Math.round((total / target) * 100) : 0,
    byType,
    newest: newestResult[0]?.newest || null,
    oldest: oldestResult[0]?.oldest || null,
  }
})
