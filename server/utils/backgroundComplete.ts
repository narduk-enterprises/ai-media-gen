/**
 * Background completion utility.
 *
 * After a generation response is sent to the client, this runs inside
 * `waitUntil()` to poll RunPod and save results — so the job completes
 * even if the user closes the browser.
 *
 * On Cloudflare Workers, waitUntil() keeps the worker alive for up to
 * 30 seconds (free) or 15 minutes (paid). This is enough for most
 * image jobs; for video jobs that take longer, the recovery endpoint
 * handles anything that slips through.
 */
import { eq, and, inArray } from 'drizzle-orm'
import { mediaItems, generations } from '../database/schema'
import { checkRunPodJob } from './ai'
import { uploadImageToR2, useMediaBucket as getMediaBucket } from './r2'

const POLL_INTERVAL_MS = 5_000  // 5s between checks
const MAX_POLL_MS = 14 * 60 * 1000 // 14 min (stay under CF 15-min limit)

/**
 * Poll a single media item's RunPod job until complete, then save to R2/DB.
 */
async function completeMediaItem(
  db: ReturnType<typeof useDatabase>,
  mediaBucket: R2Bucket | null,
  item: { id: string; type: string | null; runpodJobId: string | null; generationId: string | null; metadata: string | null }
): Promise<'complete' | 'failed' | 'timeout'> {
  if (!item.runpodJobId) return 'failed'

  const apiUrl = item.metadata ? JSON.parse(item.metadata).apiUrl : undefined
  const startedAt = Date.now()

  while (Date.now() - startedAt < MAX_POLL_MS) {
    try {
      const result = await checkRunPodJob(item.runpodJobId, apiUrl)

      if (!result) {
        // Still running — wait and retry
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

      // Unknown status — wait and retry
      await sleep(POLL_INTERVAL_MS)
    } catch (e: any) {
      console.warn(`[BG] ⚠️ ${item.id.slice(0, 8)} check error:`, e.message)
      await sleep(POLL_INTERVAL_MS)
    }
  }

  console.log(`[BG] ⏰ ${item.id.slice(0, 8)} timed out after ${MAX_POLL_MS / 1000}s background polling`)
  return 'timeout'
}

/**
 * Update parent generation status after all items are resolved.
 */
async function updateGenerationStatus(
  db: ReturnType<typeof useDatabase>,
  generationId: string
) {
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
 * Start background completion for a list of media items.
 * Call this inside event.waitUntil() after sending the response.
 */
export async function backgroundComplete(
  event: any,
  itemIds: string[]
) {
  if (!itemIds.length) return

  try {
    const db = useDatabase()
    const mediaBucket = getMediaBucket(event)
    const items = await db.select().from(mediaItems)
      .where(inArray(mediaItems.id, itemIds))

    const processingItems = items.filter(i => i.status === 'processing' && i.runpodJobId)
    if (!processingItems.length) return

    console.log(`[BG] Starting background completion for ${processingItems.length} items`)

    // Process all items in parallel
    await Promise.allSettled(
      processingItems.map(item => completeMediaItem(db, mediaBucket, item))
    )

    // Update generation statuses
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
 * Used by the /api/generate/recover endpoint.
 */
export async function recoverOrphanedItems(event: any) {
  const db = useDatabase()
  const mediaBucket = getMediaBucket(event)

  // Find all items still marked as processing with a job ID
  const orphaned = await db.select().from(mediaItems)
    .where(and(
      eq(mediaItems.status, 'processing'),
    ))

  if (!orphaned.length) {
    return { recovered: 0, failed: 0, stillProcessing: 0, total: 0 }
  }

  const withJobId = orphaned.filter(i => i.runpodJobId)
  const withoutJobId = orphaned.filter(i => !i.runpodJobId)

  console.log(`[Recovery] Found ${orphaned.length} orphaned items (${withJobId.length} with job IDs, ${withoutJobId.length} without)`)

  // Mark items without job IDs as failed
  for (const item of withoutJobId) {
    const age = Date.now() - new Date(item.createdAt).getTime()
    if (age > 10 * 60 * 1000) { // only if > 10 minutes old
      await db.update(mediaItems)
        .set({ status: 'failed', error: 'No RunPod job ID — lost in submission' })
        .where(eq(mediaItems.id, item.id))
    }
  }

  // Try to complete items with job IDs
  let recovered = 0
  let failed = 0
  let stillProcessing = 0

  for (const item of withJobId) {
    const result = await completeMediaItem(db, mediaBucket, item)
    if (result === 'complete') recovered++
    else if (result === 'failed') failed++
    else stillProcessing++
  }

  // Update generation statuses
  const genIds = [...new Set(orphaned.map(i => i.generationId).filter(Boolean))] as string[]
  for (const genId of genIds) {
    await updateGenerationStatus(db, genId as string)
  }

  return { recovered, failed, stillProcessing, total: orphaned.length }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
