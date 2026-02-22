/**
 * submitItem.ts — Single source of truth for submitting a queued item to RunPod.
 *
 * Used by:
 * - waitUntil blocks in submit endpoints (image, video, text2video, image2video-auto)
 * - queueProcessor cron submit phase
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../database/schema'
import { callRunPodAsync } from './ai'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

type DB = DrizzleD1Database<any>

/**
 * Submit a single queued item to RunPod.
 *
 * Reads runpodInput from metadata, calls RunPod async API,
 * updates status to 'processing' with jobId and submittedAt.
 *
 * On failure: logs warning, leaves item as 'queued' for cron retry.
 * Returns the jobId on success, null on failure.
 */
export async function submitItemToRunPod(
  db: DB,
  itemId: string,
): Promise<string | null> {
  try {
    const [item] = await db.select({ metadata: mediaItems.metadata })
      .from(mediaItems).where(eq(mediaItems.id, itemId)).limit(1)

    if (!item?.metadata) {
      console.warn(`[Submit] ${itemId.slice(0, 8)} has no metadata — skipping`)
      return null
    }

    let meta: any
    try { meta = JSON.parse(item.metadata) } catch {
      console.warn(`[Submit] ${itemId.slice(0, 8)} has corrupt metadata — skipping`)
      return null
    }

    const { runpodInput, apiUrl } = meta
    if (!runpodInput) {
      console.warn(`[Submit] ${itemId.slice(0, 8)} has no runpodInput — skipping`)
      return null
    }

    const result = await callRunPodAsync(runpodInput, apiUrl)

    await db.update(mediaItems)
      .set({
        status: 'processing',
        runpodJobId: result.jobId,
        submittedAt: new Date().toISOString(),
        metadata: JSON.stringify({ ...meta, apiUrl: result.apiUrl }),
      })
      .where(eq(mediaItems.id, itemId))

    console.log(`[Submit] ✅ ${itemId.slice(0, 8)} → job ${result.jobId}`)
    return result.jobId
  } catch (e: any) {
    console.warn(`[Submit] ⚠️ ${itemId.slice(0, 8)} failed, cron will retry: ${e.message}`)
    return null
  }
}
