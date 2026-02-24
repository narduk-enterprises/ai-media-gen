/**
 * Background completion utility.
 *
 * With the webhook system, this module is now simplified:
 * - No more polling — the pod fires a webhook when done
 * - backgroundComplete() just handles submission in waitUntil
 * - recoverOrphanedItems() handles cleanup of items stuck without job IDs
 */
import { eq, and, isNull, or } from 'drizzle-orm'
import { mediaItems } from '../database/schema'
import { checkJobStatus } from './podClient'
import { completeMediaItem, updateGenerationStatus } from './completeItem'
import { useMediaBucket } from './r2'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { H3Event } from 'h3'

type DB = DrizzleD1Database<any>

/**
 * Schedule background submission work via waitUntil.
 * With webhooks, we no longer poll — just fire-and-forget.
 */
export function backgroundComplete(event: H3Event, itemIds: string[]) {
  if (!itemIds.length) return

  console.log(`[BG] Items ${itemIds.map(id => id.slice(0, 8)).join(', ')} submitted — webhook will handle completion`)
}

/**
 * Find and complete ALL recoverable items in the DB.
 * Items processing >30 min without a job ID are marked failed.
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

  // Clean up processing items with no job ID after 30 min
  for (const item of withoutJobId) {
    const age = Date.now() - new Date(item.createdAt).getTime()
    if (age > 30 * 60 * 1000) {
      await db.update(mediaItems)
        .set({ status: 'failed', error: 'No pod job ID — lost in submission' })
        .where(eq(mediaItems.id, item.id))
    }
  }

  // For items with job IDs, do a quick one-shot status check
  let recovered = 0, failed = 0, stillProcessing = 0

  for (const item of withJobId) {
    try {
      const result = await checkJobStatus(item.runpodJobId!)
      if (!result) {
        stillProcessing++
        continue
      }
      const outcome = await completeMediaItem(db, mediaBucket, item.id, result)
      if (outcome === 'completed' || outcome === 'already_resolved') recovered++
      else if (outcome === 'failed') failed++
      else stillProcessing++
    } catch {
      stillProcessing++
    }
  }

  const genIds = [...new Set(recoverable.map(i => i.generationId).filter(Boolean))] as string[]
  for (const genId of genIds) {
    await updateGenerationStatus(db, genId)
  }

  return { recovered, failed, stillProcessing, total: recoverable.length }
}
