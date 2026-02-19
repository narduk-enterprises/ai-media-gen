import { eq } from 'drizzle-orm'
import { useMediaBucket } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

/**
 * Reconcile R2 video files with D1 records.
 *
 * Scans R2 for `video-` prefixed objects (bulk-uploaded from pod),
 * creates new media_items for any that aren't already tracked in D1.
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

  // 1. List all video-* objects in R2 (bulk-uploaded from pod)
  const videoKeys: Array<{ key: string, size: number }> = []
  let cursor: string | undefined
  let listCount = 0
  do {
    const list = await bucket.list({ prefix: 'video-', cursor, limit: 500 })
    for (const obj of list.objects) {
      videoKeys.push({ key: obj.key, size: obj.size })
    }
    cursor = list.truncated ? list.cursor : undefined
    listCount++
    if (listCount > 20) break // safety
  } while (cursor)

  // 2. Find which R2 keys already have D1 media_items (by checking metadata.originalR2Key)
  const existingItems = await db.select({
    id: mediaItems.id,
    metadata: mediaItems.metadata,
    url: mediaItems.url,
  })
    .from(mediaItems)
    .where(eq(mediaItems.type, 'video'))
    .all()

  const trackedKeys = new Set<string>()
  const existingUrls = new Set<string>()
  for (const item of existingItems) {
    if (item.url) existingUrls.add(item.url)
    if (item.metadata) {
      try {
        const meta = JSON.parse(item.metadata)
        if (meta.originalR2Key) trackedKeys.add(meta.originalR2Key)
      }
      catch {}
    }
  }

  // Also check by URL pattern (items already pointing to these R2 keys)
  const unlinkedKeys = videoKeys.filter(({ key }) => {
    const url = `/api/media/${key}`
    return !trackedKeys.has(key) && !existingUrls.has(url)
  })

  if (dryRun) {
    return {
      totalR2Videos: videoKeys.length,
      alreadyTracked: videoKeys.length - unlinkedKeys.length,
      unlinked: unlinkedKeys.length,
      unlinkedSample: unlinkedKeys.slice(0, 10),
      message: 'Dry run — no changes made',
    }
  }

  // 3. Create a single "recovered" generation to group these items
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

  // 4. Create D1 media_items pointing to existing R2 keys
  let successCount = 0
  let errorCount = 0
  const results: Array<{ key: string, mediaId: string, status: string }> = []

  for (const { key, size } of unlinkedKeys) {
    try {
      const mediaId = crypto.randomUUID()

      // Copy R2 object to UUID-keyed entry for proper serving
      const obj = await bucket.get(key)
      if (!obj) {
        results.push({ key, mediaId, status: 'skipped-not-found' })
        continue
      }

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
          sizeMB: (size / 1024 / 1024).toFixed(2),
        }),
        createdAt: now,
        prompt: 'Recovered video from pod',
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
    processed: unlinkedKeys.length,
    success: successCount,
    errors: errorCount,
    generationId: genId,
    results: results.slice(0, 50),
  }
})
