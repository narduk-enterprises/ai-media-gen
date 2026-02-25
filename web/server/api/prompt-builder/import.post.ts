/**
 * POST /api/prompt-builder/import
 * Bulk import templates and attributes from JSON.
 *
 * Expected JSON schema:
 * {
 *   "templates": [
 *     { "name": "...", "template": "A [adjective] [subject] in [setting]", "category": "general" }
 *   ],
 *   "attributes": {
 *     "adjective": ["ethereal", "magnificent", "ancient"],
 *     "subject": ["dragon", "castle"],
 *     "setting": [
 *       "volcano",
 *       { "value": "enchanted forest", "weight": 2.0 }
 *     ]
 *   }
 * }
 */
import { requireAdmin } from '../../utils/auth'
import { promptTemplates, promptAttributes } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const body = await readBody(event)

  const results = {
    templatesCreated: 0,
    attributesCreated: 0,
    errors: [] as string[],
  }

  // Import templates
  if (Array.isArray(body.templates)) {
    for (const tpl of body.templates) {
      if (!tpl.name?.trim() || !tpl.template?.trim()) {
        results.errors.push(`Skipped template: missing name or template`)
        continue
      }
      try {
        const now = new Date().toISOString()
        await db.insert(promptTemplates).values({
          id: crypto.randomUUID(),
          name: tpl.name.trim(),
          template: tpl.template.trim(),
          category: tpl.category?.trim() || 'general',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        results.templatesCreated++
      } catch (e: any) {
        results.errors.push(`Template "${tpl.name}": ${e.message}`)
      }
    }
  }

  // Import attributes (grouped by category)
  if (body.attributes && typeof body.attributes === 'object') {
    for (const [category, values] of Object.entries(body.attributes)) {
      if (!Array.isArray(values)) continue
      for (const item of values) {
        // Support both string and { value, weight } formats
        const value = typeof item === 'string' ? item : item?.value
        const weight = typeof item === 'object' ? (item?.weight ?? 1.0) : 1.0

        if (!value?.trim()) continue
        try {
          const now = new Date().toISOString()
          await db.insert(promptAttributes).values({
            id: crypto.randomUUID(),
            category: category.trim(),
            value: value.trim(),
            weight,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          results.attributesCreated++
        } catch (e: any) {
          results.errors.push(`Attribute "${category}:${value}": ${e.message}`)
        }
      }
    }
  }

  return results
})
