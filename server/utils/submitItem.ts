/**
 * submitItem.ts — Submit queued items to the GPU Pod.
 *
 * Reads comfyInput from stored metadata, builds a MultiSegmentRequest,
 * and submits to the pod's /generate/multi-segment endpoint.
 *
 * Used by:
 * - waitUntil blocks in submit endpoints
 * - queueProcessor cron submit phase
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../database/schema'
import {
  submitJob, buildRequestFromMeta, getPodUrl,
  submitText2Image, submitImage2Image, submitImage2Video,
  submitText2Video, submitUpscale,
} from './podClient'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

type DB = DrizzleD1Database<any>

/**
 * Submit a single queued item to the GPU Pod.
 *
 * Reads input from metadata, builds a pod request, and submits it.
 * Updates status to 'processing' with the pod job ID.
 *
 * On failure: logs warning, leaves item as 'queued' for cron retry.
 * Returns the jobId on success, null on failure.
 */
export async function submitItemToPod(
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

    const meta = parseItemMeta(item)
    const input = meta.comfyInput
    if (!input) {
      console.warn(`[Submit] ${itemId.slice(0, 8)} has no comfyInput — skipping`)
      return null
    }

    // Extract pod URL from metadata (stored when generation was created)
    const podUrl = meta.apiUrl || meta.podUrl || getPodUrl()
    if (!podUrl) {
      console.warn(`[Submit] ${itemId.slice(0, 8)} has no apiUrl in metadata — skipping`)
      return null
    }

    // Route to correct pod endpoint based on action type
    const action = input.action || ''
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
      default: {
        // Fall back to multi-segment for backward compatibility
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
        metadata: JSON.stringify({ ...meta, podJobId: response.job_id }),
      })
      .where(eq(mediaItems.id, itemId))

    console.log(`[Submit] ✅ ${itemId.slice(0, 8)} → Pod job ${response.job_id}`)
    return response.job_id
  } catch (e: any) {
    console.warn(`[Submit] ⚠️ ${itemId.slice(0, 8)} failed, cron will retry: ${e.message}`)
    return null
  }
}

// Backward-compatible aliases
export const submitItemToComfyUI = submitItemToPod
export const submitItemToRunPod = submitItemToPod
