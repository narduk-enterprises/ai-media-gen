/**
 * ai.ts — Backward-compatible shim.
 *
 * Routes that still import callRunPod/resolveApiUrl from here will
 * get working implementations. These routes are candidates for cleanup
 * in Phase 2 when we consolidate to fewer endpoints.
 */
import { getPodUrl } from './podClient'

export type EndpointType = string

/**
 * Resolve the GPU Pod API URL.
 * Accepts a direct URL string or falls back to NUXT_COMFY_URL config.
 */
export function resolveApiUrl(urlOverride?: string): string {
  if (urlOverride && (urlOverride.startsWith('http://') || urlOverride.startsWith('https://'))) {
    return urlOverride.replace(/\/+$/, '')
  }
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
