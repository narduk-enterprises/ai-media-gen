/**
 * Server-Side Job Queue Processor.
 *
 * The cron trigger calls `processQueue()` which:
 *   1. SUBMIT — picks up `queued` items and submits them to the GPU Pod
 *   2. POLL   — checks all `processing` items via pod /generate/status
 *   3. CLEAN  — re-queues items stuck processing for >15 min (auto-retry up to 2x)
 *
 * Uses shared utilities:
 *   - completeMediaItem() for all completion logic
 *   - podClient for GPU Pod communication
 */
import { eq, asc } from 'drizzle-orm'
import { mediaItems } from '../database/schema'
import {
  submitJob, checkJobStatus, buildRequestFromMeta, getPodUrl,
  submitText2Image, submitImage2Image, submitImage2Video,
  submitText2Video, submitUpscale, submitMultiSegmentVideo,
} from './podClient'
import { completeMediaItem, updateGenerationStatus } from './completeItem'
import { resolveApiUrl, getRequiredGroups } from './ai'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

type DB = DrizzleD1Database<any>

const MAX_CONCURRENT = 10
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours — long LTX2 videos (721 frames) can take 60+ min
const MAX_RETRIES = 3

/**
 * Main entry point — called by the cron task.
 */
export async function processQueue(db: DB, mediaBucket: R2Bucket | null) {
  const submitResult = await submitPhase(db)
  const pollResult = await pollPhase(db, mediaBucket)
  const cleanResult = await cleanupPhase(db)

  return {
    submitted: submitResult.submitted,
    completed: pollResult.completed,
    failed: pollResult.failed + cleanResult.staleMarked,
    stillProcessing: pollResult.stillProcessing,
    queuedRemaining: submitResult.queuedRemaining,
  }
}

// ─── Phase 1: Submit queued items to GPU Pod ─────────────────

