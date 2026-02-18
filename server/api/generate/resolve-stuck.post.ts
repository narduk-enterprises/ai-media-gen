import { eq, and } from 'drizzle-orm'
import { checkRunPodJob } from '../../utils/ai'
import { useMediaBucket, uploadImageToR2 } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

/**
 * Bulk-resolve all stuck "processing" media items by checking their RunPod status.
 * This does the same work as generation-status but for ALL processing items at once,
 * regardless of which generation they belong to.
 *
 * POST /api/generate/resolve-stuck
 * No auth required (temporarily) — will add auth back after use.
 */
export default defineEventHandler(async (event) => {
  const db = useDatabase()
  const mediaBucket = useMediaBucket(event)

  // Get all processing image items
  const stuckItems = await db.select().from(mediaItems)
    .where(and(
      eq(mediaItems.status, 'processing'),
      eq(mediaItems.type, 'image'),
    ))

  if (stuckItems.length === 0) {
    return { resolved: 0, completed: 0, failed: 0, stillProcessing: 0, message: 'No stuck items' }
  }

  let completed = 0
  let failed = 0
  let stillProcessing = 0
  let errors = 0

  // Process in batches to avoid timeout
  const batchSize = 8
  for (let i = 0; i < stuckItems.length; i += batchSize) {
    const batch = stuckItems.slice(i, i + batchSize)
    await Promise.all(batch.map(async (item) => {
      if (!item.runpodJobId) {
        // No job ID — mark as failed
        await db.update(mediaItems)
          .set({ status: 'failed', error: 'No RunPod job ID' })
          .where(eq(mediaItems.id, item.id))
        failed++
        return
      }

      const itemApiUrl = item.metadata ? JSON.parse(item.metadata).apiUrl : undefined
      try {
        const result = await checkRunPodJob(item.runpodJobId, itemApiUrl)
        if (!result) {
          stillProcessing++
          return // still running on RunPod
        }

        if (result.status === 'COMPLETED' && result.output?.output?.data) {
          let url: string
          if (mediaBucket) {
            url = await uploadImageToR2(mediaBucket, item.id, result.output.output.data)
          } else {
            url = `data:image/png;base64,${result.output.output.data}`
          }
          await db.update(mediaItems)
            .set({ url, status: 'complete' })
            .where(eq(mediaItems.id, item.id))
          completed++
          console.log(`[Resolve] ✅ ${item.id.slice(0, 8)} complete`)
        } else if (result.status === 'FAILED' || result.status === 'CANCELLED' || result.status === 'TIMED_OUT') {
          const error = result.error || `RunPod job ${result.status.toLowerCase()}`
          await db.update(mediaItems)
            .set({ status: 'failed', error })
            .where(eq(mediaItems.id, item.id))
          failed++
          console.log(`[Resolve] ❌ ${item.id.slice(0, 8)} ${result.status}`)
        } else {
          stillProcessing++
        }
      } catch (e: any) {
        errors++
        console.error(`[Resolve] ⚠️ ${item.id.slice(0, 8)}: ${e.message}`)
      }
    }))
  }

  // Update generation statuses for any that are now fully resolved
  const genIds = [...new Set(stuckItems.map(i => i.generationId))]
  for (const genId of genIds) {
    const items = await db.select().from(mediaItems).where(eq(mediaItems.generationId, genId))
    const allResolved = items.every(i => i.status === 'complete' || i.status === 'failed')
    if (allResolved) {
      const allFailed = items.every(i => i.status === 'failed')
      const anyFailed = items.some(i => i.status === 'failed')
      const status = allFailed ? 'failed' : anyFailed ? 'partial' : 'complete'
      await db.update(generations)
        .set({ status })
        .where(eq(generations.id, genId))
    }
  }

  return {
    total: stuckItems.length,
    completed,
    failed,
    stillProcessing,
    errors,
    message: `Resolved ${completed + failed}/${stuckItems.length} (${completed} complete, ${failed} failed, ${stillProcessing} still processing)`,
  }
})
