/**
 * DELETE /api/prompt-builder/delete-all
 * Wipe all prompt templates, attributes, cache, and generation log.
 * Admin-only. Requires { confirm: true } in body.
 */
import { requireAdmin } from '../../utils/auth'
import { promptTemplates, promptAttributes, promptCache, promptGenerationLog } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)

  if (!body?.confirm) {
    throw createError({ statusCode: 400, message: 'Must send { confirm: true } to delete all data' })
  }

  const db = useDatabase()

  // Delete in order: cache → log → attributes → templates (respects FK constraints)
  const cacheDeleted = await db.delete(promptCache).returning({ id: promptCache.id })
  const logDeleted = await db.delete(promptGenerationLog).returning({ id: promptGenerationLog.id })
  const attrsDeleted = await db.delete(promptAttributes).returning({ id: promptAttributes.id })
  const templatesDeleted = await db.delete(promptTemplates).returning({ id: promptTemplates.id })

  console.log(`[PromptBuilder] DELETE ALL: ${templatesDeleted.length} templates, ${attrsDeleted.length} attributes, ${cacheDeleted.length} cache, ${logDeleted.length} log entries`)

  return {
    deleted: {
      templates: templatesDeleted.length,
      attributes: attrsDeleted.length,
      cache: cacheDeleted.length,
      log: logDeleted.length,
    },
    message: 'All prompt data deleted',
  }
})
