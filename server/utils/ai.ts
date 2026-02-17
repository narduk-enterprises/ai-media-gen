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
async function callRunPod(input: Record<string, any>): Promise<RunPodResponse> {
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
  options?: { steps?: number; width?: number; height?: number },
): Promise<GenerateImagesResult> {
  // RunPod handler generates one image per call, so loop for multiple
  const images: { data: string; filename: string }[] = []

  for (let i = 0; i < count; i++) {
    try {
      const response = await callRunPod({
        action: 'text2image',
        prompt,
        width: options?.width || 1024,
        height: options?.height || 1024,
        steps: options?.steps || 20,
      })

      if (response.output?.output) {
        images.push({
          data: response.output.output.data,
          filename: response.output.output.filename || `image_${i}.png`,
        })
      }
    } catch (error: any) {
      console.error(`[AI] Image ${i + 1}/${count} failed:`, error.message)
      // Continue generating remaining images if one fails
    }
  }

  if (images.length === 0) {
    throw createError({ statusCode: 502, message: 'All image generations failed' })
  }

  return { images }
}

/**
 * Generate video from text or image via Wan 2.2 on RunPod.
 */
export async function generateVideo(
  prompt: string,
  options?: { imageBase64?: string; width?: number; height?: number }
): Promise<GenerateVideoResult> {
  const action = options?.imageBase64 ? 'image2video' : 'text2video'

  const input: Record<string, any> = {
    action,
    prompt,
    width: options?.width || (action === 'text2video' ? 640 : 720),
    height: options?.height || (action === 'text2video' ? 640 : 480),
    num_frames: 81,
    steps: action === 'text2video' ? 4 : 20,
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
 * Generate audio is not yet supported by the RunPod handler.
 * Placeholder for future implementation.
 */
export async function generateAudio(_prompt?: string, _sourceUrl?: string): Promise<GenerateVideoResult> {
  throw createError({
    statusCode: 501,
    message: 'Audio generation is not yet available',
  })
}
