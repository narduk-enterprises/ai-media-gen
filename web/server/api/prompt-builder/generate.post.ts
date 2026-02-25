/**
 * POST /api/prompt-builder/generate
 * Generate a prompt using templates + attributes + LLM refinement.
 */
import { requireAuth } from '../../utils/auth'
import { generatePrompt } from '../../utils/promptGenerator'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()

  // Get Workers AI binding
  const ai = event.context.cloudflare?.env?.AI || null

  const result = await generatePrompt(db, ai, user.id)

  return result
})
