/**
 * AI Provider — RunPod Serverless Integration.
 *
 * Calls the gpu-by-the-hour RunPod serverless endpoint which runs ComfyUI
 * with FLUX.1 Dev (text2image) and Wan 2.2 (text2video / image2video).
 *
 * Required env vars:
 *   NUXT_AI_API_KEY  — RunPod API key
 *   NUXT_AI_API_URL  — RunPod endpoint URL (https://api.runpod.ai/v2/<endpoint_id>)
 */

interface RunPodResponse {
  id: string
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'
  output?: Record<string, any>
  error?: string
}

interface GenerateImagesResult {
  images: { data: string; filename: string }[]  // base64 encoded
}

interface GenerateVideoResult {
  data?: string       // base64 encoded video
  filename?: string
  status: 'processing' | 'complete' | 'failed'
  error?: string
}

/**
 * Call RunPod serverless endpoint (synchronous).
 * Uses /runsync for immediate results (up to 120s timeout).
 */
export async function callRunPod(input: Record<string, any>): Promise<RunPodResponse> {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const apiUrl = config.aiApiUrl

  if (!apiKey || !apiUrl) {
    throw createError({
      statusCode: 503,
      message: 'AI service not configured. Set AI_API_KEY and AI_API_URL.',
    })
  }

  const response = await $fetch<RunPodResponse>(`${apiUrl}/runsync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: { input },
    timeout: 180_000, // 3 min — generation can be slow on cold starts
  })

  if (response.status === 'FAILED' || response.error) {
    throw createError({
      statusCode: 502,
      message: `AI generation failed: ${response.error || 'Unknown error'}`,
    })
  }

  return response
}

/**
 * Call RunPod serverless endpoint (async — for long jobs like video).
 * Returns job ID for polling.
 */
async function callRunPodAsync(input: Record<string, any>): Promise<{ jobId: string }> {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const apiUrl = config.aiApiUrl

  if (!apiKey || !apiUrl) {
    throw createError({
      statusCode: 503,
      message: 'AI service not configured. Set AI_API_KEY and AI_API_URL.',
    })
  }

  const response = await $fetch<{ id: string; status: string }>(`${apiUrl}/run`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: { input },
  })

  return { jobId: response.id }
}

/**
 * Poll RunPod job status until complete.
 */
async function pollRunPodJob(jobId: string, maxWaitMs = 300_000): Promise<RunPodResponse> {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const apiUrl = config.aiApiUrl

  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const response = await $fetch<RunPodResponse>(`${apiUrl}/status/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (response.status === 'COMPLETED') return response
    if (response.status === 'FAILED' || response.status === 'CANCELLED' || response.status === 'TIMED_OUT') {
      throw createError({
        statusCode: 502,
        message: `AI generation ${response.status.toLowerCase()}: ${response.error || 'Unknown error'}`,
      })
    }

    // Still processing — wait before polling again
    await new Promise(resolve => setTimeout(resolve, 3000))
  }

  throw createError({ statusCode: 504, message: 'AI generation timed out' })
}

/**
 * Generate images from a text prompt via FLUX.1 Dev on RunPod.
 */
export async function generateImages(
  prompt: string,
  count: number,
  options?: { negativePrompt?: string; steps?: number; width?: number; height?: number },
): Promise<GenerateImagesResult> {
  // Fire all requests in parallel — each hits a separate serverless worker
  const promises = Array.from({ length: count }, (_, i) =>
    callRunPod({
      action: 'text2image',
      prompt,
      negative_prompt: options?.negativePrompt || '',
      width: options?.width || 1024,
      height: options?.height || 1024,
      steps: options?.steps || 20,
    })
      .then((response): { data: string; filename: string } | null => {
        if (response.output?.output) {
          const filename = response.output.output.filename || `image_${i}.png`
          const dataLen = response.output.output.data?.length || 0
          console.log(`[AI] Image ${i + 1}/${count} complete — filename: ${filename}, status: ${response.status}, data: ${dataLen} chars`)
          return {
            data: response.output.output.data,
            filename,
          }
        }
        console.warn(`[AI] Image ${i + 1}/${count} — no output in response:`, JSON.stringify(response).slice(0, 200))
        return null
      })
      .catch((error: any) => {
        console.error(`[AI] Image ${i + 1}/${count} failed:`, error.message)
        return null
      })
  )

  const results = await Promise.all(promises)
  const images = results.filter((img): img is { data: string; filename: string } => img !== null)

  if (images.length === 0) {
    throw createError({ statusCode: 502, message: 'All image generations failed' })
  }

  return { images }
}

/**
 * Generate video from an image via Wan 2.2 image-to-video on RunPod.
 */
export async function generateVideo(
  prompt: string,
  options?: { imageBase64?: string; width?: number; height?: number }
): Promise<GenerateVideoResult> {
  const input: Record<string, any> = {
    action: 'image2video',
    prompt,
    width: options?.width || 720,
    height: options?.height || 480,
    num_frames: 81,
    steps: 20,
  }

  if (options?.imageBase64) {
    input.image = options.imageBase64
  }

  // Use async + polling for video (can take >120s)
  const { jobId } = await callRunPodAsync(input)
  const response = await pollRunPodJob(jobId)

  if (response.output?.output) {
    return {
      data: response.output.output.data,
      filename: response.output.output.filename || 'video.mp4',
      status: 'complete',
    }
  }

  return { status: 'failed', error: 'No output returned' }
}

/**
 * Generate video directly from text prompt via Wan 2.2 text-to-video on RunPod.
 * numFrames controls duration: 81 frames ≈ 3s, 121 ≈ 5s, 161 ≈ 7s at ~24fps
 */
export async function generateText2Video(
  prompt: string,
  options?: { width?: number; height?: number; numFrames?: number; steps?: number }
): Promise<GenerateVideoResult> {
  const input: Record<string, any> = {
    action: 'text2video',
    prompt,
    width: options?.width || 640,
    height: options?.height || 640,
    num_frames: options?.numFrames || 81,
    steps: options?.steps || 4,
  }

  console.log(`[AI] text2video — ${input.num_frames} frames, ${input.width}x${input.height}, ${input.steps} steps`)

  const { jobId } = await callRunPodAsync(input)
  const response = await pollRunPodJob(jobId)

  if (response.output?.output) {
    console.log(`[AI] text2video complete — filename: ${response.output.output.filename}`)
    return {
      data: response.output.output.data,
      filename: response.output.output.filename || 'text2video.mp4',
      status: 'complete',
    }
  }

  return { status: 'failed', error: 'No output returned' }
}

/**
 * Generate video with audio from an image via Wan 2.2 + MMAudio on RunPod.
 */
export async function generateVideoWithAudio(
  prompt: string,
  options?: { imageBase64?: string; width?: number; height?: number }
): Promise<GenerateVideoResult> {
  const input: Record<string, any> = {
    action: 'image2video_audio',
    prompt,
    width: options?.width || 720,
    height: options?.height || 480,
    num_frames: 81,
    steps: 20,
  }

  if (options?.imageBase64) {
    input.image = options.imageBase64
  }

  // Use async + polling (video+audio can take >120s)
  const { jobId } = await callRunPodAsync(input)
  const response = await pollRunPodJob(jobId)

  if (response.output?.output) {
    return {
      data: response.output.output.data,
      filename: response.output.output.filename || 'video_audio.mp4',
      status: 'complete',
    }
  }

  return { status: 'failed', error: 'No output returned' }
}

