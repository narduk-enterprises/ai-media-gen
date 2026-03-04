/**
 * POST /api/generate/cleanup-stale
 * Marks old queued/processing items as failed.
 * Temporary endpoint for one-time cleanup.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { eq, or, and, lt } from 'drizzle-orm'

import { mediaItems } from '../../database/schema'

export default defineEventHandler(async (event) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const user = await requireAuth(event)
  const db = useDatabase(event)

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  // Count first
  const staleQueued = await db.select({ id: mediaItems.id }).from(mediaItems)
    .where(and(
      eq(mediaItems.status, 'queued'),
      lt(mediaItems.createdAt, oneHourAgo),
    ))
  const staleProcessing = await db.select({ id: mediaItems.id }).from(mediaItems)
    .where(and(
      eq(mediaItems.status, 'processing'),
      lt(mediaItems.createdAt, oneHourAgo),
    ))

  // Update queued
  if (staleQueued.length > 0) {
    for (const item of staleQueued) {
      await db.update(mediaItems)
        .set({ status: 'failed', error: 'Stale - cleared from GPU queue' })
        .where(eq(mediaItems.id, item.id))
    }
  }

  // Update processing
  if (staleProcessing.length > 0) {
    for (const item of staleProcessing) {
      await db.update(mediaItems)
        .set({ status: 'failed', error: 'Stale - cleared from GPU queue' })
        .where(eq(mediaItems.id, item.id))
    }
  }

  return {
    cleaned: staleQueued.length + staleProcessing.length,
    queued: staleQueued.length,
    processing: staleProcessing.length,
  }
})
