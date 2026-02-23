/**
 * podClient.ts — Thin proxy to the GPU Pod Admin API v2.0.
 *
 * Replaces comfyui.ts + workflows.ts. The pod handles workflow building,
 * image upload, video stitching, and ffmpeg internally.
 *
 * API shape matches the pod's OpenAPI spec at /openapi.json.
 */

// ── Types (from OpenAPI spec) ──────────────────────────────────

export interface SegmentInput {
  /** Base64-encoded image (PNG/JPEG) — optional for T2V */
  image?: string
  /** Motion/scene prompt for this segment */
  prompt: string
  /** Number of frames (25-721), default 121 */
  frames?: number
  /** Inference steps, default 20 */
  steps?: number
  /** Random seed (-1 for random) */
  seed?: number
  /** Camera motion LoRA name */
  camera_lora?: string
  /** I2V preset name */
  preset?: string
}

export interface MultiSegmentRequest {
  segments: SegmentInput[]
  model?: 'ltx2' | 'wan22'
  width?: number
  height?: number
  fps?: number
  transition?: 'crossfade' | 'cut'
  transition_duration?: number
}

export interface MultiSegmentResponse {
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  video_base64?: string
  duration_seconds?: number
  segments_completed?: number
  segments_total?: number
}

export interface GenerationStatus {
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  current_segment?: number
  segments_total?: number
  log?: string
  error?: string | null
  video_base64?: string | null
  image_base64?: string | null
}

export interface HealthResponse {
  comfy: {
    status: 'running' | 'stopped'
    vram_free_gb?: number
    vram_total_gb?: number
    torch_vram_free_gb?: number
    gpu_name?: string
  }
  disk: {
    total_gb: number
    used_gb: number
    free_gb: number
  }
  admin_port: number
  comfy_port: number
}

export interface ModelFile {
  name: string
  size_mb: number
}

export interface SyncState {
  running: boolean
  log: string
  started_at: number | null
  finished_at: number | null
  exit_code: number | null
}

/**
 * Result shape expected by completeMediaItem().
 * Maintains backward compatibility with RunPodResult.
 */
export interface JobResult {
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'IN_QUEUE'
  output?: { output?: { data?: string; filename?: string; type?: string } }
  error?: string
  /** Segment progress info */
  currentSegment?: number
  segmentsTotal?: number
}

// ── Config ─────────────────────────────────────────────────────

/**
 * Get the GPU Pod URL from NUXT_COMFY_URL env var (optional fallback).
 * The primary URL source is the per-request `endpoint` param from
 * client-side settings / stored metadata. This only provides a fallback.
 */
export function getPodUrl(): string {
  try {
    const config = useRuntimeConfig()
    const comfyUrl = (config as any).comfyUrl
    if (comfyUrl) return comfyUrl.replace(/\/+$/, '')
  } catch {}
  return ''
}

// ── Job Submission ─────────────────────────────────────────────

/**
 * Submit a multi-segment video generation job to the pod.
 * Returns the pod's { job_id, status }.
 *
 * The pod handles workflow building, image upload, and stitching internally.
 */
export async function submitJob(
  request: MultiSegmentRequest,
  podUrl?: string,
): Promise<MultiSegmentResponse> {
  const url = podUrl || getPodUrl()

  const response = await $fetch<MultiSegmentResponse>(`${url}/generate/multi-segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: request,
    timeout: 30_000,
  })

  return response
}

/**
 * Submit a text-to-image job.
 */
export async function submitText2Image(
  input: Record<string, any>,
  podUrl?: string,
): Promise<{ job_id: string; status: string }> {
  const url = podUrl || getPodUrl()
  return await $fetch(`${url}/generate/text2image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      prompt: input.prompt,
      negative_prompt: input.negative_prompt,
      width: input.width,
      height: input.height,
      steps: input.steps,
      seed: input.seed,
      model: input.model || 'wan22',
      lora_strength: input.lora_strength,
    },
    timeout: 30_000,
  })
}

/**
 * Submit an image-to-image job.
 */
