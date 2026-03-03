import type { H3Event } from 'h3'

/**
 * Get the R2 media bucket binding from the Cloudflare environment.
 * Returns null when running locally without R2 bindings.
 */
export function useMediaBucket(event: H3Event): R2Bucket | null {
    const env = event.context.cloudflare?.env as Record<string, unknown> | undefined
    return (env?.MEDIA_BUCKET as R2Bucket) ?? null
}

/**
 * Read an object from R2 and return its content as a base64-encoded string.
 */
export async function readBase64FromR2(bucket: R2Bucket, key: string): Promise<string | null> {
    const obj = await bucket.get(key)
    if (!obj) return null
    const buf = await obj.arrayBuffer()
    const uint8 = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]!)
    }
    return btoa(binary)
}

/**
 * Upload base64-encoded media to R2 and return the serving URL.
 */
export async function uploadImageToR2(
    bucket: R2Bucket,
    key: string,
    base64Data: string,
    contentType: string,
): Promise<string> {
    const binary = atob(base64Data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    await bucket.put(key, bytes.buffer, {
        httpMetadata: { contentType },
    })
    return `/api/media/${key}`
}

/**
 * Write a base64-encoded string to R2 as an object.
 */
export async function writeBase64ToR2(
    bucket: R2Bucket,
    key: string,
    base64: string,
    contentType: string,
): Promise<void> {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    await bucket.put(key, bytes.buffer, {
        httpMetadata: { contentType },
    })
}
