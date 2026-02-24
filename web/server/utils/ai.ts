/**
 * ai.ts — Smart GPU Pod routing.
 *
 * Auto-discovers running pods via RunPod API, counts active jobs per pod
 * in D1, and routes to the least-loaded pod.
 *
 * Priority:
 *   1. Explicit URL override from frontend (backward compat for scripts)
 *   2. Least-loaded running pod (fewest processing items in D1)
 *   3. Profile-specific env vars (NUXT_POD_IMAGE_URL, NUXT_POD_VIDEO_URL)
 *   4. Global NUXT_COMFY_URL fallback
 */
import { getPodUrl } from './podClient'

export type EndpointType = string
export type PodProfile = 'image' | 'video' | 'full'

/**
 * Resolve the GPU Pod API URL with smart least-loaded routing.
 *
 * This is an async function — all callers are inside async API route handlers.
 */
export async function resolveApiUrl(urlOverride?: string, _profile?: PodProfile): Promise<string> {
  // 1. Explicit URL from client settings or scripts
  if (urlOverride && (urlOverride.startsWith('http://') || urlOverride.startsWith('https://'))) {
    return urlOverride.replace(/\/+$/, '')
  }

  // 2. Smart routing: find least-loaded running pod
  try {
    const pods = await getRunPods()
    const running = pods.filter(p => p.status === 'RUNNING')

    if (running.length > 0) {
      // Health-check all pods in parallel — returns queue depth for real-time load balancing
      const podUrls = running.map(p => `https://${p.id}-8188.proxy.runpod.net`)

      type HealthResult = { url: string; queueDepth: number }
      const healthResults = await Promise.allSettled(
        podUrls.map(async (url): Promise<HealthResult | null> => {
          try {
            const health = await $fetch<{
              comfy?: { status?: string; queue_pending?: number; queue_running?: number }
            }>(`${url}/health`, { timeout: 3_000 })

            // Skip pods where ComfyUI isn't running yet
            if (health.comfy?.status !== 'running') return null

            const pending = health.comfy?.queue_pending ?? 0
            const running = health.comfy?.queue_running ?? 0
            return { url, queueDepth: pending + running }
          } catch {
            return null
          }
        }),
      )

      const healthy = healthResults
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter((r): r is HealthResult => r !== null)

      if (healthy.length === 0) {
        console.warn(`[Router] ${running.length} pod(s) RUNNING but none healthy — still starting up?`)
        // Fall through to env var fallback
      } else {
        // Pick pod with lowest queue depth (ties go to first found)
        healthy.sort((a, b) => a.queueDepth - b.queueDepth)
        const best = healthy[0]!
        const summary = healthy.map(h => `${new URL(h.url).hostname.split('-8188')[0]}=${h.queueDepth}`).join(', ')
        console.log(`[Router] → ${best.url} (queue: ${best.queueDepth}, ${healthy.length}/${running.length} pods healthy) [${summary}]`)
        return best.url
      }
    }
  } catch (e: any) {
    // RunPod API may be unavailable — fall through to env vars
    console.warn(`[Router] RunPod API unavailable, falling back to env vars: ${e.message}`)
  }

  // 3. Profile-specific env var fallback
  if (_profile) {
    try {
      const config = useRuntimeConfig() as any
      if (_profile === 'image' && config.podImageUrl) {
        return config.podImageUrl.replace(/\/+$/, '')
      }
      if (_profile === 'video' && config.podVideoUrl) {
        return config.podVideoUrl.replace(/\/+$/, '')
      }
    } catch {}
  }

  // 4. Global fallback
  return getPodUrl()
}

/**
 * Legacy callRunPod — proxies to the pod's admin API.
 *
 * The pod server dispatches based on `input.action`:
 *   - clear_queue, get_queue, queue_delete → pod admin endpoints
 *   - caption → captioning service
 *   - prompt_remix → prompt remix service
 *
 * For generation actions (text2video, image2video, etc.),
 * use submitItemToPod() via the queue system instead.
 */
export async function callRunPod(
  input: Record<string, any>,
  apiUrl?: string,
): Promise<any> {
  const url = await resolveApiUrl(apiUrl)

  const response = await $fetch<any>(`${url}/runsync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { input },
    timeout: 120_000,
  })

  return response
}

/**
 * Legacy async RunPod call — submits job and returns { jobId, apiUrl }.
 * Used by older code paths that haven't been migrated to podClient yet.
 */
export async function callRunPodAsync(
  input: Record<string, any>,
  apiUrl?: string,
): Promise<{ jobId: string; apiUrl: string }> {
  const url = await resolveApiUrl(apiUrl)

  const response = await $fetch<any>(`${url}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { input },
    timeout: 30_000,
  })

  return {
    jobId: response.id || response.job_id || response.prompt_id,
    apiUrl: url,
  }
}
