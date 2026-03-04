/**
 * PUT /api/prompt-builder/attributes/:id
 * Update a prompt attribute (value, weight, isActive).
 */
import { eq } from 'drizzle-orm'

import { promptAttributes } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Attribute ID required' })

  const body = await readBody(event)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() }

  if (body.value !== undefined) updates.value = body.value.trim()
  if (body.weight !== undefined) updates.weight = Number(body.weight)
  if (body.category !== undefined) updates.category = body.category.trim()
  if (body.isActive !== undefined) updates.isActive = body.isActive

  await db.update(promptAttributes).set(updates).where(eq(promptAttributes.id, id))

  return { success: true, id }
})
