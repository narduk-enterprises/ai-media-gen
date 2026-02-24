/**
 * ai.ts — GPU Pod API routing.
 *
 * Resolves the correct pod URL for a given generation profile.
 * Supports multi-pod routing: image pods, video pods, or full pods.
 *
 * Profile routing is determined server-side:
 *   - Each API route specifies its profile ('image' or 'video')
 *   - The resolver checks pod URLs stored in env/runtime config
 *   - Falls back to a single URL for backward compatibility
 */
import { getPodUrl } from './podClient'

export type EndpointType = string
export type PodProfile = 'image' | 'video' | 'full'

/**
 * Resolve the GPU Pod API URL, considering pod profiles.
 *
 * Priority:
 *   1. Explicit URL override from the frontend (backward compatible)
 *   2. Profile-specific pod URL from env (NUXT_POD_IMAGE_URL, NUXT_POD_VIDEO_URL)
 *   3. Global NUXT_COMFY_URL fallback
 */
export function resolveApiUrl(urlOverride?: string, profile?: PodProfile): string {
  // 1. Explicit URL from client settings
  if (urlOverride && (urlOverride.startsWith('http://') || urlOverride.startsWith('https://'))) {
    return urlOverride.replace(/\/+$/, '')
  }

  // 2. Profile-specific pod URL from env
  if (profile) {
    try {
      const config = useRuntimeConfig() as any
      if (profile === 'image' && config.podImageUrl) {
        return config.podImageUrl.replace(/\/+$/, '')
      }
      if (profile === 'video' && config.podVideoUrl) {
        return config.podVideoUrl.replace(/\/+$/, '')
      }
    } catch {}
  }

  // 3. Global fallback
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
  const url = resolveApiUrl(apiUrl)

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
  const url = resolveApiUrl(apiUrl)

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
