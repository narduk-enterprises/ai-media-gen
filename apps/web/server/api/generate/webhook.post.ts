/**
 * POST /api/generate/webhook
 *
 * Receives completion/failure callbacks from GPU pods.
 * The pod POSTs lightweight metadata (no base64 blobs);
 * this handler fetches the result data and completes the item.
 *
 * Secured via HMAC-SHA256 signature in X-Webhook-Signature header.
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'





interface WebhookPayload {
  job_id: string
  status: 'completed' | 'failed'
  result_type?: 'video' | 'image'
  has_video?: boolean
  has_image?: boolean
  error?: string | null
}

export default defineEventHandler(async (event) => {
  // ── Read body ONCE (CF Workers only allows single read) ─────
  const rawBody = await readRawBody(event) || ''
  let payload: WebhookPayload

  try {
    payload = JSON.parse(rawBody)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid JSON body' })
  }

  // ── Verify HMAC signature ─────────────────────────────────────
  const config = useRuntimeConfig()
  const secret = config.webhookSecret
  if (secret) {
    const signature = getHeader(event, 'x-webhook-signature') || ''

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

    if (signature !== expected) {
      console.warn('[Webhook] ❌ Invalid signature')
      throw createError({ statusCode: 401, message: 'Invalid webhook signature' })
    }
  }

  // ── Validate payload ────────────────────────────────────────
  if (!payload?.job_id || !payload?.status) {
    throw createError({ statusCode: 400, message: 'Missing job_id or status' })
  }

  console.log(`[Webhook] 📩 ${payload.job_id.slice(0, 8)} → ${payload.status}`)

  // ── Find the media item ──────────────────────────────────────
  const db = useDatabase(event)
  const [item] = await db.select()
    .from(mediaItems)
    .where(eq(mediaItems.runpodJobId, payload.job_id))
    .limit(1)

  if (!item) {
    console.warn(`[Webhook] Item not found for job ${payload.job_id.slice(0, 8)}`)
    return { ok: true, action: 'ignored', reason: 'no_matching_item' }
  }

  if (item.status !== 'processing') {
    console.log(`[Webhook] Item ${item.id.slice(0, 8)} already ${item.status}, skipping`)
    return { ok: true, action: 'ignored', reason: 'already_resolved' }
  }

  const mediaBucket = useMediaBucket(event)

  // ── Handle completion ────────────────────────────────────────
  if (payload.status === 'completed') {
    const meta = item.metadata ? JSON.parse(item.metadata) : {}
    const podUrl = meta.apiUrl || meta.podUrl || ''

    const result = await checkJobStatus(payload.job_id, podUrl)
    if (result) {
      const { outcome, error } = await completeMediaItem(db, mediaBucket, item.id, result)

      // If the job failed with a retryable error, re-queue on a different pod
      if (outcome === 'failed' && error) {
        const requeued = await requeueForRetry(db, item, error)
        if (requeued) {
          console.log(`[Webhook] ♻️ ${item.id.slice(0, 8)} failed → re-queued on different pod`)
          return { ok: true, action: 'requeued' }
        }
      }

      console.log(`[Webhook] ✅ ${item.id.slice(0, 8)} → ${outcome}`)
      return { ok: true, action: outcome }
    }

    // Could not fetch result — mark failed
    await db.update(mediaItems)
      .set({ status: 'failed', error: 'Webhook received but could not fetch result from pod' })
      .where(eq(mediaItems.id, item.id))
    await updateGenerationStatus(db, item.generationId)
    return { ok: true, action: 'failed', reason: 'result_fetch_failed' }
  }

  // ── Handle failure ───────────────────────────────────────────
  if (payload.status === 'failed') {
    const error = payload.error || 'Pod generation failed'

    // Try to re-queue on a different pod before giving up
    const requeued = await requeueForRetry(db, item, error)
    if (requeued) {
      console.log(`[Webhook] ♻️ ${item.id.slice(0, 8)} failed → re-queued on different pod: ${error.slice(0, 100)}`)
      return { ok: true, action: 'requeued' }
    }

    await db.update(mediaItems)
      .set({ status: 'failed', error })
      .where(eq(mediaItems.id, item.id))
    await updateGenerationStatus(db, item.generationId)
    console.log(`[Webhook] ❌ ${item.id.slice(0, 8)} failed: ${error}`)

    return { ok: true, action: 'failed' }
  }

  return { ok: true, action: 'ignored', reason: 'unknown_status' }
})
