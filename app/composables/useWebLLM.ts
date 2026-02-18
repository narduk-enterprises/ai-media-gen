/**
 * useWebLLM — composable for in-browser LLM inference via WebLLM.
 *
 * Uses WebGPU to run a tiny quantized model entirely in the browser.
 * The model is lazily loaded on first use and cached by the browser.
 */

const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'

const SYSTEM_PROMPT = `You are a creative AI image prompt engineer. Given a user's image generation prompt, create a variation that is visually distinct but thematically related. Make it more vivid, detailed, and cinematic. Add interesting artistic styles, lighting, color palettes, composition details, and atmosphere. Keep the core subject but transform the scene into something fresh and stunning. Output ONLY the new prompt, nothing else. No explanations, no quotes, no prefixes.`

// Module-level singleton state (shared across all component instances)
let engineInstance: any = null
let engineReady = false
let engineLoading = false

export function useWebLLM() {
  const loadProgress = ref(0)
  const loadingModel = ref(false)
  const error = ref('')

  /**
   * Check if WebGPU is available in the current browser.
   */
  const isSupported = computed(() => {
    if (import.meta.server) return false
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  })

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

    try {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

      engineInstance = await CreateMLCEngine(MODEL_ID, {
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
