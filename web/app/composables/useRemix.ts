/**
 * useRemix — composable for AI prompt remixing via server-side GPU LLM.
 *
 * Calls the pod's Qwen2.5-3B-Instruct model through /api/generate/remix.
 * Supports single prompts, variations, and batch array remixing with progress.
 */

export function useRemix() {
  const remixLoading = ref(false)
  const remixProgress = ref({ current: 0, total: 0 })

  /**
   * Call the server-side remix API.
   * Returns an array of `count` remixed prompts.
   */
  async function remixServer(prompt: string, count = 1, instruction?: string): Promise<string[]> {
    const { effectiveEndpoint } = useAppSettings()

    const response = await $fetch<{ prompts: string[]; elapsed: number }>('/api/generate/remix', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      body: { prompt, count, endpoint: effectiveEndpoint.value, ...(instruction ? { instruction } : {}) },
    })

    if (!response?.prompts?.length) {
      throw new Error('No prompts returned from remix')
    }
    return response.prompts
  }

  /**
   * Remix a single prompt. Returns the remixed string.
   */
  async function remixPrompt(prompt: string, instruction?: string): Promise<string> {
    const results = await remixServer(prompt, 1, instruction)
    return results[0]!
  }

  /**
   * Generate multiple variations of a single prompt.
   * Returns `count` variations.
   */
  async function remixVariations(prompt: string, count = 4, instruction?: string): Promise<string[]> {
    return await remixServer(prompt, count, instruction)
  }

  /**
   * Remix an array of prompts in batches.
   * Each prompt gets one remix. Failed prompts keep their original text.
   * Updates `remixProgress` reactively for UI feedback.
   *
   * @param prompts   Array of prompts to remix
   * @param batchSize Concurrent requests per batch (default 5)
   * @returns         Remixed prompts (same length as input)
   */
  async function remixPrompts(
    prompts: string[],
    batchSize = 5,
  ): Promise<string[]> {
    if (prompts.length === 0) return []

    remixLoading.value = true
    remixProgress.value = { current: 0, total: prompts.length }
    const remixed: string[] = []

    try {
      for (let i = 0; i < prompts.length; i += batchSize) {
        const batch = prompts.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map(p => remixServer(p, 1)),
        )

        for (let j = 0; j < results.length; j++) {
          const result = results[j]!
          if (result.status === 'fulfilled' && result.value?.[0]) {
            remixed.push(result.value[0])
          } else {
            remixed.push(prompts[i + j]!) // keep original on failure
          }
          remixProgress.value = { ...remixProgress.value, current: remixed.length }
        }
      }
      return remixed
    } finally {
      remixLoading.value = false
      remixProgress.value = { current: 0, total: 0 }
    }
  }

  return {
    remixLoading: readonly(remixLoading),
    remixProgress: readonly(remixProgress),
    remixPrompt,
    remixVariations,
    remixPrompts,
  }
}