async function submitPhase(db: DB) {
  const processing = await db.select({ id: mediaItems.id })
    .from(mediaItems)
    .where(eq(mediaItems.status, 'processing'))

  const slotsAvailable = Math.max(0, MAX_CONCURRENT - processing.length)

  if (slotsAvailable === 0) {
    const queued = await db.select({ id: mediaItems.id })
      .from(mediaItems)
      .where(eq(mediaItems.status, 'queued'))
    console.log(`[Queue] No slots available (${processing.length}/${MAX_CONCURRENT} processing, ${queued.length} queued)`)
    return { submitted: 0, queuedRemaining: queued.length }
  }

  const queued = await db.select().from(mediaItems)
    .where(eq(mediaItems.status, 'queued'))
    .orderBy(asc(mediaItems.createdAt))
    .limit(slotsAvailable)

  const results = await Promise.allSettled(queued.map(async (item) => {
    try {
      const meta = parseItemMeta(item)
      const input = meta.comfyInput

      if (!input) {
        // Items still being captioned in the background
        if (meta.pendingCaptioning) {
          const createdAt = item.createdAt ? new Date(item.createdAt).getTime() : 0
          const ageMs = Date.now() - createdAt
          if (ageMs < 5 * 60 * 1000) {
            console.log(`[Queue] ${item.id.slice(0, 8)} still pending captioning (${Math.round(ageMs / 1000)}s old), skipping`)
            return false
          }
          console.error(`[Queue] ${item.id.slice(0, 8)} pending captioning for ${Math.round(ageMs / 1000)}s — marking failed`)
          await db.update(mediaItems)
            .set({ status: 'failed', error: 'Background captioning timed out — please retry' })
            .where(eq(mediaItems.id, item.id))
          await updateGenerationStatus(db, item.generationId)
          return false
        }

        console.error(`[Queue] ${item.id.slice(0, 8)} has no comfyInput — marking failed`)
        await db.update(mediaItems)
          .set({ status: 'failed', error: 'No input payload — corrupt queue entry' })
          .where(eq(mediaItems.id, item.id))
        await updateGenerationStatus(db, item.generationId)
        return false
      }

      // Route to correct pod endpoint based on action type
      const action = input.action || ''
      // Use model-aware routing: determine required groups and find a pod that has them
      const requiredGroups = getRequiredGroups(input)
      const podUrl = meta.apiUrl || meta.podUrl || await resolveApiUrl(undefined, undefined, requiredGroups)
      let response: { job_id: string; status?: string }

      switch (action) {
        case 'text2image':
          response = await submitText2Image(input, podUrl)
          break
        case 'image2image':
          response = await submitImage2Image(input, podUrl)
          break
        case 'image2video':
          response = await submitImage2Video(input, podUrl)
          break
        case 'text2video':
          response = await submitText2Video(input, podUrl)
          break
        case 'upscale':
        case 'upscale_video':
          response = await submitUpscale(input, podUrl)
          break
        case 'multi_segment_video':
          response = await submitMultiSegmentVideo(input, podUrl)
          break
        default: {
          const request = buildRequestFromMeta(meta)
          response = await submitJob(request, podUrl)
          break
        }
      }

      await db.update(mediaItems)
        .set({
          status: 'processing',
          runpodJobId: response.job_id,
          submittedAt: new Date().toISOString(),
          metadata: JSON.stringify({ ...meta, podJobId: response.job_id, apiUrl: podUrl }),
        })
        .where(eq(mediaItems.id, item.id))

      console.log(`[Queue] ✅ Submitted ${item.id.slice(0, 8)} → Pod job ${response.job_id} on ${podUrl}`)
      return true
    } catch (e: any) {
      const errMsg = e?.data?.error?.message || e?.data?.message || e?.message || ''
      const isRetryable = isRetryableError(errMsg, e)
      const meta = parseItemMeta(item)
      const retryCount = meta._retryCount || 0
      const failedPods: string[] = meta._failedPods || []
      const podUrl = meta.apiUrl || meta.podUrl || ''

      if (isRetryable && retryCount < MAX_RETRIES) {
        // Track this pod as failed so we route elsewhere next time
        if (podUrl && !failedPods.includes(podUrl)) failedPods.push(podUrl)

        // Clear the pinned pod URL so it re-routes through resolveApiUrl
        const retryMeta = {
          ...meta,
          apiUrl: undefined,
          podUrl: undefined,
          _retryCount: retryCount + 1,
          _failedPods: failedPods,
          _lastError: errMsg.slice(0, 200),
        }

        await db.update(mediaItems)
          .set({
            status: 'queued',
            runpodJobId: null,
            submittedAt: null,
            error: null,
            metadata: JSON.stringify(retryMeta),
          })
          .where(eq(mediaItems.id, item.id))

        console.log(`[Queue] ♻️ ${item.id.slice(0, 8)} retryable error → re-queued (retry ${retryCount + 1}/${MAX_RETRIES}, excluding ${failedPods.length} pod(s)): ${errMsg.slice(0, 100)}`)
        return false
      }

      console.error(`[Queue] ❌ Failed to submit ${item.id.slice(0, 8)}:`, e.message)
      await db.update(mediaItems)
        .set({ status: 'failed', error: `Pod submit failed: ${e.message}` })
        .where(eq(mediaItems.id, item.id))
      await updateGenerationStatus(db, item.generationId)
      return false
    }
  }))

  const submitted = results.filter(r => r.status === 'fulfilled' && r.value === true).length

  const remaining = await db.select({ id: mediaItems.id })
    .from(mediaItems)
    .where(eq(mediaItems.status, 'queued'))

  console.log(`[Queue] Submit phase: ${submitted} submitted, ${remaining.length} still queued`)
  return { submitted, queuedRemaining: remaining.length }
}

// ─── Phase 2: Poll processing items for completion ──────────

