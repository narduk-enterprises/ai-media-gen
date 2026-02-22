/**
 * GET /api/generate/my-queue
 *
 * Returns active queue items (queued/processing) plus recently completed
 * items for the current user. Pure read-only — no inline polling.
 *
 * Completion is handled by:
 *   - Cron (every minute) via queueProcessor
 *   - Webhook (instant) via webhook.post.ts
 */
import { eq, and, isNull, desc, or } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generations, mediaItems } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()

  // ── Active items: queued or processing ──
  let activeItems: typeof mediaItems.$inferSelect[] = []
  try {
    activeItems = await db.select().from(mediaItems)
      .innerJoin(generations, eq(mediaItems.generationId, generations.id))
      .where(and(
        eq(generations.userId, user.id),
        or(
          eq(mediaItems.status, 'queued'),
          eq(mediaItems.status, 'processing'),
        ),
      ))
      .orderBy(desc(mediaItems.createdAt))
      .limit(100)
      .then(rows => rows.map(r => r.media_items))
  } catch (e: any) {
    console.error('[my-queue] Active items query failed:', e.message)
  }

  // ── Recent completed/failed items (non-dismissed, limit 30) ──
  let recentItems: typeof mediaItems.$inferSelect[] = []
  try {
    recentItems = await db.select().from(mediaItems)
      .innerJoin(generations, eq(mediaItems.generationId, generations.id))
      .where(and(
        eq(generations.userId, user.id),
        isNull(mediaItems.dismissedAt),
        or(
          eq(mediaItems.status, 'complete'),
          eq(mediaItems.status, 'failed'),
          eq(mediaItems.status, 'cancelled'),
        ),
      ))
      .orderBy(desc(mediaItems.createdAt))
      .limit(30)
      .then(rows => rows.map(r => r.media_items))
  } catch (e: any) {
    console.error('[my-queue] Recent items query failed:', e.message)
  }

  // Merge and dedupe
  const seen = new Set<string>()
  const items: typeof mediaItems.$inferSelect[] = []
  for (const item of [...activeItems, ...recentItems]) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      items.push(item)
    }
  }

  // Build stats
  let queued = 0, processing = 0, complete = 0, failed = 0
  for (const item of items) {
    if (item.status === 'queued') queued++
    else if (item.status === 'processing') processing++
    else if (item.status === 'complete') complete++
    else failed++
  }

  // Transform for response
  const transformedItems = items.map(item => {
    let width: number | null = null
    let height: number | null = null
    if (item.metadata) {
      try {
        const meta = JSON.parse(item.metadata)
        const src = meta.runpodInput || meta
        width = src.width || null
        height = src.height || null
      } catch {}
    }

    return {
      id: item.id,
      generationId: item.generationId,
      type: item.type,
      prompt: item.prompt || '',
      status: item.status,
      url: item.url?.startsWith('data:') ? `/api/media/${item.id}` : item.url,
      parentId: item.parentId,
      error: item.error,
      createdAt: item.createdAt,
      submittedAt: item.submittedAt,
      width,
      height,
    }
  })

  return {
    items: transformedItems,
    stats: { queued, processing, complete, failed },
  }
})
