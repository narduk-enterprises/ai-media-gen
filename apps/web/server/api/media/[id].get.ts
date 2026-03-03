/// <reference types="@cloudflare/workers-types" />

import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'


/**
 * Serves media from R2 by media item ID.
 * Fallback chain:
 *   1. Direct R2 lookup by ID
 *   2. D1 metadata.originalR2Key → R2 lookup
 *   3. Legacy base64 data URI in D1
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing media ID' })
  }

  const bucket = useMediaBucket(event)
  const db = useDatabase(event)

  if (bucket) {
    let object = await bucket.get(id)

    // Fallback: check D1 metadata for alternative R2 key
    if (!object) {
      try {
        const lookupItem = await db.select({ metadata: mediaItems.metadata })
          .from(mediaItems)
          .where(eq(mediaItems.id, id))
          .get()
        if (lookupItem?.metadata) {
          let meta: any = {}
          try { meta = JSON.parse(lookupItem.metadata) } catch {}
          if (meta.originalR2Key) {
            object = await bucket.get(meta.originalR2Key)
          }
        }
      }
      catch {}
    }

    if (object) {
      const contentType = object.httpMetadata?.contentType || 'video/mp4'
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Accept-Ranges': 'bytes',
      }
      if (object.size) {
        headers['Content-Length'] = String(object.size)
      }
      setResponseHeaders(event, headers)
      setResponseStatus(event, 200)
      return sendStream(event, object.body as any)
    }
  }

  // D1 fallback for legacy base64
  const item = await db.select({ url: mediaItems.url })
    .from(mediaItems)
    .where(eq(mediaItems.id, id))
    .get()

  if (!item?.url) {
    throw createError({ statusCode: 404, message: 'Media not found' })
  }

  const base64Match = item.url.match(/^data:([\w/+.-]+);base64,(.+)$/)
  if (base64Match) {
    const contentType = base64Match[1]!
    const base64Data = base64Match[2]!
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    setResponseHeaders(event, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    return send(event, bytes)
  }

  // Prevent self-redirect loops
  if (item.url.startsWith('/api/media/')) {
    throw createError({ statusCode: 404, message: `R2 object missing for ${id}` })
  }

  return sendRedirect(event, item.url, 302)
})
