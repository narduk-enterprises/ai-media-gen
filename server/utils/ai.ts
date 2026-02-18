/**
 * AI Provider — RunPod Serverless Integration.
 *
 * Calls the gpu-by-the-hour RunPod serverless endpoint which runs ComfyUI
 * with FLUX.1 Dev (text2image) and Wan 2.2 (text2video / image2video).
 *
 * Three endpoint modes:
 *   "full" — full image with all models baked in (~40GB)
 *   "slim" — slim image (~2-3GB) that loads models from network volume
 *   "eu"   — EU-region endpoint (full image, lower latency for EU users)
 *
 * Required env vars:
 *   NUXT_AI_API_KEY       — RunPod API key
 *   NUXT_AI_API_URL       — RunPod "full" endpoint URL
 *   NUXT_AI_API_URL_SLIM  — RunPod "slim" endpoint URL
 *   NUXT_AI_API_URL_EU    — RunPod "eu" endpoint URL
 */

export type EndpointType = 'full' | 'slim' | 'eu';

interface RunPodResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  output?: Record<string, any>;
  error?: string;
}

interface GenerateImagesResult {
  images: { data: string; filename: string }[]; // base64 encoded
}

interface GenerateVideoResult {
  data?: string; // base64 encoded video
  filename?: string;
  status: 'processing' | 'complete' | 'failed';
  error?: string;
}

/**
 * Resolve the API URL for a given endpoint type.
 * Accepts named types ('full', 'slim', 'eu') or a direct URL string.
 * Falls back to the full endpoint if slim isn't configured.
 */
export function resolveApiUrl(endpointType?: EndpointType | string): string {
  // If it looks like a URL, use it directly
  if (endpointType && (endpointType.startsWith('http://') || endpointType.startsWith('https://'))) {
    return endpointType.replace(/\/+$/, '')
  }
  const config = useRuntimeConfig();
  if (endpointType === 'slim' && config.aiApiUrlSlim) {
    return config.aiApiUrlSlim;
  }
  if (endpointType === 'eu' && config.aiApiUrlEu) {
    return config.aiApiUrlEu;
  }
  return config.aiApiUrl;
}

/**
 * Call RunPod serverless endpoint.
 * Tries /runsync first for fast results, but RunPod's sync window is ~120s.
 * If the job outlives that window (cold starts, large images), we fall back
 * to polling /status/{id} until it completes.
 */
export async function callRunPod(input: Record<string, any>, apiUrlOverride?: string): Promise<RunPodResponse> {
  const config = useRuntimeConfig();
  const apiKey = config.aiApiKey;
  const apiUrl = apiUrlOverride || config.aiApiUrl;

  if (!apiKey || !apiUrl) {
    throw createError({
      statusCode: 503,
      message: 'AI service not configured. Set AI_API_KEY and AI_API_URL.',
    });
  }

  let response: RunPodResponse;

  try {
    response = await $fetch<RunPodResponse>(`${apiUrl}/runsync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: { input },
      timeout: 180_000,
    });
  } catch (fetchError: any) {
    if (fetchError.name === 'AbortError' || /timeout/i.test(fetchError.message ?? '')) {
      console.warn('[AI] /runsync fetch timed out — falling back to async + polling');
      const { jobId } = await callRunPodAsync(input, apiUrl);
      return await pollRunPodJob(jobId, 300_000, apiUrl);
    }
    throw fetchError;
  }

  if (response.status === 'FAILED' || response.error) {
    throw createError({
      statusCode: 502,
      message: `AI generation failed: ${response.error || 'Unknown error'}`,
    });
  }

  if (response.status === 'IN_QUEUE' || response.status === 'IN_PROGRESS') {
    console.log(
      `[AI] /runsync returned ${response.status} for job ${response.id} — polling for completion`
    );
    return await pollRunPodJob(response.id, 300_000, apiUrl);
  }

  return response;
}

/**
 * Call RunPod serverless endpoint (async — for long jobs like video).
 * Returns job ID and the API URL used (for later status checks).
 */
export async function callRunPodAsync(input: Record<string, any>, apiUrlOverride?: string): Promise<{ jobId: string; apiUrl: string }> {
  const config = useRuntimeConfig();
  const apiKey = config.aiApiKey;
  const apiUrl = apiUrlOverride || config.aiApiUrl;

  if (!apiKey || !apiUrl) {
    throw createError({
      statusCode: 503,
      message: 'AI service not configured. Set AI_API_KEY and AI_API_URL.',
    });
  }

  const response = await $fetch<{ id: string; status: string }>(`${apiUrl}/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: { input },
  });

  return { jobId: response.id, apiUrl };
}

