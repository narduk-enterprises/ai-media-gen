/**
 * useGeneration — encapsulates image/video/audio generation and result management.
 *
 * Polling has been moved to the centralized useQueue composable.
 * After submitting, this composable triggers queue.refresh() and
 * the QueueSidebar handles progress visualization.
 */
import type { QueueItem } from './useQueue'

export interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
}

export interface GenerationResult {
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
  const queue = useQueue()

  // If a custom endpoint URL is set, pass it directly; otherwise use the named endpoint
  const effectiveEndpoint = computed(() => customEndpoint.value || runpodEndpoint.value)

  const submitting = ref(false)
  const error = ref('')
  const results = ref<MediaItemResult[]>([])
  const activeGenerationId = ref<string | null>(null)
  const lastSettings = ref<Record<string, any> | null>(null)
  // Track generation IDs so we can sync results from the queue
  const trackedGenerationIds = ref<Set<string>>(new Set())

  const generating = computed(() => submitting.value)
  const completed = computed(() => results.value.filter(i => i.status === 'complete'))
  const completedMedia = computed(() => results.value.filter(i => i.status === 'complete' && i.url))
  const totalDone = computed(() => completed.value.length)
  const totalFailed = computed(() => results.value.filter(i => i.status === 'failed').length)
  const totalPending = computed(() => results.value.filter(i => i.status !== 'complete' && i.status !== 'failed').length)

  // Sync results from queue items — when queue items update, reflect in local results
  if (import.meta.client) {
    watch(() => queue.items.value, (queueItems) => {
      if (trackedGenerationIds.value.size === 0) return
      for (const qItem of queueItems) {
        if (!trackedGenerationIds.value.has(qItem.generationId)) continue
        const idx = results.value.findIndex(r => r.id === qItem.id)
        if (idx >= 0) {
          const existing = results.value[idx]
          // Update existing result if status or url changed
          if (existing && (existing.status !== qItem.status || existing.url !== qItem.url)) {
            results.value.splice(idx, 1, {
              id: qItem.id,
              type: qItem.type,
              url: qItem.url,
              status: qItem.status,
              parentId: qItem.parentId,
            })
          }
        }
      }
    }, { deep: true })
  }

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
      trackedGenerationIds.value.add(result.generation.id)
      // Trigger queue refresh — the sidebar picks it up and handles polling
      queue.refresh()
      queue.startPolling()
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Generation failed'
    } finally {
      submitting.value = false
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
          watchItemCompletion(result.item.id, key)
          queue.refresh()
          queue.startPolling()
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
          watchItemCompletion(result.item.id, key)
          queue.refresh()
          queue.startPolling()
        } else {
          actionLoading.value[key] = false
        }
      }
    } catch (e: any) {
      error.value = e.data?.message || 'Audio generation failed'
      actionLoading.value[key] = false
    }
  }

  /**
   * Watch queue items for an item completing, then clear its actionLoading key.
   * Replaces the old pollItemStatus approach.
   */
  function watchItemCompletion(itemId: string, loadingKey: string) {
    if (import.meta.server) return
    const unwatch = watch(() => queue.items.value, (queueItems) => {
      const item = queueItems.find(i => i.id === itemId)
      if (item && (item.status === 'complete' || item.status === 'failed' || item.status === 'cancelled')) {
        actionLoading.value[loadingKey] = false
        // Also sync into local results
        const idx = results.value.findIndex(r => r.id === itemId)
        if (idx >= 0) {
          results.value.splice(idx, 1, {
            id: item.id,
            type: item.type,
            url: item.url,
            status: item.status,
            parentId: item.parentId,
          })
        }
        unwatch()
      }
    }, { deep: true })
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
    model?: string
    seed?: number
    append?: boolean
  }) {
    if (!opts.prompt.trim()) return

    const durations = Array.isArray(opts.numFrames)
      ? opts.numFrames
      : [opts.numFrames ?? 81]

    submitting.value = true
    error.value = ''
    if (!opts.append) results.value = []


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
            model: opts.model ?? 'wan22',
            seed: opts.seed ?? -1,
          },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        if (result.item) {
          results.value = [...results.value, result.item]
          activeGenerationId.value = result.generation.id
          trackedGenerationIds.value.add(result.generation.id)
          if (result.item.status === 'processing' || result.item.status === 'queued') {
            const key = `t2v-${result.item.id}`
            actionLoading.value[key] = true
            watchItemCompletion(result.item.id, key)
          }
        }
      } catch (e: any) {
        error.value = e.data?.message || e.message || 'Text-to-video generation failed'
      }
    }

    submitting.value = false
    queue.refresh()
    queue.startPolling()
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
    model?: string
    seed?: number
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
              model: opts.model ?? 'wan22',
              seed: opts.seed ?? -1,
            },
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          })

          if (result.item) {
            results.value = [...results.value, result.item]
            trackedGenerationIds.value.add(result.generation.id)
            if (result.item.status === 'processing' || result.item.status === 'queued') {
              const key = `t2v-batch-${result.item.id}`
              actionLoading.value[key] = true
              watchItemCompletion(result.item.id, key)
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
    queue.refresh()
    queue.startPolling()
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

    // Trigger queue refresh for batch tracking
    for (const genId of activeGenerationIds.value) {
      trackedGenerationIds.value.add(genId)
    }
    queue.refresh()
    queue.startPolling()
    submitting.value = false
  }

  // ─── Utilities ──────────────────────────────────────────────────────

  function clearResults() {
    results.value = []
    submitting.value = false
    activeGenerationId.value = null
    trackedGenerationIds.value.clear()
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
      trackedGenerationIds.value.add(result.generation.id)
      queue.refresh()
      queue.startPolling()
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Image-to-image failed'
    } finally {
      submitting.value = false
    }
  }

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
