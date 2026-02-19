import { eq } from 'drizzle-orm'
import { useMediaBucket } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

/**
 * Emergency video upload endpoint.
 * Accepts a video file directly and uploads it to R2, updating D1.
 *
 * POST /api/generate/emergency-upload
 * Headers:
 *   X-Media-Item-Id: the media_items.id to attach this video to
 * Body: raw video/mp4 binary
 *
 * If no matching media item exists, creates orphan records.
 */
export default defineEventHandler(async (event) => {
  const db = useDatabase()
  const mediaBucket = useMediaBucket(event)

  if (!mediaBucket) {
    throw createError({ statusCode: 503, message: 'R2 bucket not available' })
  }

  const mediaItemId = getHeader(event, 'x-media-item-id')
  const videoFilename = getHeader(event, 'x-video-filename') || 'unknown.mp4'

  // Read raw body as binary
  const body = await readRawBody(event, false)
  if (!body) {
    throw createError({ statusCode: 400, message: 'No body' })
  }

  // Convert to ArrayBuffer
  let arrayBuffer: ArrayBuffer
  if (body instanceof ArrayBuffer) {
    arrayBuffer = body
  } else if (typeof body === 'string') {
    const encoder = new TextEncoder()
    arrayBuffer = encoder.encode(body).buffer
  } else if (Buffer.isBuffer(body)) {
    arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  } else {
    arrayBuffer = (body as any).buffer || body
  }

  const bytes = new Uint8Array(arrayBuffer)
  const sizeMB = (bytes.length / 1024 / 1024).toFixed(2)

  // Generate a key for R2
  const r2Key = mediaItemId || `video-${videoFilename}-${Date.now()}`

  // Upload to R2
  await mediaBucket.put(r2Key, bytes.buffer, {
    httpMetadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  const url = `/api/media/${r2Key}`

  // If we have a media item ID, update the D1 record
  if (mediaItemId) {
    const existing = await db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1)
    if (existing.length > 0) {
      await db.update(mediaItems)
        .set({ url, status: 'complete', error: null })
        .where(eq(mediaItems.id, mediaItemId))

      // Also update the parent generation status
      const genId = existing[0]!.generationId
      const allItems = await db.select().from(mediaItems).where(eq(mediaItems.generationId, genId))
      const allResolved = allItems.every(i =>
        i.id === mediaItemId ? true : (i.status === 'complete' || i.status === 'failed')
      )
      if (allResolved) {
        const anyFailed = allItems.some(i => i.id !== mediaItemId && i.status === 'failed')
        await db.update(generations)
          .set({ status: anyFailed ? 'partial' : 'complete' })
          .where(eq(generations.id, genId))
      }

      return { ok: true, url, mediaItemId, sizeMB, updated: true }
    }
  }

  return { ok: true, url, r2Key, sizeMB, updated: false, note: 'Uploaded but no matching D1 record found' }
})
