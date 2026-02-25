/**
 * POST /api/prompt-builder/templates
 * Create a new prompt template.
 */
import { requireAdmin } from '../../utils/auth'
import { promptTemplates } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const body = await readBody(event)

  const { name, template, category } = body
  if (!name?.trim() || !template?.trim()) {
    throw createError({ statusCode: 400, message: 'name and template are required' })
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.insert(promptTemplates).values({
    id,
    name: name.trim(),
    template: template.trim(),
    category: category?.trim() || 'general',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  return { id, name: name.trim(), template: template.trim(), category: category?.trim() || 'general' }
})
