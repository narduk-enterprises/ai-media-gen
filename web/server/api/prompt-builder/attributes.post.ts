/**
 * POST /api/prompt-builder/attributes
 * Create a new prompt attribute. Supports single or bulk creation.
 * Skips duplicates (same category + value, case-insensitive).
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

  // Build dedup set from existing attributes
  const existing = await db.select({ category: promptAttributes.category, value: promptAttributes.value }).from(promptAttributes)
  const existingKeys = new Set(existing.map(a => `${a.category.trim().toLowerCase()}::${a.value.trim().toLowerCase()}`))

  const created: { id: string; category: string; value: string; weight: number }[] = []
  let skipped = 0

  for (const item of items) {
    if (!item.category?.trim() || !item.value?.trim()) continue

    const key = `${item.category.trim().toLowerCase()}::${item.value.trim().toLowerCase()}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    existingKeys.add(key)

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

  if (created.length === 0 && skipped === 0) {
    throw createError({ statusCode: 400, message: 'category and value are required' })
  }

  return { created, skipped }
})
