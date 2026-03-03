/**
 * DELETE /api/prompt-builder/templates/:id
 * Delete a prompt template.
 */
import { eq } from 'drizzle-orm'

import { promptTemplates } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Template ID required' })

  await db.delete(promptTemplates).where(eq(promptTemplates.id, id))

  return { success: true, id }
})
