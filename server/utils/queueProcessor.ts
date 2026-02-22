/**
 * Server-Side Job Queue Processor.
 *
 * The cron trigger calls `processQueue()` which:
 *   1. SUBMIT — picks up `queued` items and submits them to RunPod (up to MAX_CONCURRENT)
 *   2. POLL   — checks all `processing` items against RunPod, saves completed ones
 *   3. CLEAN  — re-queues items stuck processing for >15 min (auto-retry up to 2x)
 *
 * This is the SOLE authority for advancing job state. Status endpoints are read-only.
 */
import { eq, and, isNull, or, asc, sql } from 'drizzle-orm'
import { mediaItems, generations } from '../database/schema'
import { callRunPodAsync, checkRunPodJob } from './ai'
import { uploadImageToR2 } from './r2'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

type DB = DrizzleD1Database<any>

const MAX_CONCURRENT = 10          // max RunPod jobs in-flight at once
const STALE_THRESHOLD_MS = 15 * 60 * 1000 // 15 min — re-queue for retry if no RunPod response
const MAX_RETRIES = 2               // auto-retry stale items up to N times before permanent failure
const POLL_TIMEOUT_MS = 10_000     // 10s per item during poll phase (single check, not long-poll)

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

// ─── Phase 1: Submit queued items to RunPod ─────────────────

async function submitPhase(db: DB) {
  // Count currently processing items
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

  // Pick oldest queued items
  const queued = await db.select().from(mediaItems)
    .where(eq(mediaItems.status, 'queued'))
    .orderBy(asc(mediaItems.createdAt))
    .limit(slotsAvailable)

  // Submit all in parallel
  const results = await Promise.allSettled(queued.map(async (item) => {
    try {
      const meta = item.metadata ? JSON.parse(item.metadata) : {}
      const { runpodInput, apiUrl } = meta

      if (!runpodInput) {
        // Batch items with pendingCaptioning are still being processed in the background
        if (meta.pendingCaptioning) {
          const createdAt = item.createdAt ? new Date(item.createdAt).getTime() : 0
          const ageMs = Date.now() - createdAt
          if (ageMs < 5 * 60 * 1000) {
            // Less than 5 min old — background worker may still be captioning, skip for now
            console.log(`[Queue] ${item.id.slice(0, 8)} still pending captioning (${Math.round(ageMs / 1000)}s old), skipping`)
            return false
          }
          // Stale — background task probably died
          console.error(`[Queue] ${item.id.slice(0, 8)} pending captioning for ${Math.round(ageMs / 1000)}s — marking failed`)
          await db.update(mediaItems)
            .set({ status: 'failed', error: 'Background captioning timed out — please retry' })
            .where(eq(mediaItems.id, item.id))
          await updateGenerationStatus(db, item.generationId)
          return false
        }

        console.error(`[Queue] ${item.id.slice(0, 8)} has no runpodInput in metadata — marking failed`)
        await db.update(mediaItems)
          .set({ status: 'failed', error: 'No RunPod input payload — corrupt queue entry' })
          .where(eq(mediaItems.id, item.id))
        await updateGenerationStatus(db, item.generationId)
        return false
      }

      const result = await callRunPodAsync(runpodInput, apiUrl)

      await db.update(mediaItems)
        .set({
          status: 'processing',
          runpodJobId: result.jobId,
          submittedAt: new Date().toISOString(),
          metadata: JSON.stringify({ ...meta, apiUrl: result.apiUrl }),
        })
        .where(eq(mediaItems.id, item.id))

      console.log(`[Queue] ✅ Submitted ${item.id.slice(0, 8)} → job ${result.jobId}`)
      return true
    } catch (e: any) {
      console.error(`[Queue] ❌ Failed to submit ${item.id.slice(0, 8)}:`, e.message)
      await db.update(mediaItems)
        .set({ status: 'failed', error: `RunPod submit failed: ${e.message}` })
        .where(eq(mediaItems.id, item.id))
      await updateGenerationStatus(db, item.generationId)
      return false
    }
  }))

  const submitted = results.filter(r => r.status === 'fulfilled' && r.value === true).length

  // Count remaining
  const remaining = await db.select({ id: mediaItems.id })
    .from(mediaItems)
    .where(eq(mediaItems.status, 'queued'))

  console.log(`[Queue] Submit phase: ${submitted} submitted, ${remaining.length} still queued`)
  return { submitted, queuedRemaining: remaining.length }
}

