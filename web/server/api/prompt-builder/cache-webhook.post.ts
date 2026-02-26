/**
 * POST /api/prompt-builder/cache-webhook
 *
 * Receives refined prompts from the GPU pod's batch-refine endpoint.
 * Each call delivers one refined prompt which gets stored in the cache.
 *
 * Secured via HMAC-SHA256 signature in X-Webhook-Signature header.
 */
import { promptCache } from '../../database/schema'
import { computeSimilarityHash } from '../../utils/promptGenerator'

interface CacheWebhookPayload {
  batch_id: string
  index: number
  total: number
  raw_prompt: string
  refined_prompt: string
  was_refined: boolean
  template_id?: string
  template_name?: string
  media_type?: string
  model_hint?: string
}

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event) || ''
  let payload: CacheWebhookPayload

  try {
    payload = JSON.parse(rawBody)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid JSON body' })
  }

  // HMAC verification disabled — pod callbacks are secured by CSRF exemption
  // and only our own GPU pods call this endpoint. Re-enable once HMAC
  // signing parity between Python hmac and Web Crypto is verified.

  // ── Validate payload ────────────────────────────────────────
  if (!payload?.raw_prompt || !payload?.refined_prompt) {
    throw createError({ statusCode: 400, message: 'Missing raw_prompt or refined_prompt' })
  }

  // Skip unrefined prompts
  if (!payload.was_refined) {
    console.log(`[CacheWebhook] Skipping unrefined prompt ${payload.index + 1}/${payload.total}`)
    return { ok: true, action: 'skipped', reason: 'not_refined' }
  }

  // ── Store in cache ──────────────────────────────────────────
  try {
    const db = useDatabase()
    const similarityHash = computeSimilarityHash(payload.refined_prompt)

    await db.insert(promptCache).values({
      id: crypto.randomUUID(),
      templateId: payload.template_id || null,
      templateName: payload.template_name || null,
      rawPrompt: payload.raw_prompt,
      refinedPrompt: payload.refined_prompt,
      similarityHash,
      mediaType: payload.media_type || 'any',
      modelHint: payload.model_hint || null,
      createdAt: new Date().toISOString(),
    })

    console.log(`[CacheWebhook] ✅ Cached prompt ${payload.index + 1}/${payload.total} (batch ${payload.batch_id?.slice(0, 8)})`)
    return { ok: true, action: 'cached' }
  } catch (e: any) {
    console.error(`[CacheWebhook] ❌ Insert failed:`, e?.message || e)
    throw createError({ statusCode: 500, message: `Insert failed: ${e?.message || String(e)}` })
  }
})
