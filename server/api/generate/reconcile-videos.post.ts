import { eq } from 'drizzle-orm'
import { useMediaBucket } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

/**
 * Reconcile R2 video files with D1 records.
 *
 * Scans R2 for `video/` prefixed objects (bulk-uploaded from pod),
 * creates new media_items for any that aren't already tracked in D1,
 * and re-keys them to proper UUID-based keys for serving.
 *
 * Deduplication: tracks the original R2 key in metadata to prevent
 * creating duplicates on repeated calls.
 *
 * POST /api/generate/reconcile-videos
 * Body: { dryRun?: boolean }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const dryRun = body?.dryRun === true

  const bucket = useMediaBucket(event)
  if (!bucket) {
    throw createError({ statusCode: 500, message: 'R2 bucket not available' })
  }

  const db = useDatabase()

  // 1. List all video/* objects in R2
  const videoKeys: string[] = []
  let cursor: string | undefined
  let listCount = 0
  do {
    const list = await bucket.list({ prefix: 'video/', cursor, limit: 500 })
    for (const obj of list.objects) {
      videoKeys.push(obj.key)
    }
    cursor = list.truncated ? list.cursor : undefined
    listCount++
    if (listCount > 20) break // safety
  } while (cursor)

  // 2. Find which video keys are already tracked in D1 metadata
  //    We store the original R2 key in metadata.originalR2Key
  const existingItems = await db.select({
    id: mediaItems.id,
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
        if (meta.originalR2Key) {
          trackedKeys.add(meta.originalR2Key)
        }
      }
      catch {}
    }
  }

  // 3. Filter to unlinked keys
  const unlinkedKeys = videoKeys.filter(k => !trackedKeys.has(k))

  if (dryRun) {
    return {
      totalR2Videos: videoKeys.length,
      alreadyTracked: trackedKeys.size,
      unlinked: unlinkedKeys.length,
      unlinkedKeys: unlinkedKeys.slice(0, 20),
      message: 'Dry run — no changes made',
    }
  }

  // 4. Create a single "recovered" generation to group these items
  const genId = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.insert(generations).values({
    id: genId,
    userId: 'system',
    prompt: 'Recovered videos from pod bulk upload',
    imageCount: unlinkedKeys.length,
    status: 'complete',
    createdAt: now,
    settings: JSON.stringify({ source: 'reconcile-videos', recoveredAt: now }),
  })

  // 5. For each unlinked key, copy to UUID key and create media_item
  const results: Array<{ key: string, mediaId: string, status: string }> = []
  let successCount = 0
  let errorCount = 0

  for (const key of unlinkedKeys) {
    try {
      const mediaId = crypto.randomUUID()

      // Read original object
      const obj = await bucket.get(key)
      if (!obj) {
        results.push({ key, mediaId, status: 'skipped-not-found' })
        continue
      }

      // Copy to UUID key
      const data = await obj.arrayBuffer()
      await bucket.put(mediaId, data, {
        httpMetadata: {
          contentType: 'video/mp4',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      })

      // Create D1 record
      await db.insert(mediaItems).values({
        id: mediaId,
        generationId: genId,
        type: 'video',
        url: `/api/media/${mediaId}`,
        status: 'complete',
        metadata: JSON.stringify({
          originalR2Key: key,
          recoveredAt: now,
          sizeMB: (data.byteLength / 1024 / 1024).toFixed(2),
        }),
        createdAt: now,
        prompt: `Recovered from ${key}`,
      })

      results.push({ key, mediaId, status: 'created' })
      successCount++
    }
    catch (err: any) {
      results.push({ key, mediaId: '', status: `error: ${err.message}` })
      errorCount++
    }
  }

  return {
    totalR2Videos: videoKeys.length,
    alreadyTracked: trackedKeys.size,
    processed: unlinkedKeys.length,
    success: successCount,
    errors: errorCount,
    generationId: genId,
    results,
  }
})
