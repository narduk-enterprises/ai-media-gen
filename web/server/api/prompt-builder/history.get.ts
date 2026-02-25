/**
 * GET /api/prompt-builder/history
 * Paginated generation history from the prompt_generation_log.
 */
import { desc, count } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth'
import { promptGenerationLog, promptTemplates } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDatabase()
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 20, 100)
  const offset = Math.max(Number(query.offset) || 0, 0)

  // Count total
  const countResult = await db
    .select({ total: count() })
    .from(promptGenerationLog)
  const total = countResult[0]?.total ?? 0

  // Fetch with template name join
  const rows = await db
    .select({
      id: promptGenerationLog.id,
      templateId: promptGenerationLog.templateId,
      templateName: promptTemplates.name,
      rawPrompt: promptGenerationLog.rawPrompt,
      refinedPrompt: promptGenerationLog.refinedPrompt,
      similarityHash: promptGenerationLog.similarityHash,
      userId: promptGenerationLog.userId,
      createdAt: promptGenerationLog.createdAt,
    })
    .from(promptGenerationLog)
    .leftJoin(promptTemplates, eq(promptGenerationLog.templateId, promptTemplates.id))
    .orderBy(desc(promptGenerationLog.createdAt))
    .limit(limit)
    .offset(offset)

  return { items: rows, total, limit, offset }
})
