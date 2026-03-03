/**
 * GET /api/runpod/pod-health?podId=xxx
 *
 * Proxy health check to the pod's admin server.
 * Returns live VRAM, disk usage, and ComfyUI status.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const podId = query.podId as string

  if (!podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const podUrl = `https://${podId}-8188.proxy.runpod.net`

  try {
    const result = await $fetch<{
      comfy: {
        status: string
        vram_free_gb?: number
        vram_total_gb?: number
        torch_vram_free_gb?: number
        gpu_name?: string
      }
      disk: {
        total_gb?: number
        used_gb?: number
        free_gb?: number
      }
    }>(`${podUrl}/health`, {
      timeout: 8_000,
    })
    return result
  } catch {
    return { comfy: { status: 'unreachable' }, disk: {} }
  }
})
