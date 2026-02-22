/**
 * GET /api/generate/my-queue
 *
 * Returns active queue items (queued/processing) plus recently completed
 * items for the current user.
 *
 * INLINE POLLING: When there are processing items, we check RunPod status
 * inline (non-blocking) so completed items appear immediately on the next
 * frontend poll (~5s) instead of waiting for the cron (~20s).
 */
import { eq, and, isNull, desc, or } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generations, mediaItems } from '../../database/schema'
import { checkRunPodJob } from '../../utils/ai'
import { uploadImageToR2 } from '../../utils/r2'
import { updateGenerationStatus } from '../../utils/queueProcessor'

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

  // ── INLINE POLL: Check processing items against RunPod ──
  // This eliminates the 20-second lag waiting for the cron cycle.
  const processingItems = activeItems.filter(i => i.status === 'processing' && i.runpodJobId)
  if (processingItems.length > 0) {
    const env = (globalThis as any).__env__
    const mediaBucket: R2Bucket | null = env?.MEDIA ?? null

    const inlineResults = await Promise.allSettled(processingItems.map(async (item) => {
      try {
        const apiUrl = item.metadata
          ? (() => { try { return JSON.parse(item.metadata!).apiUrl } catch { return undefined } })()
          : undefined
        const result = await checkRunPodJob(item.runpodJobId!, apiUrl)

        if (!result) return // still running

        if (result.status === 'COMPLETED' && result.output?.output?.data) {
          // Guard against race: re-check item is still processing before writing
          const [fresh] = await db.select({ status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, item.id)).limit(1)
          if (fresh?.status !== 'processing') {
            console.log(`[my-queue] ⏭️ ${item.id.slice(0, 8)} already ${fresh?.status} — skipping inline completion`)
            return
          }

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
          await updateGenerationStatus(db, item.generationId)

          // Update in-memory item for this response
          item.status = 'complete'
          item.url = url
          console.log(`[my-queue] ✅ Inline-completed ${item.id.slice(0, 8)} (${item.type})`)
        } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
          const error = result.error || `RunPod job ${result.status.toLowerCase()}`
          await db.update(mediaItems)
            .set({ status: 'failed', error })
            .where(eq(mediaItems.id, item.id))
          await updateGenerationStatus(db, item.generationId)

          item.status = 'failed'
          item.error = error
          console.log(`[my-queue] ❌ Inline-failed ${item.id.slice(0, 8)}: ${error}`)
        }
      } catch (e: any) {
        // Don't fail the whole request — just skip this item's inline check
        console.warn(`[my-queue] ⚠️ Inline check failed for ${item.id.slice(0, 8)}:`, e.message)
      }
    }))
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

  // Transform for response — include dimensions from metadata for proper previews
  const transformedItems = items.map(item => {
    let width: number | null = null
    let height: number | null = null
    if (item.metadata) {
      try {
        const meta = (() => { try { return JSON.parse(item.metadata) } catch { return {} } })()
        // Dimensions may be in runpodInput or at top level
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
