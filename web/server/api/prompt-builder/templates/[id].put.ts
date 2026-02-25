/**
 * PUT /api/prompt-builder/templates/:id
 * Update a prompt template.
 */
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../../utils/auth'
import { promptTemplates } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Template ID required' })

  const body = await readBody(event)
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() }

  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.template !== undefined) updates.template = body.template.trim()
  if (body.category !== undefined) updates.category = body.category.trim()
  if (body.isActive !== undefined) updates.isActive = body.isActive

  await db.update(promptTemplates).set(updates).where(eq(promptTemplates.id, id))

  return { success: true, id }
})
