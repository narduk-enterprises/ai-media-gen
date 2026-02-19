import { eq } from 'drizzle-orm'
import { useMediaBucket } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

/**
 * Reconcile R2 video files with D1 records.
 *
 * Scans R2 for `video-` prefixed objects (bulk-uploaded from pod),
 * deduplicates by original filename (keeps latest), creates new
 * media_items pointing to existing R2 keys (no copy needed).
 *
 * POST /api/generate/reconcile-videos
 * Body: { dryRun?: boolean, batch?: number }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const dryRun = body?.dryRun === true
  const batchSize = Math.min(body?.batch || 50, 200)

  const bucket = useMediaBucket(event)
  if (!bucket) {
    throw createError({ statusCode: 500, message: 'R2 bucket not available' })
  }

  const db = useDatabase()

  // 1. List all video-* objects in R2
  const allVideoKeys: Array<{ key: string, size: number }> = []
  let cursor: string | undefined
  do {
    const list = await bucket.list({ prefix: 'video-', cursor, limit: 500 })
    for (const obj of list.objects) {
      if (obj.size < 1000) continue
      allVideoKeys.push({ key: obj.key, size: obj.size })
    }
    cursor = list.truncated ? list.cursor : undefined
  } while (cursor)

  // 2. Deduplicate by original filename — keep latest timestamp
  const byFilename = new Map<string, { key: string, size: number, ts: number }>()
  for (const { key, size } of allVideoKeys) {
    const lastDash = key.lastIndexOf('-')
    const ts = parseInt(key.slice(lastDash + 1), 10)
    const filename = key.slice(6, lastDash)
    const existing = byFilename.get(filename)
    if (!existing || ts > existing.ts) {
      byFilename.set(filename, { key, size, ts })
    }
  }
  const uniqueKeys = Array.from(byFilename.values())

  // 3. Check which are already tracked in D1 metadata
  const existingItems = await db.select({
    metadata: mediaItems.metadata,
  })
    .from(mediaItems)
    .where(eq(mediaItems.type, 'video'))
    .all()

  const trackedKeys = new Set<string>()
  for (const item of existingItems) {
    if (item.metadata) {
      try {
        const meta = JSON.parse(item.metadata)
        if (meta.originalR2Key) trackedKeys.add(meta.originalR2Key)
      }
      catch {}
    }
  }

  const unlinkedKeys = uniqueKeys.filter(({ key }) => !trackedKeys.has(key))

  if (dryRun) {
    return {
      totalR2Raw: allVideoKeys.length,
      uniqueVideos: uniqueKeys.length,
      alreadyTracked: uniqueKeys.length - unlinkedKeys.length,
      toProcess: unlinkedKeys.length,
      sample: unlinkedKeys.slice(0, 5),
    }
  }

  // 4. Process in batch
  const batch = unlinkedKeys.slice(0, batchSize)
  if (batch.length === 0) {
    return { done: true, message: 'All videos already tracked' }
  }

  // Create a generation for this batch
  const genId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.insert(generations).values({
    id: genId,
    userId: 'system',
    prompt: 'Recovered videos from pod',
    imageCount: batch.length,
    status: 'complete',
    createdAt: now,
  })

  // 5. Create D1 records pointing to existing R2 keys (NO copy)
  let successCount = 0
  for (const { key, size } of batch) {
    try {
      const mediaId = crypto.randomUUID()
      await db.insert(mediaItems).values({
        id: mediaId,
        generationId: genId,
        type: 'video',
        url: `/api/media/${mediaId}`,
        status: 'complete',
        metadata: JSON.stringify({
          originalR2Key: key,
          sizeMB: (size / 1024 / 1024).toFixed(2),
        }),
        createdAt: now,
        prompt: 'Recovered video',
      })
      successCount++
    }
    catch {}
  }

  return {
    generationId: genId,
    success: successCount,
    remaining: unlinkedKeys.length - batch.length,
  }
})
