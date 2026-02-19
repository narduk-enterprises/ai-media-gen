/**
 * useGeneration — encapsulates image/video/audio generation, polling, and result management.
 *
 * Extracted from create.vue so the generation pipeline can be shared
 * across different creation modes (Persona+Scene, Free Build, etc.).
 */

interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
}

interface GenerationResult {
  generation: {
    id: string
    prompt: string
    imageCount: number
    status: string
    settings?: string
    createdAt: string
  }
  items: MediaItemResult[]
}

const MAX_IMAGES_PER_BATCH = 16

export function useGeneration() {
  const { runpodEndpoint, customEndpoint } = useAppSettings()

  // If a custom endpoint URL is set, pass it directly; otherwise use the named endpoint
  const effectiveEndpoint = computed(() => customEndpoint.value || runpodEndpoint.value)

  const generating = ref(false)
  const error = ref('')
  const results = ref<MediaItemResult[]>([])
  const activeGenerationId = ref<string | null>(null)
  const lastSettings = ref<Record<string, any> | null>(null)
  const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)

  const completed = computed(() => results.value.filter(i => i.status === 'complete'))
  const completedMedia = computed(() => results.value.filter(i => i.status === 'complete' && i.url))
  const totalDone = computed(() => completed.value.length)
  const totalFailed = computed(() => results.value.filter(i => i.status === 'failed').length)
  const totalPending = computed(() => results.value.filter(i => i.status !== 'complete' && i.status !== 'failed').length)

  // ─── Core generation ────────────────────────────────────────────────

  async function generate(opts: {
    prompts: string[]
    negativePrompt: string
    steps: number
    width: number
    height: number
    append?: boolean
  }) {
    const prompts = opts.prompts.slice(0, MAX_IMAGES_PER_BATCH)
    if (prompts.length === 0) return

    generating.value = true
    error.value = ''
    if (!opts.append) results.value = []
    stopPolling()

    try {
      const result = await $fetch<GenerationResult>('/api/generate/image', {
        method: 'POST',
        body: {
          prompt: prompts[0],
          prompts,
          negativePrompt: opts.negativePrompt,
          count: prompts.length,
          steps: opts.steps,
          width: opts.width,
          height: opts.height,
          attributes: {},
          endpoint: effectiveEndpoint.value,
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      if (result.generation.settings) {
        try { lastSettings.value = JSON.parse(result.generation.settings) } catch {}
      }

      const newItems = result.items.filter(i => i.type === 'image')
      results.value = [...results.value, ...newItems]
      activeGenerationId.value = result.generation.id
      startPolling(result.generation.id)
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Generation failed'
      generating.value = false
    }
  }

  // ─── Polling ────────────────────────────────────────────────────────

  function startPolling(generationId: string) {
    stopPolling()

    pollingTimer.value = setInterval(async () => {
      try {
        const result = await $fetch<GenerationResult>('/api/generate/generation-status', {
          params: { id: generationId },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        for (const updated of result.items) {
          const idx = results.value.findIndex(i => i.id === updated.id)
          if (idx >= 0) results.value.splice(idx, 1, updated)
        }

        // Stop polling only when the server says all items are resolved
        const genItems = result.items.filter(i => i.type === 'image')
        if (genItems.every(i => i.status === 'complete' || i.status === 'failed' || i.status === 'cancelled')) {
          stopPolling()
          generating.value = false
        }
      } catch { /* swallow */ }
    }, 3000)
  }

  function stopPolling() {
    if (pollingTimer.value) {
      clearInterval(pollingTimer.value)
      pollingTimer.value = null
    }
  }

  // ─── Video / Audio from existing image ──────────────────────────────

  const actionLoading = ref<Record<string, boolean>>({})

  async function makeVideo(mediaItemId: string, opts: {
    numFrames?: number
    steps?: number
    cfg?: number
    width?: number
    height?: number
  } = {}) {
    const key = `video-${mediaItemId}`
    actionLoading.value[key] = true
    try {
      const result = await $fetch<{ item: MediaItemResult }>('/api/generate/video', {
        method: 'POST',
        body: {
          mediaItemId,
          numFrames: opts.numFrames ?? 81,
          steps: opts.steps ?? 20,
          cfg: opts.cfg ?? 3.5,
          width: opts.width ?? 1024,
          height: opts.height ?? 1024,
          endpoint: effectiveEndpoint.value,
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (result.item) {
        results.value.push(result.item)
        if (result.item.status === 'processing' || result.item.status === 'queued') {
          pollItemStatus(result.item.id, key)
        } else {
          actionLoading.value[key] = false
        }
      }
    } catch (e: any) {
      error.value = e.data?.message || 'Video generation failed'
      actionLoading.value[key] = false
    }
  }

  async function makeAudio(mediaItemId: string, promptHint: string = '') {
    const key = `audio-${mediaItemId}`
    actionLoading.value[key] = true
    try {
      const result = await $fetch<{ item: MediaItemResult }>('/api/generate/audio', {
        method: 'POST',
        body: {
          mediaItemId,
          prompt: `ambient music for: ${promptHint || 'image'}`,
          endpoint: effectiveEndpoint.value,
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (result.item) {
        results.value.push(result.item)
        if (result.item.status === 'processing' || result.item.status === 'queued') {
          pollItemStatus(result.item.id, key)
        } else {
          actionLoading.value[key] = false
        }
      }
    } catch (e: any) {
      error.value = e.data?.message || 'Audio generation failed'
      actionLoading.value[key] = false
    }
  }

  async function pollItemStatus(itemId: string, loadingKey: string) {
    const maxAttempts = 120
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000))
      try {
        const result = await $fetch<{ item: MediaItemResult }>(`/api/generate/status/${itemId}`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        const idx = results.value.findIndex(img => img.id === itemId)
        if (idx >= 0) results.value.splice(idx, 1, result.item)
        if (result.item.status === 'complete' || result.item.status === 'failed') {
          actionLoading.value[loadingKey] = false
          return
        }
      } catch { /* continue */ }
    }
    actionLoading.value[loadingKey] = false
  }

  // ─── Text-to-Video generation ──────────────────────────────────────

  async function generateText2Video(opts: {
    prompt: string
    negativePrompt?: string
    numFrames?: number | number[]
    steps?: number
    width?: number
    height?: number
    append?: boolean
  }) {
    if (!opts.prompt.trim()) return

    const durations = Array.isArray(opts.numFrames)
      ? opts.numFrames
      : [opts.numFrames ?? 81]

    generating.value = true
    error.value = ''
    if (!opts.append) results.value = []
    stopPolling()

    const pollingPromises: Promise<void>[] = []

    for (const nf of durations) {
      try {
        const result = await $fetch<{
          generation: { id: string; prompt: string; imageCount: number; status: string; createdAt: string }
          item: MediaItemResult
        }>('/api/generate/text2video', {
          method: 'POST',
          body: {
            prompt: opts.prompt,
            negativePrompt: opts.negativePrompt || '',
            numFrames: nf,
            steps: opts.steps ?? 4,
            width: opts.width ?? 832,
            height: opts.height ?? 480,
            endpoint: effectiveEndpoint.value,
          },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        if (result.item) {
          results.value = [...results.value, result.item]
          activeGenerationId.value = result.generation.id
          if (result.item.status === 'processing' || result.item.status === 'queued') {
            const key = `t2v-${result.item.id}`
            actionLoading.value[key] = true
            pollingPromises.push(pollItemStatus(result.item.id, key))
          }
        }
      } catch (e: any) {
        error.value = e.data?.message || e.message || 'Text-to-video generation failed'
      }
    }

    if (pollingPromises.length > 0) {
      Promise.all(pollingPromises).finally(() => {
        generating.value = false
      })
    } else {
      generating.value = false
    }
  }

  // ─── Batch Text-to-Video generation ─────────────────────────────────

  async function generateBatchText2Video(opts: {
    prompts: string[]
    negativePrompt?: string
    numFrames?: number | number[]
    steps?: number
    width?: number
    height?: number
  }) {
    const allPrompts = opts.prompts
    if (allPrompts.length === 0) return

    const durations = Array.isArray(opts.numFrames)
      ? opts.numFrames
      : [opts.numFrames ?? 81]

    const totalJobs = allPrompts.length * durations.length

    generating.value = true
    error.value = ''
    results.value = []
    stopPolling()
    batchProgress.value = { current: 0, total: totalJobs }

    const pollingPromises: Promise<void>[] = []
    let submitted = 0

    for (let i = 0; i < allPrompts.length; i++) {
      for (const nf of durations) {
        try {
          const result = await $fetch<{
            generation: { id: string; prompt: string; imageCount: number; status: string; createdAt: string }
            item: MediaItemResult
          }>('/api/generate/text2video', {
            method: 'POST',
            body: {
              prompt: allPrompts[i],
              negativePrompt: opts.negativePrompt || '',
              numFrames: nf,
              steps: opts.steps ?? 4,
              width: opts.width ?? 832,
              height: opts.height ?? 480,
              endpoint: effectiveEndpoint.value,
            },
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          })

          if (result.item) {
            results.value = [...results.value, result.item]
            if (result.item.status === 'processing' || result.item.status === 'queued') {
              const key = `t2v-batch-${result.item.id}`
              actionLoading.value[key] = true
              pollingPromises.push(pollItemStatus(result.item.id, key))
            }
          }
        } catch (e: any) {
          console.error(`[T2V Batch] ${submitted + 1}/${totalJobs} submit failed:`, e.message)
        }
        submitted++
        batchProgress.value.current = submitted
      }
    }

    if (pollingPromises.length > 0) {
      Promise.all(pollingPromises).finally(() => {
        generating.value = false
      })
    } else {
      generating.value = false
    }
  }

  // ─── Batch generation (>16 images across multiple API calls) ────────

  const batchProgress = ref({ current: 0, total: 0 })
  const activeGenerationIds = ref<string[]>([])

  async function generateBatch(opts: {
    prompts: string[]
    negativePrompt: string
    steps: number
    width: number
    height: number
  }) {
    const allPrompts = opts.prompts
    if (allPrompts.length === 0) return

    generating.value = true
    error.value = ''
    results.value = []
    stopPolling()
    activeGenerationIds.value = []

    const chunks: string[][] = []
    for (let i = 0; i < allPrompts.length; i += MAX_IMAGES_PER_BATCH) {
      chunks.push(allPrompts.slice(i, i + MAX_IMAGES_PER_BATCH))
    }

    batchProgress.value = { current: 0, total: allPrompts.length }

    for (const chunk of chunks) {
      try {
        const result = await $fetch<GenerationResult>('/api/generate/image', {
          method: 'POST',
          body: {
            prompt: chunk[0],
            prompts: chunk,
            negativePrompt: opts.negativePrompt,
            count: chunk.length,
            steps: opts.steps,
            width: opts.width,
            height: opts.height,
            attributes: {},
            endpoint: effectiveEndpoint.value,
          },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        if (result.generation.settings) {
          try { lastSettings.value = JSON.parse(result.generation.settings) } catch {}
        }

        const newItems = result.items.filter(i => i.type === 'image')
        results.value = [...results.value, ...newItems]
        activeGenerationIds.value.push(result.generation.id)
        batchProgress.value.current += chunk.length
      } catch (e: any) {
        error.value = e.data?.message || e.message || `Batch chunk failed`
      }
    }

    startBatchPolling()
  }

  function startBatchPolling() {
    stopPolling()

    pollingTimer.value = setInterval(async () => {
      for (const genId of activeGenerationIds.value) {
        try {
          const result = await $fetch<GenerationResult>('/api/generate/generation-status', {
            params: { id: genId },
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          })
          for (const updated of result.items) {
            const idx = results.value.findIndex(i => i.id === updated.id)
            if (idx >= 0) results.value.splice(idx, 1, updated)
          }
        } catch { /* swallow */ }
      }

      const allDone = results.value.every(i => i.status === 'complete' || i.status === 'failed' || i.status === 'cancelled')
      if (allDone) {
        stopPolling()
        generating.value = false
        activeGenerationIds.value = []
      }
    }, 4000)
  }

  // ─── Utilities ──────────────────────────────────────────────────────

  function clearResults() {
    results.value = []
    stopPolling()
    generating.value = false
    activeGenerationId.value = null
  }

  function downloadMedia(url: string, index: number, type: string = 'image') {
    const ext = type === 'video' ? 'mp4' : 'png'
    const a = document.createElement('a')
    a.href = url
    a.download = `generated-${index + 1}.${ext}`
    a.click()
  }

  onUnmounted(() => stopPolling())

  return {
    MAX_IMAGES_PER_BATCH,
    generating,
    error,
    results,
    activeGenerationId,
    lastSettings,
    completedMedia,
    totalDone,
    totalFailed,
    totalPending,
    actionLoading,
    generate,
    generateText2Video,
    generateBatch,
    generateBatchText2Video,
    batchProgress,
    makeVideo,
    makeAudio,
    clearResults,
    downloadMedia,
  }
}
