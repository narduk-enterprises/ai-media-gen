/**
 * DELETE /api/prompt-builder/attributes/:id
 * Delete a prompt attribute.
 */
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../../utils/auth'
import { promptAttributes } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Attribute ID required' })

  await db.delete(promptAttributes).where(eq(promptAttributes.id, id))

  return { success: true, id }
})