/**
 * Poll RunPod job status until complete.
 */
export async function pollRunPodJob(jobId: string, maxWaitMs = 300_000, apiUrlOverride?: string): Promise<RunPodResponse> {
  const config = useRuntimeConfig();
  const apiKey = config.aiApiKey;
  const apiUrl = apiUrlOverride || config.aiApiUrl;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const response = await $fetch<RunPodResponse>(`${apiUrl}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.status === 'COMPLETED') return response;
    if (
      response.status === 'FAILED' ||
      response.status === 'CANCELLED' ||
      response.status === 'TIMED_OUT'
    ) {
      throw createError({
        statusCode: 502,
        message: `AI generation ${response.status.toLowerCase()}: ${response.error || 'Unknown error'}`,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw createError({ statusCode: 504, message: 'AI generation timed out' });
}

/**
 * One-shot status check for a RunPod job. Returns null if the job
 * isn't finished yet — callers decide whether to wait or give up.
 */
export async function checkRunPodJob(jobId: string, apiUrlOverride?: string): Promise<RunPodResponse | null> {
  const config = useRuntimeConfig();
  const apiKey = config.aiApiKey;
  const apiUrl = apiUrlOverride || config.aiApiUrl;

  if (!apiKey || !apiUrl) return null;

  try {
    const response = await $fetch<RunPodResponse>(`${apiUrl}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10_000,
    });
    if (
      response.status === 'COMPLETED' ||
      response.status === 'FAILED' ||
      response.status === 'CANCELLED' ||
      response.status === 'TIMED_OUT'
    ) {
      return response;
    }
    return null; // still running
  } catch {
    return null;
  }
}

/**
 * Generate images from a text prompt via FLUX.1 Dev on RunPod.
 */
export async function generateImages(
  prompt: string,
  count: number,
  options?: { negativePrompt?: string; steps?: number; width?: number; height?: number; apiUrl?: string }
): Promise<GenerateImagesResult> {
  const promises = Array.from({ length: count }, (_, i) =>
    callRunPod({
      action: 'text2image',
      prompt,
      negative_prompt: options?.negativePrompt || '',
      width: options?.width || 1024,
      height: options?.height || 1024,
      steps: options?.steps || 20,
    }, options?.apiUrl)
      .then((response): { data: string; filename: string } | null => {
        if (response.output?.output) {
          const filename = response.output.output.filename || `image_${i}.png`;
          const dataLen = response.output.output.data?.length || 0;
          console.log(
            `[AI] Image ${i + 1}/${count} complete — filename: ${filename}, status: ${response.status}, data: ${dataLen} chars`
          );
          return {
            data: response.output.output.data,
            filename,
          };
        }
        console.warn(
          `[AI] Image ${i + 1}/${count} — no output in response:`,
          JSON.stringify(response).slice(0, 200)
        );
        return null;
      })
      .catch((error: any) => {
        console.error(`[AI] Image ${i + 1}/${count} failed:`, error.message);
        return null;
      })
  );

  const results = await Promise.all(promises);
  const images = results.filter((img): img is { data: string; filename: string } => img !== null);

  if (images.length === 0) {
    throw createError({ statusCode: 502, message: 'All image generations failed' });
  }

  return { images };
}

