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
import { eq } from 'drizzle-orm'
import { mediaItems } from '../database/schema'
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
      const db = useDatabase()

      // Count processing jobs per pod URL
      const processing = await db.select({ metadata: mediaItems.metadata })
        .from(mediaItems)
        .where(eq(mediaItems.status, 'processing'))

      const jobCountByUrl = new Map<string, number>()
      for (const item of processing) {
        if (!item.metadata) continue
        try {
          const meta = JSON.parse(item.metadata)
          const podUrl = meta.apiUrl || meta.podUrl || ''
          if (podUrl) {
            jobCountByUrl.set(podUrl, (jobCountByUrl.get(podUrl) || 0) + 1)
          }
        } catch {}
      }

      // Pick pod with fewest active jobs
      let bestUrl = ''
      let bestCount = Infinity

      for (const pod of running) {
        const url = `https://${pod.id}-8188.proxy.runpod.net`
        const count = jobCountByUrl.get(url) || 0
        if (count < bestCount) {
          bestCount = count
          bestUrl = url
        }
      }

      if (bestUrl) {
        console.log(`[Router] → ${bestUrl} (${bestCount} active jobs, ${running.length} pods available)`)
        return bestUrl
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
