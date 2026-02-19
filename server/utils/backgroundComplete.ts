/**
 * Background completion utility.
 *
 * Uses `import { waitUntil } from "cloudflare:workers"` to extend the
 * Worker's lifetime and poll RunPod jobs to completion, even after the
 * HTTP response has been sent.
 *
 * The caller just calls `backgroundComplete(event, itemIds)` and this
 * module handles everything: grabbing DB/R2, calling waitUntil, polling,
 * saving results.
 */
import { eq, inArray } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { mediaItems, generations } from '../database/schema'
import { checkRunPodJob } from './ai'
import { uploadImageToR2, useMediaBucket } from './r2'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { H3Event } from 'h3'

const POLL_INTERVAL_MS = 5_000     // 5s between checks
const MAX_POLL_MS = 14 * 60 * 1000 // 14 min (stay under CF 15-min limit)

type DB = DrizzleD1Database<any>

/**
 * Poll a single media item's RunPod job until complete, then save to R2/DB.
 */
async function completeMediaItem(
  db: DB,
  mediaBucket: R2Bucket | null,
  item: { id: string; type: string | null; runpodJobId: string | null; generationId: string | null; metadata: string | null },
  maxMs = MAX_POLL_MS,
): Promise<'complete' | 'failed' | 'timeout'> {
  if (!item.runpodJobId) return 'failed'

  const apiUrl = item.metadata ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return undefined } })() : undefined
  const startedAt = Date.now()

  while (Date.now() - startedAt < maxMs) {
    try {
      const result = await checkRunPodJob(item.runpodJobId, apiUrl)

      if (!result) {
        await sleep(POLL_INTERVAL_MS)
        continue
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

        console.log(`[BG] ✅ ${item.id.slice(0, 8)} complete (${item.type})`)
        return 'complete'
      }

      if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
        const error = result.error || `RunPod job ${result.status.toLowerCase()}`
        await db.update(mediaItems)
          .set({ status: 'failed', error })
          .where(eq(mediaItems.id, item.id))

        console.log(`[BG] ❌ ${item.id.slice(0, 8)} ${result.status}`)
        return 'failed'
      }

      await sleep(POLL_INTERVAL_MS)
    } catch (e: any) {
      console.warn(`[BG] ⚠️ ${item.id.slice(0, 8)} check error:`, e.message)
      await sleep(POLL_INTERVAL_MS)
    }
  }

  console.log(`[BG] ⏰ ${item.id.slice(0, 8)} timed out after ${maxMs / 1000}s`)
  return 'timeout'
}

/**
 * Update parent generation status after all items are resolved.
 */
async function updateGenerationStatus(db: DB, generationId: string) {
  const items = await db.select().from(mediaItems)
    .where(eq(mediaItems.generationId, generationId))

  const allResolved = items.every(i => i.status === 'complete' || i.status === 'failed')
  if (!allResolved) return

  const allFailed = items.every(i => i.status === 'failed')
  const anyFailed = items.some(i => i.status === 'failed')
  const status = allFailed ? 'failed' : anyFailed ? 'partial' : 'complete'

  await db.update(generations)
    .set({ status })
    .where(eq(generations.id, generationId))

  console.log(`[BG] Generation ${generationId.slice(0, 8)} → ${status}`)
}

/**
 * Schedule background completion for specific item IDs.
 *
 * Uses the `waitUntil` import from `cloudflare:workers` so it can be
 * called from anywhere — no need to pass ctx or event.context.
 *
 * Eagerly captures DB and R2 bucket from the event (still in request
 * context) before handing off to the background promise.
 */
export function backgroundComplete(event: H3Event, itemIds: string[]) {
  if (!itemIds.length) return

  // Capture DB/R2 while still in request context
  const db = useDatabase()
  const mediaBucket = useMediaBucket(event)

  console.log(`[BG] Scheduling background completion for ${itemIds.length} items`)

  waitUntil(doBackgroundWork(db, mediaBucket, itemIds))
}

/**
 * The actual background work promise that runs after the response is sent.
 */
async function doBackgroundWork(db: DB, mediaBucket: R2Bucket | null, itemIds: string[]) {
  try {
    const items = await db.select().from(mediaItems)
      .where(inArray(mediaItems.id, itemIds))

    const processingItems = items.filter(i => i.status === 'processing' && i.runpodJobId)
    if (!processingItems.length) return

    console.log(`[BG] Starting background completion for ${processingItems.length} items`)

    await Promise.allSettled(
      processingItems.map(item => completeMediaItem(db, mediaBucket, item))
    )

    const genIds = [...new Set(processingItems.map(i => i.generationId).filter(Boolean))] as string[]
    for (const genId of genIds) {
      await updateGenerationStatus(db, genId)
    }

    console.log(`[BG] Background completion finished for ${processingItems.length} items`)
  } catch (e: any) {
    console.error(`[BG] Background completion error:`, e.message)
  }
}

/**
 * Find and complete ALL orphaned processing items in the DB.
 * Used by the /api/generate/recover endpoint AND the cron trigger.
 */
export async function recoverOrphanedItems(db: DB, mediaBucket: R2Bucket | null) {
  const orphaned = await db.select().from(mediaItems)
    .where(eq(mediaItems.status, 'processing'))

  if (!orphaned.length) {
    return { recovered: 0, failed: 0, stillProcessing: 0, total: 0 }
  }

  const withJobId = orphaned.filter(i => i.runpodJobId)
  const withoutJobId = orphaned.filter(i => !i.runpodJobId)

  console.log(`[Recovery] Found ${orphaned.length} orphaned items (${withJobId.length} with job IDs, ${withoutJobId.length} without)`)

  for (const item of withoutJobId) {
    const age = Date.now() - new Date(item.createdAt).getTime()
    if (age > 10 * 60 * 1000) {
      await db.update(mediaItems)
        .set({ status: 'failed', error: 'No RunPod job ID — lost in submission' })
        .where(eq(mediaItems.id, item.id))
    }
  }

  let recovered = 0
  let failed = 0
  let stillProcessing = 0

  for (const item of withJobId) {
    const result = await completeMediaItem(db, mediaBucket, item, 10_000)
    if (result === 'complete') recovered++
    else if (result === 'failed') failed++
    else stillProcessing++
  }

  const genIds = [...new Set(orphaned.map(i => i.generationId).filter(Boolean))] as string[]
  for (const genId of genIds) {
    await updateGenerationStatus(db, genId as string)
  }

  return { recovered, failed, stillProcessing, total: orphaned.length }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
