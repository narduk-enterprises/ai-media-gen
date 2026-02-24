/**
 * GET /api/runpod/logs?podId=xxx&source=admin|comfy&lines=80
 *
 * Proxy log requests to the pod's admin server.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const podId = query.podId as string
  const source = (query.source as string) || 'admin'
  const lines = parseInt(query.lines as string) || 80

  if (!podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const podUrl = `https://${podId}-8188.proxy.runpod.net`

  try {
    const result = await $fetch<{ source: string; lines: string }>(`${podUrl}/logs`, {
      params: { source, lines },
      timeout: 8_000,
    })
    return { logs: result.lines || 'No log output yet' }
  } catch (e: any) {
    return { logs: `[Error fetching logs: ${e?.message || 'Pod may still be starting up'}]` }
  }
})
