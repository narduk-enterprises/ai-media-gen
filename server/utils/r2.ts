/**
 * R2 media storage utilities.
 * Stores generated images as binary in Cloudflare R2 instead of base64 in D1.
 */

/// <reference types="@cloudflare/workers-types" />

/**
 * Get the R2 MEDIA bucket from the Cloudflare event context.
 */
export function useMediaBucket(event: any): R2Bucket | null {
  const cf = (event.context as any).cloudflare?.env
  return cf?.MEDIA ?? null
}

/**
 * Upload a base64 image to R2 and return the serving path.
 * @param bucket - R2 bucket instance
 * @param key - unique key (usually the media item ID)
 * @param base64Data - raw base64 string (no data: prefix)
 * @param contentType - MIME type, defaults to image/png
 * @returns the public serving path `/api/media/{key}`
 */
export async function uploadImageToR2(
  bucket: R2Bucket,
  key: string,
  base64Data: string,
  contentType = 'image/png',
): Promise<string> {
  // Convert base64 to binary
  const binaryStr = atob(base64Data)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }

  await bucket.put(key, bytes.buffer, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  return `/api/media/${key}`
}
