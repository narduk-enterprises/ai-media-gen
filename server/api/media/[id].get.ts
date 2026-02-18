/// <reference types="@cloudflare/workers-types" />

import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'

/**
 * Serves images from R2 storage by media item ID.
 * Falls back to redirecting base64 data URIs for legacy items.
 * Sets aggressive caching headers since generated images are immutable.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing media ID' })
  }

  // Try R2 first
  const cf = (event.context as any).cloudflare?.env
  const bucket: R2Bucket | undefined = cf?.MEDIA

  if (bucket) {
    const object = await bucket.get(id)
    if (object) {
      setResponseHeaders(event, {
        'Content-Type': object.httpMetadata?.contentType || 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': object.httpEtag,
      })

      // Stream the response body
      return object.body
    }
  }

  // Fallback: check D1 for legacy base64 items
  const db = useDatabase()
  const item = await db.select({ url: mediaItems.url })
    .from(mediaItems)
    .where(eq(mediaItems.id, id))
    .get()

  if (!item?.url) {
    throw createError({ statusCode: 404, message: 'Media not found' })
  }

  // If it's a base64 data URI, extract and serve it directly
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

  // If it's already a URL path, redirect
  return sendRedirect(event, item.url, 302)
})
