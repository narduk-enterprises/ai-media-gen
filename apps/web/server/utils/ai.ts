/**
 * ai.ts — Smart GPU Pod routing with model-aware filtering.
 *
 * Auto-discovers running pods via RunPod API, checks live ComfyUI queue depth
 * AND synced model groups, then routes to the best pod that has the required models.
 *
 * Priority:
 *   1. Explicit URL override from frontend (backward compat for scripts)
 *   2. Best healthy pod with required models + lowest queue depth
 *   3. Profile-specific env vars (NUXT_POD_IMAGE_URL, NUXT_POD_VIDEO_URL)
 *   4. Global NUXT_COMFY_URL fallback
 */
import { getPodUrl } from './podClient'

export type EndpointType = string
export type PodProfile = 'image' | 'video' | 'full'

// Model groups that indicate a pod can handle video jobs
const VIDEO_GROUPS = ['wan22', 'ltx2', 'ltx2_camera']

// Max queue depth for image-only pods before we overflow to video machines
const IMAGE_POD_QUEUE_THRESHOLD = 50

interface PodHealth {
  url: string
  queueDepth: number
  syncedGroups: Record<string, { synced: boolean; partial: boolean }>
}

/**
 * Resolve the GPU Pod API URL with model-aware, least-loaded routing.
 *
 * @param urlOverride Explicit URL from client settings
 * @param _profile Legacy profile type
 * @param requiredGroups Model groups the job needs (e.g., ['wan22'] or ['pony'])
 */
