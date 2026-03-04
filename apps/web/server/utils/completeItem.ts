/**
 * completeItem.ts — Single source of truth for completing a media item.
 *
 * Every completion path (cron, webhook, background poll) calls this one function.
 * It handles: race guard, R2 upload, DB update, and generation status rollup.
 */
import { eq } from 'drizzle-orm'
import { mediaItems, generations } from '../database/schema'
import { uploadImageToR2 } from './r2'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

type DB = DrizzleD1Database<Record<string, unknown>>

export interface RunPodResult {
  status: string
  output?: { output?: { data?: string } }
  error?: string
  result_text?: string
}

/**
 * Complete a single media item based on RunPod result.
 *
 * - Race-safe: re-checks status before writing
 * - Handles COMPLETED, FAILED, CANCELLED, TIMED_OUT
 * - Uploads to R2 if bucket available, falls back to data URI
 * - Updates generation status after every resolution
 */
export type CompleteOutcome = 'completed' | 'failed' | 'already_resolved' | 'still_running'

export interface CompleteResult {
  outcome: CompleteOutcome
  error?: string
}

export async function completeMediaItem(
  db: DB,
  bucket: R2Bucket | null,
  itemId: string,
  result: RunPodResult,
): Promise<CompleteResult> {
  // Still running — nothing to do
  if (!result || result.status === 'IN_PROGRESS' || result.status === 'IN_QUEUE') {
    return { outcome: 'still_running' }
  }

  // Race guard: re-check item is still processing before writing
  const [fresh] = await db.select({ status: mediaItems.status, generationId: mediaItems.generationId })
    .from(mediaItems).where(eq(mediaItems.id, itemId)).limit(1)

  if (!fresh || (fresh.status !== 'processing' && fresh.status !== 'failed')) {
    return { outcome: 'already_resolved' }
  }

  const generationId = fresh.generationId

  if (result.status === 'COMPLETED') {
    let url: string

    if (result.output?.output?.data) {
      const base64Data = result.output.output.data

      // Determine content type from the item
      const [itemRow] = await db.select({ type: mediaItems.type })
        .from(mediaItems).where(eq(mediaItems.id, itemId)).limit(1)
      const isVideo = itemRow?.type === 'video'

      if (bucket) {
        url = await uploadImageToR2(bucket, itemId, base64Data, isVideo ? 'video/mp4' : 'image/png')
      } else {
        const mime = isVideo ? 'video/mp4' : 'image/png'
        url = `data:${mime};base64,${base64Data}`
      }
    } else if (result.result_text) {
      // Text result directly stored in url column
      url = result.result_text
    } else {
      return { outcome: 'failed', error: 'No output data found in completed job' }
    }

    await db.update(mediaItems)
      .set({ url, status: 'complete', completedAt: new Date().toISOString() })
      .where(eq(mediaItems.id, itemId))

    console.log(`[Complete] ✅ ${itemId.slice(0, 8)} complete`)
    await updateGenerationStatus(db, generationId)
    return { outcome: 'completed' }
  }

  if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
    const error = result.error || `RunPod job ${result.status.toLowerCase()}`
    await db.update(mediaItems)
      .set({ status: 'failed', error, completedAt: new Date().toISOString() })
      .where(eq(mediaItems.id, itemId))

    console.log(`[Complete] ❌ ${itemId.slice(0, 8)} ${result.status}: ${error}`)
    await updateGenerationStatus(db, generationId)
    return { outcome: 'failed', error }
  }

  return { outcome: 'still_running' }
}

/**
 * Update generation status based on all its media items.
 * Called after every item resolution.
 */
export async function updateGenerationStatus(db: DB, generationId: string) {
  const items = await db.select({ status: mediaItems.status })
    .from(mediaItems)
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

  console.log(`[Complete] Generation ${generationId.slice(0, 8)} → ${status}`)
}
