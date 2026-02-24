/**
 * Background completion utility.
 *
 * Uses `waitUntil` from `cloudflare:workers` to extend the Worker's lifetime
 * and poll GPU Pod jobs to completion after the HTTP response has been sent.
 *
 * Uses shared completeMediaItem() for all completion logic.
 */
import { eq, inArray, and, isNull, or } from 'drizzle-orm'
import { mediaItems } from '../database/schema'
import { checkJobStatus } from './podClient'
import { completeMediaItem, updateGenerationStatus } from './completeItem'
import { useMediaBucket } from './r2'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { H3Event } from 'h3'

const POLL_INTERVAL_MS = 5_000
const MAX_POLL_MS = 14 * 60 * 1000

type DB = DrizzleD1Database<any>

/**
 * Poll a single media item's pod job until complete.
 */
async function pollUntilDone(
  db: DB,
  bucket: R2Bucket | null,
  item: { id: string; runpodJobId: string | null; metadata: string | null },
  maxMs = MAX_POLL_MS,
): Promise<'complete' | 'failed' | 'timeout'> {
  if (!item.runpodJobId) return 'failed'

  const startedAt = Date.now()

  while (Date.now() - startedAt < maxMs) {
    try {
      const result = await checkJobStatus(item.runpodJobId)
      if (!result) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      const outcome = await completeMediaItem(db, bucket, item.id, result)

      if (outcome === 'completed') return 'complete'
      if (outcome === 'failed') return 'failed'
      if (outcome === 'already_resolved') return 'complete'

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
 * Schedule background completion for specific item IDs.
 */
export function backgroundComplete(event: H3Event, itemIds: string[]) {
  if (!itemIds.length) return

  const db = useDatabase()
  const mediaBucket = useMediaBucket(event)

  console.log(`[BG] Scheduling background completion for ${itemIds.length} items`)
 event.waitUntil(doBackgroundWork(db, mediaBucket, itemIds))
}

async function doBackgroundWork(db: DB, mediaBucket: R2Bucket | null, itemIds: string[]) {
  try {
    const items = await db.select().from(mediaItems)
      .where(inArray(mediaItems.id, itemIds))

    const processingItems = items.filter(i => i.status === 'processing' && i.runpodJobId)
    if (!processingItems.length) return

    console.log(`[BG] Starting background completion for ${processingItems.length} items`)

    await Promise.allSettled(
      processingItems.map(item => pollUntilDone(db, mediaBucket, item))
    )

    console.log(`[BG] Background completion finished for ${processingItems.length} items`)
  } catch (e: any) {
    console.error(`[BG] Background completion error:`, e.message)
  }
}

/**
 * Find and complete ALL recoverable items in the DB.
 */
export async function recoverOrphanedItems(db: DB, mediaBucket: R2Bucket | null) {
  const recoverable = await db.select().from(mediaItems)
    .where(
      or(
        eq(mediaItems.status, 'processing'),
        and(eq(mediaItems.status, 'failed'), isNull(mediaItems.url))
      )
    )

  const withJobId = recoverable.filter(i => i.runpodJobId)
  const withoutJobId = recoverable.filter(i => !i.runpodJobId && i.status === 'processing')

  if (!withJobId.length && !withoutJobId.length) {
    return { recovered: 0, failed: 0, stillProcessing: 0, total: 0 }
  }

  console.log(`[Recovery] Found ${recoverable.length} recoverable items (${withJobId.length} with job IDs, ${withoutJobId.length} processing without)`)

  // Clean up ancient processing items with no job ID
  for (const item of withoutJobId) {
    const age = Date.now() - new Date(item.createdAt).getTime()
    if (age > 10 * 60 * 1000) {
      await db.update(mediaItems)
        .set({ status: 'failed', error: 'No pod job ID — lost in submission' })
        .where(eq(mediaItems.id, item.id))
    }
  }

  let recovered = 0, failed = 0, stillProcessing = 0

  for (const item of withJobId) {
    const result = await pollUntilDone(db, mediaBucket, item, 10_000)
    if (result === 'complete') recovered++
    else if (result === 'failed') failed++
    else stillProcessing++
  }

  const genIds = [...new Set(recoverable.map(i => i.generationId).filter(Boolean))] as string[]
  for (const genId of genIds) {
    await updateGenerationStatus(db, genId)
  }

  return { recovered, failed, stillProcessing, total: recoverable.length }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