export async function resolveApiUrl(
  urlOverride?: string,
  _profile?: PodProfile,
  requiredGroups?: string[],
  opts?: { skipImagePreference?: boolean },
): Promise<string> {
  // 1. Explicit URL from client settings or scripts
  if (urlOverride && (urlOverride.startsWith('http://') || urlOverride.startsWith('https://'))) {
    return urlOverride.replace(/\/+$/, '')
  }

  // 2. Smart routing: find best pod with required models + lowest queue
  try {
    const pods = await getRunPods()
    const running = pods.filter(p => p.status === 'RUNNING')

    if (running.length > 0) {
      const podUrls = running.map(p => `https://${p.id}-8188.proxy.runpod.net`)

      const healthResults = await Promise.allSettled(
        // eslint-disable-next-line nuxt-guardrails/no-map-async-in-server
        podUrls.map(async (url): Promise<PodHealth | null> => {
          try {
            const health = await $fetch<{
              comfy?: { status?: string; queue_pending?: number; queue_running?: number }
              synced_groups?: Record<string, { synced: boolean; partial: boolean }>
            }>(`${url}/health`, { timeout: 3_000 })

            // Skip pods where ComfyUI isn't running yet
            if (health.comfy?.status !== 'running') return null

            const pending = health.comfy?.queue_pending ?? 0
            const queueRunning = health.comfy?.queue_running ?? 0
            return {
              url,
              queueDepth: pending + queueRunning,
              syncedGroups: health.synced_groups ?? {},
            }
          } catch {
            return null
          }
        }),
      )

      const healthy = healthResults
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter((r): r is PodHealth => r !== null)

      if (healthy.length === 0) {
        console.warn(`[Router] ${running.length} pod(s) RUNNING but none healthy — still starting up?`)
      } else {
        // Filter by required model groups if specified
        let candidates = healthy
        if (requiredGroups && requiredGroups.length > 0) {
          const withModels = healthy.filter(pod =>
            requiredGroups.every(group => pod.syncedGroups[group]?.synced === true),
          )

          if (withModels.length > 0) {
            candidates = withModels
          } else {
            // No pod has all required groups fully synced — try partial matches
            const withPartial = healthy.filter(pod =>
              requiredGroups.every(group =>
                pod.syncedGroups[group]?.synced === true || pod.syncedGroups[group]?.partial === true,
              ),
            )
            if (withPartial.length > 0) {
              console.warn(`[Router] No pod fully synced for [${requiredGroups}], trying ${withPartial.length} partial match(es)`)
              candidates = withPartial
            } else {
              console.warn(`[Router] No pod has models [${requiredGroups}] — routing to least loaded and hoping for the best`)
              // Fall through with all healthy pods — the retry logic will handle failures
            }
          }
        }

        // ── Image-only pod preference ──
        // For image jobs, prefer image-only machines (no video models) if their
        // queues are short, reserving video-capable machines for video work.
        const isImageJob = !requiredGroups?.some(g => VIDEO_GROUPS.includes(g))
        let routeReason = ''
        if (isImageJob && candidates.length > 1 && !opts?.skipImagePreference) {
          const imageOnly = candidates.filter(pod =>
            !VIDEO_GROUPS.some(vg => pod.syncedGroups[vg]?.synced === true),
          )
          const imageOnlyAvailable = imageOnly.filter(p => p.queueDepth < IMAGE_POD_QUEUE_THRESHOLD)

          if (imageOnlyAvailable.length > 0) {
            candidates = imageOnlyAvailable
            routeReason = ` [preferred ${imageOnlyAvailable.length} image-only pod(s), threshold<${IMAGE_POD_QUEUE_THRESHOLD}]`
          } else if (imageOnly.length > 0) {
            routeReason = ` [image-only pods full (${imageOnly.map(p => `q${p.queueDepth}`).join(',')}≥${IMAGE_POD_QUEUE_THRESHOLD}), overflowing to video machines]`
          }
        }

        // Pick pod with lowest queue depth
        candidates.sort((a, b) => a.queueDepth - b.queueDepth)
        const best = candidates[0]!
        const summary = candidates.map((h) => {
          const id = new URL(h.url).hostname.split('-8188')[0]
          const groups = Object.entries(h.syncedGroups)
            .filter(([, v]) => v.synced === true)
            .map(([k]) => k)
          return `${id}=q${h.queueDepth}[${groups.join(',')}]`
        }).join(', ')
        const needed = requiredGroups?.length ? ` needs:[${requiredGroups}]` : ''
        console.log(`[Router] → ${best.url} (queue: ${best.queueDepth}${needed}${routeReason}) [${summary}]`)
        return best.url
      }
    }
  } catch (e) {
    // RunPod API may be unavailable — fall through to env vars
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[Router] RunPod API unavailable, falling back to env vars: ${msg}`)
  }

  // 3. Profile-specific env var fallback
  if (_profile) {
    try {
      const config = useRuntimeConfig()
      const typedConfig = config as unknown as { podImageUrl?: string; podVideoUrl?: string }
      if (_profile === 'image' && typedConfig.podImageUrl) {
        return typedConfig.podImageUrl.replace(/\/+$/, '')
      }
      if (_profile === 'video' && typedConfig.podVideoUrl) {
        return typedConfig.podVideoUrl.replace(/\/+$/, '')
      }
    } catch { }
  }

  // 4. Global fallback
  return getPodUrl()
}

/**
 * Determine which model groups a job requires based on its ComfyUI input.
 * Used by the queue processor to pass to resolveApiUrl for model-aware routing.
 */
export function getRequiredGroups(input: Record<string, unknown>): string[] {
  const groups = new Set<string>()
  const action = (input.action as string) || ''
  const json = JSON.stringify(input).toLowerCase()

  if (['text2video', 'image2video', 'multi_segment_video'].includes(action)) {
    // Only search for video models for video actions to avoid matching words in prompts (like 'pony')
    if (json.includes('ltxv') || json.includes('ltx2') || json.includes('ltx-video')) groups.add('ltx2')
    if (json.includes('wan2.2') || json.includes('wan_2.1') || json.includes('wan22')) groups.add('wan22')

    // Default video model if none matched
    if (groups.size === 0) groups.add('wan22')
  } else if (['text2image', 'image2image'].includes(action)) {
    // Only search for image models for image actions
    if (json.includes('cyberrealisticpony') || json.includes('pony')) groups.add('pony')
    if (json.includes('juggernaut')) groups.add('juggernaut')
    if (json.includes('epicrealism') || json.includes('hyperbeast') || json.includes('porn_craft') || json.includes('porncraft')) groups.add('extra_checkpoints')
    if (json.includes('nsfw_sdxl')) { groups.add('extra_checkpoints'); groups.add('z_image_turbo') }
    if (json.includes('flux') || json.includes('flux2')) groups.add('flux2')
  } else if (action === 'upscale' || action === 'upscale_video') {
    groups.add('upscale')
  } else {
    // Fallback for unknown actions (e.g., custom raw workflows)
    if (json.includes('cyberrealisticpony') || json.includes('pony')) groups.add('pony')
    if (json.includes('juggernaut')) groups.add('juggernaut')
    if (json.includes('epicrealism') || json.includes('hyperbeast') || json.includes('porn_craft') || json.includes('porncraft')) groups.add('extra_checkpoints')
    if (json.includes('nsfw_sdxl')) { groups.add('extra_checkpoints'); groups.add('z_image_turbo') }
    if (json.includes('flux') || json.includes('flux2')) groups.add('flux2')
    if (json.includes('wan2.2') || json.includes('wan_2.1') || json.includes('wan22')) groups.add('wan22')
    if (json.includes('ltxv') || json.includes('ltx2') || json.includes('ltx-video')) groups.add('ltx2')
    if (json.includes('realesrgan') || json.includes('upscale')) groups.add('upscale')
  }

  // LLM components (used for prompt enhancement, captioning, etc.)
  if (json.includes('qwen')) groups.add('shared')

  return [...groups]
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
  input: Record<string, unknown>,
  apiUrl?: string,
): Promise<unknown> {
  const url = await resolveApiUrl(apiUrl)

  const response = await $fetch<unknown>(`${url}/runsync`, {
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
  input: Record<string, unknown>,
  apiUrl?: string,
): Promise<{ jobId: string; apiUrl: string }> {
  const url = await resolveApiUrl(apiUrl)

  const response = await $fetch<{ id?: string; job_id?: string; prompt_id?: string }>(`${url}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { input },
    timeout: 30_000,
  })

  return {
    jobId: (response.id || response.job_id || response.prompt_id)!,
    apiUrl: url,
  }
}
