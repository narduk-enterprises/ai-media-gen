/**
 * useWebLLM — composable for prompt remixing.
 *
 * Strategy: Server-side first (GPU pod with Qwen2.5-3B-Instruct), with
 * optional in-browser WebLLM fallback via WebGPU.
 *
 * The server-side approach is faster (~2-5s), produces better results (3B model
 * on a full GPU), and works in all browsers. The browser fallback is kept for
 * offline use or when the server is unavailable.
 */

const MODEL_ID = 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC'

const HF_ORIGIN = 'https://huggingface.co'

const SYSTEM_PROMPT = `You are a creative AI image prompt engineer. Given a user's image generation prompt, create a variation that is visually distinct but thematically related. Make it more vivid, detailed, and cinematic. Add interesting artistic styles, lighting, color palettes, composition details, and atmosphere. Keep the core subject but transform the scene into something fresh and stunning. Output ONLY the new prompt, nothing else. No explanations, no quotes, no prefixes.`

// Module-level singleton state (shared across all component instances)
let engineInstance: any = null
let engineReady = false
let engineLoading = false

/**
 * Wraps global fetch to redirect HuggingFace requests through our CORS proxy.
 * Returns a cleanup function to restore the original fetch.
 */
function installFetchProxy(): () => void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    // Redirect huggingface.co requests through our proxy
    if (url.startsWith(HF_ORIGIN)) {
      const hfPath = url.slice(HF_ORIGIN.length + 1) // strip "https://huggingface.co/"
      url = `/api/hf-proxy/${hfPath}`
      return originalFetch(url, init)
    }

    return originalFetch(input, init)
  }

  return () => {
    globalThis.fetch = originalFetch
  }
}

export function useWebLLM() {
  // On the server, return inert values — web-llm can only run in the browser
  if (import.meta.server) {
    return {
      isSupported: computed(() => true), // server-side remix is always available
      loadProgress: readonly(ref(100)),
      loadingModel: readonly(ref(false)),
      error: readonly(ref('')),
      remixPrompt: async (prompt: string) => {
        // Shouldn't be called during SSR, but handle gracefully
        throw new Error('Remix is only available on the client')
      },
    }
  }

  const loadProgress = ref(100) // Server remix needs no loading
  const loadingModel = ref(false)
  const error = ref('')

  // Start false to match SSR output, then check on mount to avoid hydration mismatch
  const webGpuAvailable = ref(false)
  onMounted(() => {
    webGpuAvailable.value = typeof navigator !== 'undefined' && 'gpu' in navigator
  })

  // Server remix is always supported; WebGPU is a bonus
  const isSupported = computed(() => true)

  /**
   * Remix via the server-side GPU LLM (fast, high quality).
   */
  async function remixPromptServer(prompt: string): Promise<string> {
    // Use the custom endpoint if set, otherwise the selected named endpoint
    const { effectiveEndpoint } = useAppSettings()
    const endpoint = effectiveEndpoint.value

    const response = await $fetch<{ prompts: string[]; elapsed: number }>('/api/generate/remix', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      body: { prompt, count: 1, endpoint },
    })

    if (!response?.prompts?.[0]) {
      throw new Error('No prompt returned from server remix')
    }

    return response.prompts[0]
  }

  /**
   * Ensure the browser engine is loaded. Lazily initializes on first call.
   * Returns true if ready, false if failed.
   */
  async function ensureEngine(): Promise<boolean> {
    if (engineReady && engineInstance) return true
    if (engineLoading) {
      // Wait for the existing load to finish
      while (engineLoading) {
        await new Promise(r => setTimeout(r, 200))
      }
      return engineReady
    }

    engineLoading = true
    loadingModel.value = true
    loadProgress.value = 0
    error.value = ''

    // Install fetch proxy to redirect HuggingFace requests through our CORS proxy
    const removeFetchProxy = installFetchProxy()

    try {
      const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')

      engineInstance = await CreateMLCEngine(MODEL_ID, {
        appConfig: {
          ...prebuiltAppConfig,
          useIndexedDBCache: true,
        },
        initProgressCallback: (progress: { progress: number; text: string }) => {
          loadProgress.value = Math.round(progress.progress * 100)
        },
      })

      engineReady = true
      loadProgress.value = 100
      return true
    } catch (e: any) {
      error.value = e.message || 'Failed to load AI model'
      console.error('[WebLLM] Engine init failed:', e)
      return false
    } finally {
      removeFetchProxy()
      engineLoading = false
      loadingModel.value = false
    }
  }

  /**
   * Remix via the in-browser WebLLM (fallback).
   */
  async function remixPromptBrowser(prompt: string): Promise<string> {
    if (!webGpuAvailable.value) {
      throw new Error('WebGPU is not supported in this browser')
    }

    const ready = await ensureEngine()
    if (!ready || !engineInstance) {
      throw new Error(error.value || 'Failed to initialize AI model')
    }

    const response = await engineInstance.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Create a creative variation of this image prompt:\n\n${prompt}` },
      ],
      max_tokens: 300,
      temperature: 0.9,
    })

    const result = response.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '')
    if (!result) {
      throw new Error('No prompt returned from AI model')
    }

    return result
  }

  /**
   * Generate a creative remix of the given prompt.
   * Tries server-side first (GPU LLM), falls back to in-browser WebLLM.
   */
  async function remixPrompt(prompt: string): Promise<string> {
    // Try server-side first — faster and better quality
    try {
      return await remixPromptServer(prompt)
    } catch (serverError: any) {
      console.warn('[Remix] Server-side failed, falling back to browser:', serverError.message)
    }

    // Fall back to browser-based WebLLM
    return await remixPromptBrowser(prompt)
  }

  return {
    isSupported,
    loadProgress: readonly(loadProgress),
    loadingModel: readonly(loadingModel),
    error: readonly(error),
    remixPrompt,
  }
}