export async function submitImage2Image(
  input: Record<string, any>,
  podUrl?: string,
): Promise<{ job_id: string; status: string }> {
  const url = podUrl || getPodUrl()
  return await $fetch(`${url}/generate/image2image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      image: input.image,
      prompt: input.prompt,
      negative_prompt: input.negative_prompt,
      width: input.width,
      height: input.height,
      steps: input.steps,
      cfg: input.cfg,
      denoise: input.denoise,
      seed: input.seed,
      model: input.model || 'wan22',
    },
    timeout: 30_000,
  })
}

/**
 * Submit an image-to-video job.
 */
export async function submitImage2Video(
  input: Record<string, any>,
  podUrl?: string,
): Promise<{ job_id: string; status: string }> {
  const url = podUrl || getPodUrl()
  return await $fetch(`${url}/generate/image2video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      image: input.image,
      prompt: input.prompt,
      negative_prompt: input.negative_prompt,
      width: input.width,
      height: input.height,
      frames: input.frames || input.num_frames,
      steps: input.steps,
      fps: input.fps,
      seed: input.seed,
      model: input.model || 'ltx2',
      camera_lora: input.camera_lora,
      preset: input.preset,
    },
    timeout: 30_000,
  })
}

/**
 * Submit a text-to-video job.
 */
export async function submitText2Video(
  input: Record<string, any>,
  podUrl?: string,
): Promise<{ job_id: string; status: string }> {
  const url = podUrl || getPodUrl()
  return await $fetch(`${url}/generate/text2video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      prompt: input.prompt,
      negative_prompt: input.negative_prompt,
      width: input.width,
      height: input.height,
      frames: input.frames || input.num_frames,
      steps: input.steps,
      fps: input.fps,
      seed: input.seed,
      model: input.model || 'wan22',
      lora_strength: input.lora_strength,
      camera_lora: input.camera_lora,
      audio_prompt: input.audio_prompt,
    },
    timeout: 30_000,
  })
}

/**
 * Submit a multi-segment video job.
 * Strips fields not in the pod's MultiSegmentRequest schema to avoid 400s.
 */
export async function submitMultiSegmentVideo(
  input: Record<string, any>,
  podUrl?: string,
): Promise<{ job_id: string; status: string }> {
  const url = podUrl || getPodUrl()
  const body: Record<string, any> = {
    segments: (input.segments || []).map((s: any) => ({
      image: s.image || 'auto',
      prompt: s.prompt || '',
      ...(s.frames ? { frames: s.frames } : {}),
      ...(s.steps ? { steps: s.steps } : {}),
      ...(s.seed != null ? { seed: s.seed } : {}),
      ...(s.camera_lora ? { camera_lora: s.camera_lora } : {}),
      ...(s.preset ? { preset: s.preset } : {}),
    })),
    model: input.model || 'ltx2',
    width: input.width || 1280,
    height: input.height || 720,
    fps: input.fps || 24,
    transition: input.transition || 'crossfade',
    transition_duration: input.transition_duration ?? 0.5,
  }
  return await $fetch(`${url}/generate/multi-segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeout: 30_000,
  })
}

/**
 * Submit an upscale job (image or video).
 */
