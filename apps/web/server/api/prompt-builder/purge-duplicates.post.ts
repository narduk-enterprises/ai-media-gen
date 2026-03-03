/**
 * POST /api/prompt-builder/purge-duplicates
 * Remove duplicate prompt attributes from the database.
 * Keeps the oldest entry for each category:value pair (case-insensitive).
 */

import { promptAttributes } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase(event)

  // Fetch all attributes ordered by creation date
  const all = await db
    .select({
      id: promptAttributes.id,
      category: promptAttributes.category,
      value: promptAttributes.value,
      createdAt: promptAttributes.createdAt,
    })
    .from(promptAttributes)
    .orderBy(promptAttributes.createdAt)

  // Find duplicates — keep the first (oldest) entry per category:value
  const seen = new Set<string>()
  const dupeIds: string[] = []

  for (const attr of all) {
    const key = `${attr.category.trim().toLowerCase()}::${attr.value.trim().toLowerCase()}`
    if (seen.has(key)) {
      dupeIds.push(attr.id)
    } else {
      seen.add(key)
    }
  }

  // Delete duplicates one by one
  for (const id of dupeIds) {
    await db.delete(promptAttributes).where(eq(promptAttributes.id, id))
  }

  return {
    totalAttributes: all.length,
    duplicatesRemoved: dupeIds.length,
    uniqueRemaining: all.length - dupeIds.length,
  }
})
