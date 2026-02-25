/**
 * GET /api/prompt-builder/attributes
 * List all prompt attributes, optionally filtered by category.
 */
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth'
import { promptAttributes } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const query = getQuery(event)
  const category = query.category as string | undefined

  const conditions = category ? eq(promptAttributes.category, category) : undefined

  const rows = await db
    .select()
    .from(promptAttributes)
    .where(conditions)
    .orderBy(promptAttributes.category, promptAttributes.value)

  // Group by category for easier frontend consumption
  const grouped: Record<string, typeof rows> = {}
  for (const row of rows) {
    const cat = row.category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(row)
  }

  return { attributes: rows, grouped }
})
