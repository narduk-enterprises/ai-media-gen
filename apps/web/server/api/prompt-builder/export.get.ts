/**
 * GET /api/prompt-builder/export
 * Export all templates and attributes as a JSON blob compatible with the import endpoint.
 */

import { promptTemplates, promptAttributes } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase(event)

  const templates = await db
    .select()
    .from(promptTemplates)
    .orderBy(promptTemplates.category, promptTemplates.name)

  const attrs = await db
    .select()
    .from(promptAttributes)
    .orderBy(promptAttributes.category, promptAttributes.value)

  // Group attributes by category in import-compatible format
  const attributes: Record<string, Array<string | { value: string; weight: number }>> = {}
  for (const attr of attrs) {
    const cat = attr.category
    if (!attributes[cat]) attributes[cat] = []
    // Use simple string if weight is 1.0, otherwise object format
    if (attr.weight === 1.0 || attr.weight == null) {
      attributes[cat].push(attr.value)
    } else {
      attributes[cat].push({ value: attr.value, weight: attr.weight })
    }
  }

  // Format templates for export (import-compatible)
  const exportTemplates = templates.map(t => ({
    name: t.name,
    template: t.template,
    category: t.category || 'general',
    ...(t.mediaType && t.mediaType !== 'any' ? { mediaType: t.mediaType } : {}),
    ...(t.modelHint ? { modelHint: t.modelHint } : {}),
    isActive: t.isActive,
  }))

  return {
    templates: exportTemplates,
    attributes,
    _meta: {
      exportedAt: new Date().toISOString(),
      templateCount: templates.length,
      attributeCount: attrs.length,
      categoryCount: Object.keys(attributes).length,
    },
  }
})
