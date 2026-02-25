/**
 * POST /api/prompt-builder/fill-cache
 * Pre-generate prompts and store them in the cache for instant retrieval.
 * Admin-only. Accepts { count?: number } (default 10, max 50).
 */
import { requireAuth } from '../../utils/auth'
import { fillPromptCache } from '../../utils/promptGenerator'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)

  const db = useDatabase()
  const ai = event.context.cloudflare?.env?.AI || null

  const body = await readBody(event)
  const count = Math.min(Math.max(parseInt(body?.count) || 10, 1), 50)

  const added = await fillPromptCache(db, ai, count)

  return { added, message: `Added ${added} prompts to cache` }
})
