/**
 * AI Provider abstraction layer.
 *
 * Currently uses placeholder/mock responses.
 * Swap to RunPod, Replicate, Fal.ai, etc. by replacing the implementations.
 */

interface GenerateImagesResult {
  urls: string[]
  jobId?: string
}

interface GenerateVideoResult {
  url?: string
  jobId?: string
  status: 'processing' | 'complete' | 'failed'
}

interface GenerateAudioResult {
  url?: string
  jobId?: string
  status: 'processing' | 'complete' | 'failed'
}

/**
 * Generate images from a text prompt.
 * Returns placeholder URLs — replace with real API calls.
 */
export async function generateImages(prompt: string, count: number): Promise<GenerateImagesResult> {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const apiUrl = config.aiApiUrl

  // ── Real API integration point ──
  // If you have a RunPod/Replicate/Fal endpoint configured, use it:
  if (apiKey && apiUrl) {
    try {
      const response = await $fetch<{ output: { images: string[] } }>(apiUrl + '/txt2img', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          input: {
            prompt,
            num_images: count,
            width: 1024,
            height: 1024,
          },
        },
      })
      return { urls: response.output.images }
    } catch (error: any) {
      console.error('[AI] Image generation failed:', error.message)
      throw createError({ statusCode: 502, message: 'AI image generation failed' })
    }
  }

  // ── Mock mode: return placeholder images ──
  const urls: string[] = []
  const seed = hashCode(prompt)
  for (let i = 0; i < count; i++) {
    // High-quality placeholder images from picsum
    urls.push(`https://picsum.photos/seed/${seed + i}/1024/1024`)
  }
  return { urls }
}

/**
 * Generate video from an image URL.
 */
export async function generateVideo(imageUrl: string): Promise<GenerateVideoResult> {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const apiUrl = config.aiApiUrl

  if (apiKey && apiUrl) {
    try {
      const response = await $fetch<{ output: { video: string }; status: string }>(apiUrl + '/img2vid', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          input: {
            image_url: imageUrl,
            duration: 4,
          },
        },
      })
      return {
        url: response.output?.video,
        status: response.status === 'COMPLETED' ? 'complete' : 'processing',
      }
    } catch (error: any) {
      console.error('[AI] Video generation failed:', error.message)
      return { status: 'failed' }
    }
  }

  // Mock mode: return a sample video
  return {
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    status: 'complete',
  }
}

/**
 * Generate audio (music/sound) for a video or image.
 */
export async function generateAudio(prompt?: string, sourceUrl?: string): Promise<GenerateAudioResult> {
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey
  const apiUrl = config.aiApiUrl

  if (apiKey && apiUrl) {
    try {
      const response = await $fetch<{ output: { audio: string }; status: string }>(apiUrl + '/audio', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          input: {
            prompt: prompt || 'cinematic background music',
            source_url: sourceUrl,
            duration: 10,
          },
        },
      })
      return {
        url: response.output?.audio,
        status: response.status === 'COMPLETED' ? 'complete' : 'processing',
      }
    } catch (error: any) {
      console.error('[AI] Audio generation failed:', error.message)
      return { status: 'failed' }
    }
  }

  // Mock mode
  return {
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    status: 'complete',
  }
}

// Simple hash for deterministic placeholder seeds
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}
