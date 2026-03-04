/**
 * GET /api/sweeps
 *
 * List all sweeps for the authenticated user.
 * Extracts unique sweepId values from the settings JSON in generations.
 * Returns metadata: prompt, variant count, completed count, thumbnail, dates.
 */
import { eq, desc } from 'drizzle-orm'

import { generations, mediaItems } from '../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase(event)

  // Fetch all user generations ordered by newest first
  const userGens = await db.select()
    .from(generations)
    .where(eq(generations.userId, user.id))
    .orderBy(desc(generations.createdAt))

  // Group by sweepId
  const sweepMap = new Map<string, {
    sweepId: string
    prompt: string
    generationIds: string[]
    createdAt: string
    latestAt: string
  }>()

  for (const gen of userGens) {
    try {
      const s = JSON.parse(gen.settings || '{}')
      if (!s.sweepId) continue

      if (!sweepMap.has(s.sweepId)) {
        sweepMap.set(s.sweepId, {
          sweepId: s.sweepId,
          prompt: gen.prompt,
          generationIds: [gen.id],
          createdAt: gen.createdAt,
          latestAt: gen.createdAt,
        })
      } else {
        const existing = sweepMap.get(s.sweepId)!
        existing.generationIds.push(gen.id)
        // Track earliest and latest
        if (gen.createdAt < existing.createdAt) existing.createdAt = gen.createdAt
        if (gen.createdAt > existing.latestAt) existing.latestAt = gen.createdAt
      }
    } catch { /* skip unparseable */ }
  }

  // Now fetch media items for each sweep to get counts + thumbnail
  const sweeps = await Promise.all(
    // eslint-disable-next-line nuxt-guardrails/no-map-async-in-server
    Array.from(sweepMap.values()).map(async (sweep) => {
      const items = await Promise.all(
        sweep.generationIds.map(gid =>
          db.select({
            id: mediaItems.id,
            type: mediaItems.type,
            url: mediaItems.url,
            status: mediaItems.status,
          })
            .from(mediaItems)
            .where(eq(mediaItems.generationId, gid))
        )
      )
      const flatItems = items.flat()
      const imageItems = flatItems.filter(i => i.type === 'image')
      const completeItems = imageItems.filter(i => i.status === 'complete' && i.url)
      const failedItems = imageItems.filter(i => i.status === 'failed')

      // First completed image as thumbnail
      const thumbnail = completeItems[0]?.url?.startsWith('data:')
        ? `/api/media/${completeItems[0].id}`
        : completeItems[0]?.url || null

      return {
        sweepId: sweep.sweepId,
        prompt: sweep.prompt,
        totalVariants: sweep.generationIds.length,
        completedCount: completeItems.length,
        failedCount: failedItems.length,
        pendingCount: imageItems.length - completeItems.length - failedItems.length,
        thumbnail,
        createdAt: sweep.createdAt,
        latestAt: sweep.latestAt,
      }
    })
  )

  // Sort by latest activity descending
  sweeps.sort((a, b) => b.latestAt.localeCompare(a.latestAt))

  return { sweeps, total: sweeps.length }
})
