import { z } from 'zod'

const querySchema = z.object({
  url: z.string().url('A valid URL is required'),
})

/**
 * GET /api/generate/comfyui-health?url=http://...
 *
 * Proxy for checking GPU Pod health from the frontend (avoids CORS).
 * Hits the pod's /health endpoint which returns VRAM, disk, and GPU info.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parsed = querySchema.safeParse(query)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid URL' })
  }

  const podUrl = parsed.data.url.replace(/\/+$/, '')

  try {
    const health = await $fetch<{
      comfy: { status: string; vram_free_gb?: number; vram_total_gb?: number; gpu_name?: string }
      disk: { total_gb: number; used_gb: number; free_gb: number }
    }>(`${podUrl}/health`, {
      timeout: 8_000,
    })

    const vram = health.comfy.vram_total_gb
      ? `${Math.round(health.comfy.vram_total_gb)}GB VRAM`
      : undefined

    return {
      ok: health.comfy.status === 'running',
      mode: 'pod_server',
      vram,
      devices: health.comfy.gpu_name ? [health.comfy.gpu_name] : [],
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Could not reach server',
    }
  }
})
