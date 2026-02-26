/**
 * POST /api/prompt-builder/generate
 * Generate a prompt using templates + attributes + LLM refinement.
 *
 * Optional body params:
 *   - mediaType: 'image' | 'video' | 'any' (default 'any')
 *   - modelHint: string (e.g., 'pony', 'wan22', 'flux2')
 */
import { requireAuth } from '../../utils/auth'
import { generatePrompt } from '../../utils/promptGenerator'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()
  const body = await readBody(event).catch(() => ({}))

  // Get Workers AI binding (kept for backward compat, no longer used for refinement)
  const ai = event.context.cloudflare?.env?.AI || null

  const result = await generatePrompt(db, ai, user.id, 3, {
    mediaType: body?.mediaType || 'any',
    modelHint: body?.modelHint || null,
  }, event)

  return result
})
