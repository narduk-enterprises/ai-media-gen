/**
 * HuggingFace CORS proxy — proxies model file requests to HuggingFace.
 *
 * HuggingFace sets `Access-Control-Allow-Origin: https://huggingface.co` on
 * their CDN, which blocks cross-origin fetches from custom domains. This
 * endpoint fetches server-side and returns the response with proper CORS.
 *
 * Supports both the `/resolve/main/` and `/api/resolve-cache/` HF URL patterns.
 *
 * Route: /api/hf-proxy/<org>/<repo>/resolve/main/<file>
 * Also:  /api/hf-proxy/api/resolve-cache/models/<org>/<repo>/<commit>/<file>
 */
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path')
  if (!path) {
    throw createError({ statusCode: 400, message: 'Missing path' })
  }

  // Only allow proxying mlc-ai model files
  if (!path.startsWith('mlc-ai/') && !path.startsWith('api/resolve-cache/models/mlc-ai/')) {
    throw createError({ statusCode: 403, message: 'Only mlc-ai models are allowed' })
  }

  const hfUrl = `https://huggingface.co/${path}`

  const response = await fetch(hfUrl, {
    headers: {
      'User-Agent': 'ai-media-gen/1.0',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      message: `HuggingFace returned ${response.status}`,
    })
  }

  // Forward content type
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  setResponseHeader(event, 'Content-Type', contentType)

  // Forward content length if available
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    setResponseHeader(event, 'Content-Length', contentLength)
  }

  // Allow caching (model files don't change once published)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=604800, immutable')

  // Set proper CORS headers
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')

  // Stream the response body directly to avoid buffering large files in memory
  return response.body
})
