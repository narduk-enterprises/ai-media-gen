/**
 * POST /api/prompt-builder/fill-cache
 *
 * Fire-and-forget cache fill: generates raw prompts locally, sends them
 * to the pod's batch-refine endpoint, and returns immediately.
 * Results arrive asynchronously via cache-webhook.
 *
 * Admin-only. Accepts { count?: number } (default 10, max 100).
 */



export default defineEventHandler(async (event) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const user = await requireAuth(event)

  const db = useDatabase(event)
  const ai = event.context.cloudflare?.env?.AI || null

  const body = await readBody(event)
  const count = Math.min(Math.max(Number.parseInt(body?.count) || 10, 1), 100)

  const sent = await fillPromptCache(db, ai, count)

  return {
    sent,
    status: sent > 0 ? 'accepted' : 'failed',
    message: sent > 0
      ? `Sent ${sent} prompts to pod for refinement — results will arrive via webhook`
      : 'Failed to send prompts to pod (is the prompt_refine pod running?)',
  }
})
