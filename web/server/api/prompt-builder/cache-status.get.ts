/**
 * GET /api/prompt-builder/cache-status
 * Returns the number of cached prompts available.
 */
import { requireAuth } from '../../utils/auth'
import { promptCache } from '../../database/schema'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const db = useDatabase()
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(promptCache)

  return { cached: result[0]?.count ?? 0 }
})
