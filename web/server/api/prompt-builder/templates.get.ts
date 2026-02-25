/**
 * GET /api/prompt-builder/templates
 * List all prompt templates, optionally filtered by category.
 */
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth'
import { promptTemplates } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const query = getQuery(event)
  const category = query.category as string | undefined

  const conditions = category ? eq(promptTemplates.category, category) : undefined

  const rows = await db
    .select()
    .from(promptTemplates)
    .where(conditions)
    .orderBy(promptTemplates.createdAt)

  return { templates: rows }
})
