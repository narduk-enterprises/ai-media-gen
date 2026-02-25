/**
 * POST /api/prompt-builder/attributes
 * Create a new prompt attribute. Supports single or bulk creation.
 */
import { requireAdmin } from '../../utils/auth'
import { promptAttributes } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const body = await readBody(event)

  // Support bulk: body.items = [{ category, value, weight? }]
  const items: { category: string; value: string; weight?: number }[] =
    Array.isArray(body.items) ? body.items : [body]

  const created: { id: string; category: string; value: string; weight: number }[] = []

  for (const item of items) {
    if (!item.category?.trim() || !item.value?.trim()) continue

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await db.insert(promptAttributes).values({
      id,
      category: item.category.trim(),
      value: item.value.trim(),
      weight: item.weight ?? 1.0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    created.push({ id, category: item.category.trim(), value: item.value.trim(), weight: item.weight ?? 1.0 })
  }

  if (created.length === 0) {
    throw createError({ statusCode: 400, message: 'category and value are required' })
  }

  return { created }
})