// ─── Phase 2: Poll processing items for completion ──────────

async function pollPhase(db: DB, mediaBucket: R2Bucket | null) {
  const processing = await db.select().from(mediaItems)
    .where(and(
      eq(mediaItems.status, 'processing'),
      sql`${mediaItems.runpodJobId} IS NOT NULL`
    ))

  if (!processing.length) {
    return { completed: 0, failed: 0, stillProcessing: 0 }
  }

  console.log(`[Queue] Polling ${processing.length} processing items...`)

  // Poll all items in parallel
  const results = await Promise.allSettled(processing.map(async (item) => {
    try {
      const apiUrl = item.metadata ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return undefined } })() : undefined
      const result = await checkRunPodJob(item.runpodJobId!, apiUrl)

      if (!result) {
        return 'processing' as const
      }

      if (result.status === 'COMPLETED' && result.output?.output?.data) {
        const base64Data = result.output.output.data
        const isVideo = item.type === 'video'

        let url: string
        if (mediaBucket) {
          url = await uploadImageToR2(mediaBucket, item.id, base64Data, isVideo ? 'video/mp4' : 'image/png')
        } else {
          const mime = isVideo ? 'video/mp4' : 'image/png'
          url = `data:${mime};base64,${base64Data}`
        }

        await db.update(mediaItems)
          .set({ url, status: 'complete' })
          .where(eq(mediaItems.id, item.id))

        console.log(`[Queue] ✅ ${item.id.slice(0, 8)} complete (${item.type})`)
        await updateGenerationStatus(db, item.generationId)
        return 'completed' as const
      } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
        const error = result.error || `RunPod job ${result.status.toLowerCase()}`
        await db.update(mediaItems)
          .set({ status: 'failed', error })
          .where(eq(mediaItems.id, item.id))
        console.log(`[Queue] ❌ ${item.id.slice(0, 8)} ${result.status}`)
        await updateGenerationStatus(db, item.generationId)
        return 'failed' as const
      } else {
        return 'processing' as const
      }
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
      // Check retry count from metadata
      let meta: any = {}
      try { meta = item.metadata ? JSON.parse(item.metadata) : {} } catch {}
      const retryCount = meta._retryCount || 0

      if (retryCount < MAX_RETRIES && meta.runpodInput) {
        // Auto-retry: re-queue the item
        const updatedMeta = { ...meta, _retryCount: retryCount + 1 }
        await db.update(mediaItems)
          .set({
            status: 'queued',
            runpodJobId: null,
            submittedAt: null,
            error: null,
            metadata: JSON.stringify(updatedMeta),
          })
          .where(eq(mediaItems.id, item.id))
        console.log(`[Queue] ♻️ ${item.id.slice(0, 8)} stale → re-queued (retry ${retryCount + 1}/${MAX_RETRIES})`)
        retried++
      } else {
        // Max retries exhausted — permanently fail
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

// ─── Shared: update generation status ───────────────────────

async function updateGenerationStatus(db: DB, generationId: string) {
  const items = await db.select().from(mediaItems)
    .where(eq(mediaItems.generationId, generationId))

  const allResolved = items.every(i =>
    i.status === 'complete' || i.status === 'failed' || i.status === 'cancelled'
  )
  if (!allResolved) return

  const allFailed = items.every(i => i.status === 'failed' || i.status === 'cancelled')
  const anyFailed = items.some(i => i.status === 'failed' || i.status === 'cancelled')
  const status = allFailed ? 'failed' : anyFailed ? 'partial' : 'complete'

  await db.update(generations)
    .set({ status })
    .where(eq(generations.id, generationId))

  console.log(`[Queue] Generation ${generationId.slice(0, 8)} → ${status}`)
}

export { updateGenerationStatus }