/**
 * Generate video from an image via Wan 2.2 image-to-video on RunPod.
 * Uses dual high/low noise approach for best quality.
 */
export async function generateVideo(
  prompt: string,
  options?: {
    imageBase64?: string;
    width?: number;
    height?: number;
    numFrames?: number;
    steps?: number;
    cfg?: number;
    negativePrompt?: string;
    apiUrl?: string;
  }
): Promise<GenerateVideoResult> {
  const input: Record<string, any> = {
    action: 'image2video',
    prompt,
    width: options?.width || 768,
    height: options?.height || 768,
    num_frames: options?.numFrames || 81,
    steps: options?.steps || 20,
    cfg: options?.cfg || 3.5,
  };

  if (options?.negativePrompt) {
    input.negative_prompt = options.negativePrompt;
  }

  if (options?.imageBase64) {
    input.image = options.imageBase64;
  }

  console.log(
    `[AI] image2video — ${input.num_frames} frames, ${input.width}x${input.height}, ${input.steps} steps, cfg=${input.cfg}`
  );

  const { jobId, apiUrl } = await callRunPodAsync(input, options?.apiUrl);
  const response = await pollRunPodJob(jobId, 300_000, apiUrl);

  if (response.output?.output) {
    return {
      data: response.output.output.data,
      filename: response.output.output.filename || 'video.mp4',
      status: 'complete',
    };
  }

  return { status: 'failed', error: 'No output returned' };
}

/**
 * Generate video directly from text prompt via Wan 2.2 text-to-video on RunPod.
 * numFrames controls duration: 81 frames ≈ 3s, 121 ≈ 5s, 161 ≈ 7s at ~24fps
 */
export async function generateText2Video(
  prompt: string,
  options?: { width?: number; height?: number; numFrames?: number; steps?: number; apiUrl?: string }
): Promise<GenerateVideoResult> {
  const input: Record<string, any> = {
    action: 'text2video',
    prompt,
    width: options?.width || 640,
    height: options?.height || 640,
    num_frames: options?.numFrames || 81,
    steps: options?.steps || 4,
  };

  console.log(
    `[AI] text2video — ${input.num_frames} frames, ${input.width}x${input.height}, ${input.steps} steps`
  );

  const { jobId, apiUrl } = await callRunPodAsync(input, options?.apiUrl);
  const response = await pollRunPodJob(jobId, 300_000, apiUrl);

  if (response.output?.output) {
    console.log(`[AI] text2video complete — filename: ${response.output.output.filename}`);
    return {
      data: response.output.output.data,
      filename: response.output.output.filename || 'text2video.mp4',
      status: 'complete',
    };
  }

  return { status: 'failed', error: 'No output returned' };
}

/**
 * Generate video with audio from an image via Wan 2.2 + MMAudio on RunPod.
 */
export async function generateVideoWithAudio(
  prompt: string,
  options?: {
    imageBase64?: string;
    width?: number;
    height?: number;
    numFrames?: number;
    steps?: number;
    cfg?: number;
    apiUrl?: string;
  }
): Promise<GenerateVideoResult> {
  const input: Record<string, any> = {
    action: 'image2video_audio',
    prompt,
    width: options?.width || 768,
    height: options?.height || 768,
    num_frames: options?.numFrames || 81,
    steps: options?.steps || 20,
    cfg: options?.cfg || 3.5,
  };

  if (options?.imageBase64) {
    input.image = options.imageBase64;
  }

  const { jobId, apiUrl } = await callRunPodAsync(input, options?.apiUrl);
  const response = await pollRunPodJob(jobId, 300_000, apiUrl);

  if (response.output?.output) {
    return {
      data: response.output.output.data,
      filename: response.output.output.filename || 'video_audio.mp4',
      status: 'complete',
    };
  }

  return { status: 'failed', error: 'No output returned' };
}