async function pollPhase(db: DB, mediaBucket: R2Bucket | null) {
  const processing = await db.select().from(mediaItems)
    .where(eq(mediaItems.status, 'processing'))

  const pollable = processing.filter(i => i.runpodJobId)

  if (!pollable.length) {
    return { completed: 0, failed: 0, stillProcessing: 0 }
  }

  console.log(`[Queue] Polling ${pollable.length} processing items...`)

  const results = await Promise.allSettled(pollable.map(async (item) => {
    try {
      const meta = parseItemMeta(item)
      const podUrl = meta.apiUrl || meta.podUrl || getPodUrl()
      const result = await checkJobStatus(item.runpodJobId!, podUrl)
      if (!result) return 'processing' as const

      const outcome = await completeMediaItem(db, mediaBucket, item.id, result)

      if (outcome === 'completed') return 'completed' as const
      if (outcome === 'failed') return 'failed' as const
      return 'processing' as const
    } catch (e: any) {
      console.warn(`[Queue] ⚠️ ${item.id.slice(0, 8)} check error:`, e.message)
      return 'processing' as const
    }
  }))

  let completed = 0, failed = 0, stillProcessing = 0
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value === 'completed') completed++
      else if (r.value === 'failed') failed++
      else stillProcessing++
    } else {
      stillProcessing++
    }
  }

  return { completed, failed, stillProcessing }
}

// ─── Phase 3: Cleanup stale items ───────────────────────────

async function cleanupPhase(db: DB) {
  const processing = await db.select().from(mediaItems)
    .where(eq(mediaItems.status, 'processing'))

  const now = Date.now()
  let staleMarked = 0
  let retried = 0

  for (const item of processing) {
    const submittedTime = item.submittedAt
      ? new Date(item.submittedAt).getTime()
      : new Date(item.createdAt).getTime()

    if (now - submittedTime > STALE_THRESHOLD_MS) {
      const meta = parseItemMeta(item)
      const retryCount = meta._retryCount || 0

      if (retryCount < MAX_RETRIES && meta.comfyInput) {
        await db.update(mediaItems)
          .set({
            status: 'queued',
            runpodJobId: null,
            submittedAt: null,
            error: null,
            metadata: JSON.stringify({ ...meta, _retryCount: retryCount + 1 }),
          })
          .where(eq(mediaItems.id, item.id))
        console.log(`[Queue] ♻️ ${item.id.slice(0, 8)} stale → re-queued (retry ${retryCount + 1}/${MAX_RETRIES})`)
        retried++
      } else {
        await db.update(mediaItems)
          .set({ status: 'failed', error: `Stale — no response after ${STALE_THRESHOLD_MS / 60000}min (${retryCount} retries)` })
          .where(eq(mediaItems.id, item.id))
        console.log(`[Queue] 🕐 ${item.id.slice(0, 8)} stale after ${Math.round((now - submittedTime) / 60000)}min — max retries exhausted`)
        await updateGenerationStatus(db, item.generationId)
        staleMarked++
      }
    }
  }

  if (retried > 0) console.log(`[Queue] Cleanup: ${retried} retried, ${staleMarked} permanently failed`)
  return { staleMarked }
}

/**
 * Detect errors that may succeed on a different pod.
 * - ComfyUI 400: model not available (not synced on that pod)
 * - Connection refused / timeout (pod still starting)
 * - SafetensorError (corrupt model file on that pod)
 */
function isRetryableError(msg: string, error?: any): boolean {
  const statusCode = error?.statusCode || error?.status || 0

  // ComfyUI 400 — model/checkpoint not found on this pod
  if (statusCode === 400 && (msg.includes('not in list') || msg.includes('value_not_in_list') || msg.includes('not in ['))) {
    return true
  }

  // Corrupt model file on this pod
  if (msg.includes('SafetensorError') || msg.includes('incomplete metadata') || msg.includes('file not fully covered')) {
    return true
  }

  // Pod not reachable (still starting or down)
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('ETIMEDOUT') || statusCode === 502 || statusCode === 503) {
    return true
  }

  return false
}