export async function submitUpscale(
  input: Record<string, any>,
  podUrl?: string,
): Promise<{ job_id: string; status: string }> {
  const url = podUrl || getPodUrl()
  return await $fetch(`${url}/generate/upscale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      image: input.image,
      video: input.video,
      scale: input.scale || 2,
      fps: input.fps,
    },
    timeout: 30_000,
  })
}

// ── Job Status ─────────────────────────────────────────────────

/**
 * Check a job's status via the pod API.
 * Returns null if still processing (callers should keep polling).
 * Returns a JobResult (backward-compatible with RunPodResult) when done.
 */
export async function checkJobStatus(
  jobId: string,
  podUrl?: string,
): Promise<JobResult | null> {
  const url = podUrl || getPodUrl()

  try {
    const status = await $fetch<GenerationStatus & { has_video?: boolean; has_image?: boolean }>(`${url}/generate/status/${jobId}`, {
      timeout: 10_000,
    })

    if (status.status === 'completed') {
      // Base64 may be inline (image) or stripped (video) — check both
      let data = status.video_base64 || status.image_base64
      let type: string = status.video_base64 ? 'video' : 'image'

      // If status stripped the blob, fetch from /generate/result/
      if (!data && (status.has_video || status.has_image)) {
        try {
          const result = await $fetch<{ video_base64?: string; image_base64?: string }>(`${url}/generate/result/${jobId}`, {
            timeout: 60_000,
          })
          data = result.video_base64 || result.image_base64
          type = result.video_base64 ? 'video' : 'image'
        } catch (e: any) {
          console.warn(`[Pod] Failed to fetch result for ${jobId}: ${e.message}`)
        }
      }

      if (data) {
        return {
          status: 'COMPLETED',
          output: {
            output: { data, type },
          },
          currentSegment: status.segments_total,
          segmentsTotal: status.segments_total,
        }
      }
    }

    if (status.status === 'failed') {
      return {
        status: 'FAILED',
        error: status.error || 'Pod generation failed',
      }
    }

    // Still processing — return null to continue polling
    return null
  } catch (e: any) {
    // 404 = pod restarted and lost in-memory job state, or job expired.
    // Don't immediately fail — let the stale threshold + retry logic handle it.
    // This prevents pod restarts from instantly killing all in-flight jobs.
    console.warn(`[Pod] Status check failed for ${jobId}: ${e?.response?.status || ''} ${e.message}`)
    return null
  }
}

/**
 * Get extended status including segment progress.
 * Unlike checkJobStatus, this always returns data (null only on error).
 */
export async function getJobProgress(
  jobId: string,
  podUrl?: string,
): Promise<GenerationStatus | null> {
  const url = podUrl || getPodUrl()

  try {
    return await $fetch<GenerationStatus>(`${url}/generate/status/${jobId}`, {
      timeout: 10_000,
    })
  } catch {
    return null
  }
}

// ── Health & Models ────────────────────────────────────────────

/**
 * Health check — returns pod status, VRAM, disk info.
 */
export async function getHealth(podUrl?: string): Promise<HealthResponse | null> {
  const url = podUrl || getPodUrl()

  try {
    return await $fetch<HealthResponse>(`${url}/health`, { timeout: 8_000 })
  } catch {
    return null
  }
}

/**
 * List installed models grouped by category.
 */
export async function listModels(podUrl?: string): Promise<Record<string, ModelFile[]> | null> {
  const url = podUrl || getPodUrl()

  try {
    return await $fetch<Record<string, ModelFile[]>>(`${url}/models`, { timeout: 8_000 })
  } catch {
    return null
  }
}

/**
 * Get pod logs.
 */
export async function getLogs(
  source: 'comfy' | 'admin' = 'comfy',
  lines = 80,
  podUrl?: string,
): Promise<string | null> {
  const url = podUrl || getPodUrl()

  try {
    const result = await $fetch<{ source: string; lines: string }>(`${url}/logs`, {
      params: { source, lines },
      timeout: 5_000,
    })
    return result.lines
  } catch {
    return null
  }
}

// ── Admin Operations ───────────────────────────────────────────

/**
 * Restart the ComfyUI process on the pod.
 */
export async function restartComfyUI(podUrl?: string): Promise<{ success: boolean; output: string }> {
  const url = podUrl || getPodUrl()

  return await $fetch<{ success: boolean; output: string }>(`${url}/restart`, {
    method: 'POST',
    timeout: 15_000,
  })
}

/**
 * Start model synchronization (async operation).
 * Returns 409 if sync is already running.
 */
export async function startModelSync(podUrl?: string): Promise<{ status: string }> {
  const url = podUrl || getPodUrl()

  return await $fetch<{ status: string }>(`${url}/sync-models`, {
    method: 'POST',
    timeout: 10_000,
  })
}

/**
 * Check model sync job status.
 */
export async function getSyncStatus(podUrl?: string): Promise<SyncState | null> {
  const url = podUrl || getPodUrl()

  try {
    return await $fetch<SyncState>(`${url}/sync-status`, { timeout: 5_000 })
  } catch {
    return null
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Build a MultiSegmentRequest from stored comfyInput metadata.
 * Maps the old comfyInput format to the new pod API format.
 */
export function buildRequestFromMeta(meta: Record<string, any>): MultiSegmentRequest {
  const input = meta.comfyInput || meta

  // Multi-segment: input has a segments array
  if (input.segments && Array.isArray(input.segments)) {
    return {
      segments: input.segments.map((s: any) => ({
        image: s.image,
        prompt: s.prompt || '',
        frames: s.frames || s.numFrames || s.num_frames || 121,
        steps: s.steps,
        seed: s.seed,
        camera_lora: s.camera_lora || s.cameraLora,
        preset: s.preset,
      })),
      model: input.model || 'ltx2',
      width: input.width || 1280,
      height: input.height || 720,
      fps: input.fps || 24,
      transition: input.transition || 'crossfade',
      transition_duration: input.transition_duration ?? 0.5,
    }
  }

  // Single-segment: build from flat input
  const segment: SegmentInput = {
    prompt: input.prompt || '',
    frames: input.frames || input.numFrames || input.num_frames || 121,
    steps: input.steps,
    seed: input.seed,
    camera_lora: input.camera_lora || input.cameraLora,
    preset: input.preset,
  }

  // Include image for I2V
  if (input.image) {
    segment.image = input.image
  }

  return {
    segments: [segment],
    model: input.model || 'ltx2',
    width: input.width || 1280,
    height: input.height || 720,
    fps: input.fps || 24,
  }
}
