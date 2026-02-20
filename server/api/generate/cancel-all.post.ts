/**
 * POST /api/generate/cancel-all
 *
 * Cancel all queued/processing items for the current user.
 * Marks them as cancelled in D1 and attempts to cancel RunPod jobs.
 */
import { eq, or } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems, generations } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()

  // Step 1: Get all active items globally (there are typically few)
  const allActive = await db.select({
    id: mediaItems.id,
    generationId: mediaItems.generationId,
    runpodJobId: mediaItems.runpodJobId,
    metadata: mediaItems.metadata,
  })
    .from(mediaItems)
    .where(or(
      eq(mediaItems.status, 'queued'),
      eq(mediaItems.status, 'processing'),
    ))

  if (allActive.length === 0) return { cancelled: 0 }

  // Step 2: Get this user's generation IDs
  const userGenIds = new Set(
    (await db.select({ id: generations.id })
      .from(generations)
      .where(eq(generations.userId, user.id))
    ).map(g => g.id)
  )

  // Step 3: Filter to only this user's items
  const userActive = allActive.filter(item => userGenIds.has(item.generationId))

  if (userActive.length === 0) return { cancelled: 0 }

  // Step 4: Try to cancel RunPod jobs (best effort, parallel, don't block)
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const defaultApiUrl = config.aiApiUrl

  const runpodCancels = userActive
    .filter(item => item.runpodJobId)
    .map(async (item) => {
      try {
        const apiUrl = item.metadata
          ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return defaultApiUrl } })()
          : defaultApiUrl
        await fetch(`${apiUrl}/cancel/${item.runpodJobId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(3_000),
        })
      } catch {
        // Best effort — don't fail the cancel
      }
    })

  // Fire RunPod cancels in parallel (don't await — let them settle in background)
  Promise.allSettled(runpodCancels)

  // Step 5: Mark all as cancelled in D1
  for (const item of userActive) {
    await db.update(mediaItems)
      .set({ status: 'cancelled', error: 'Cancelled by user (clear all)' })
      .where(eq(mediaItems.id, item.id))
  }

  console.log(`[Queue] 🚫 Cancelled ${userActive.length} items for user ${user.id.slice(0, 8)}`)

  return { cancelled: userActive.length }
})
