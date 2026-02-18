/**
 * useWebLLM — composable for in-browser LLM inference via WebLLM.
 *
 * Uses WebGPU to run a tiny quantized model entirely in the browser.
 * The model is lazily loaded on first use and cached by the browser.
 *
 * IMPORTANT: This composable must be client-only. The @mlc-ai/web-llm package
 * uses browser/WebGPU APIs that don't exist in Cloudflare Workers (SSR).
 *
 * Model files are fetched through /api/hf-proxy/ to bypass HuggingFace's
 * restrictive CORS policy (they only allow requests from huggingface.co).
 * We intercept fetch() calls to redirect HuggingFace URLs through the proxy.
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
      isSupported: computed(() => false),
      loadProgress: readonly(ref(0)),
      loadingModel: readonly(ref(false)),
      error: readonly(ref('')),
      remixPrompt: async (_prompt: string) => {
        throw new Error('WebLLM is only available in the browser')
      },
    }
  }

  const loadProgress = ref(0)
  const loadingModel = ref(false)
  const error = ref('')

  // Start false to match SSR output, then check on mount to avoid hydration mismatch
  const webGpuAvailable = ref(false)
  onMounted(() => {
    webGpuAvailable.value = typeof navigator !== 'undefined' && 'gpu' in navigator
  })

  const isSupported = computed(() => webGpuAvailable.value)

  /**
   * Ensure the engine is loaded. Lazily initializes on first call.
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
   * Generate a creative remix of the given prompt using the in-browser LLM.
   */
  async function remixPrompt(prompt: string): Promise<string> {
    if (!isSupported.value) {
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

  return {
    isSupported,
    loadProgress: readonly(loadProgress),
    loadingModel: readonly(loadingModel),
    error: readonly(error),
    remixPrompt,
  }
}
