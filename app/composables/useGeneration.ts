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

  const submitting = ref(false)
  const error = ref('')
  const results = ref<MediaItemResult[]>([])
  const activeGenerationId = ref<string | null>(null)
  const lastSettings = ref<Record<string, any> | null>(null)
  const activePolls = ref(0)

  const generating = computed(() => submitting.value || activePolls.value > 0)
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
    loraStrength?: number
    model?: string
    seed?: number
    append?: boolean
  }) {
    const prompts = opts.prompts.slice(0, MAX_IMAGES_PER_BATCH)
    if (prompts.length === 0) return

    submitting.value = true
    error.value = ''
    if (!opts.append) results.value = []

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
          loraStrength: opts.loraStrength ?? 1.0,
          model: opts.model ?? 'wan22',
          seed: opts.seed ?? -1,
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
    } finally {
      submitting.value = false
    }
  }

  // ─── Polling ────────────────────────────────────────────────────────

  function startPolling(generationId: string) {
    activePolls.value++

    const timer = setInterval(async () => {
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
          clearInterval(timer)
          activePolls.value--
        }
      } catch { /* swallow */ }
    }, 2000)
  }

  function stopAllPolling() {
    activePolls.value = 0
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
      await new Promise(r => setTimeout(r, 2000))
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
    loraStrength?: number
    append?: boolean
  }) {
    if (!opts.prompt.trim()) return

    const durations = Array.isArray(opts.numFrames)
      ? opts.numFrames
      : [opts.numFrames ?? 81]

    submitting.value = true
    error.value = ''
    if (!opts.append) results.value = []

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
            loraStrength: opts.loraStrength ?? 1.0,
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

    submitting.value = false
    if (pollingPromises.length > 0) {
      Promise.all(pollingPromises).catch(() => {})
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
    loraStrength?: number
  }) {
    const allPrompts = opts.prompts
    if (allPrompts.length === 0) return

    const durations = Array.isArray(opts.numFrames)
      ? opts.numFrames
      : [opts.numFrames ?? 81]

    const totalJobs = allPrompts.length * durations.length

    submitting.value = true
    error.value = ''
    results.value = []
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
            loraStrength: opts.loraStrength ?? 1.0,
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

    submitting.value = false
    if (pollingPromises.length > 0) {
      Promise.all(pollingPromises).catch(() => {})
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
    loraStrength?: number
    model?: string
    seed?: number
  }) {
    const allPrompts = opts.prompts
    if (allPrompts.length === 0) return

    submitting.value = true
    error.value = ''
    results.value = []
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
            loraStrength: opts.loraStrength ?? 1.0,
            model: opts.model ?? 'wan22',
            seed: opts.seed ?? -1,
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
    submitting.value = false
  }

  function startBatchPolling() {
    activePolls.value++

    const timer = setInterval(async () => {
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
        clearInterval(timer)
        activePolls.value--
        activeGenerationIds.value = []
      }
    }, 2000)
  }

  // ─── Utilities ──────────────────────────────────────────────────────

  function clearResults() {
    results.value = []
    stopAllPolling()
    submitting.value = false
    activeGenerationId.value = null
  }

  function downloadMedia(url: string, index: number, type: string = 'image') {
    const ext = type === 'video' ? 'mp4' : 'png'
    const a = document.createElement('a')
    a.href = url
    a.download = `generated-${index + 1}.${ext}`
    a.click()
  }

  async function generateImage2Image(opts: {
    image: string
    prompt: string
    negativePrompt?: string
    steps?: number
    width?: number
    height?: number
    cfg?: number
    denoise?: number
  }) {
    submitting.value = true
    error.value = ''
    results.value = []

    try {
      const result = await $fetch<GenerationResult>('/api/generate/image2image', {
        method: 'POST',
        body: {
          image: opts.image,
          prompt: opts.prompt,
          negativePrompt: opts.negativePrompt || '',
          steps: opts.steps || 20,
          width: opts.width || 1024,
          height: opts.height || 1024,
          cfg: opts.cfg || 3.5,
          denoise: opts.denoise || 0.75,
          endpoint: effectiveEndpoint.value,
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      const newItems = result.items.filter(i => i.type === 'image')
      results.value = [...results.value, ...newItems]
      activeGenerationId.value = result.generation.id
      startPolling(result.generation.id)
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Image-to-image failed'
    } finally {
      submitting.value = false
    }
  }

  onUnmounted(() => stopAllPolling())

  return {
    MAX_IMAGES_PER_BATCH,
    generating,
    submitting,
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
    generateImage2Image,
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
