/**
 * useGeneration — unified generation composable.
 *
 * All job tracking delegated to useQueue.submitAndTrack().
 * No client-side polling lives here.
 */

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
  // Pod routing is server-side — no endpoint needed from frontend
  const queue = useQueue()

  const submitting = ref(false)
  const error = ref('')
  const results = ref<MediaItemResult[]>([])
  const activeGenerationId = ref<string | null>(null)
  const lastSettings = ref<Record<string, any> | null>(null)
  const actionLoading = ref<Record<string, boolean>>({})
  const batchProgress = ref({ current: 0, total: 0 })
  const trackedGenerationIds = ref<Set<string>>(new Set())

  const generating = computed(() => submitting.value)
  const completed = computed(() => results.value.filter(i => i.status === 'complete'))
  const completedMedia = computed(() => results.value.filter(i => i.status === 'complete' && i.url))
  const totalDone = computed(() => completed.value.length)
  const totalFailed = computed(() => results.value.filter(i => i.status === 'failed').length)
  const totalPending = computed(() => results.value.filter(i => i.status !== 'complete' && i.status !== 'failed').length)

  // Sync local results from queue updates
  if (import.meta.client) {
    watch(() => queue.items.value, (queueItems) => {
      if (trackedGenerationIds.value.size === 0) return
      for (const qItem of queueItems) {
        if (!trackedGenerationIds.value.has(qItem.generationId)) continue
        const idx = results.value.findIndex(r => r.id === qItem.id)
        if (idx >= 0) {
          const existing = results.value[idx]
          if (existing && (existing.status !== qItem.status || existing.url !== qItem.url)) {
            results.value.splice(idx, 1, {
              id: qItem.id, type: qItem.type, url: qItem.url,
              status: qItem.status, parentId: qItem.parentId,
            })
          }
        }
      }
    }, { deep: true })
  }

  // ─── Text-to-Image (handles both single and batch) ─────────────────

  async function generate(opts: {
    prompts: string[]
    negativePrompt: string
    steps: number
    width: number
    height: number
    loraStrength?: number
    cfg?: number
    sampler?: string
    scheduler?: string
    customLoras?: Record<string, number>
    model?: string
    seed?: number
    append?: boolean
    sweepId?: string
    sweepLabel?: string
    anyMachine?: boolean
  }) {
    if (opts.prompts.length === 0) return

    submitting.value = true
    error.value = ''
    if (!opts.append) results.value = []

    // Chunk into batches of MAX_IMAGES_PER_BATCH
    const chunks: string[][] = []
    for (let i = 0; i < opts.prompts.length; i += MAX_IMAGES_PER_BATCH) {
      chunks.push(opts.prompts.slice(i, i + MAX_IMAGES_PER_BATCH))
    }
    if (chunks.length > 1) batchProgress.value = { current: 0, total: opts.prompts.length }

    for (const chunk of chunks) {
      try {
        const body: Record<string, any> = {
          prompt: chunk[0], prompts: chunk,
          negativePrompt: opts.negativePrompt, count: chunk.length,
          steps: opts.steps, width: opts.width, height: opts.height,
          attributes: {},
          loraStrength: opts.loraStrength ?? 1.0, model: opts.model ?? 'wan22',
          seed: opts.seed ?? -1,
          ...(opts.cfg != null ? { cfg: opts.cfg } : {}),
          ...(opts.sampler ? { sampler_name: opts.sampler } : {}),
          ...(opts.scheduler ? { scheduler: opts.scheduler } : {}),
          ...(opts.customLoras ? { customLoras: opts.customLoras } : {}),
          ...(opts.anyMachine ? { anyMachine: true } : {}),
        }
        if (opts.sweepId) { body.sweepId = opts.sweepId; body.sweepLabel = opts.sweepLabel }
        const result = await $fetch<GenerationResult>('/api/generate/image', {
          method: 'POST', body,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        if (result.generation.settings) {
          try { lastSettings.value = JSON.parse(result.generation.settings) } catch {}
        }

        const newItems = result.items.filter(i => i.type === 'image')
        results.value = [...results.value, ...newItems]
        activeGenerationId.value = result.generation.id
        trackedGenerationIds.value.add(result.generation.id)
        if (chunks.length > 1) batchProgress.value.current += chunk.length
        for (const item of newItems) queue.submitAndTrack(item.id)
      } catch (e: any) {
        error.value = e.data?.message || e.message || 'Generation failed'
      }
    }

    submitting.value = false
  }

  // ─── Image-to-Image ─────────────────────────────────────────────────

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
          image: opts.image, prompt: opts.prompt,
          negativePrompt: opts.negativePrompt || '',
          steps: opts.steps || 20, width: opts.width || 1024, height: opts.height || 1024,
          cfg: opts.cfg || 3.5, denoise: opts.denoise || 0.75,

        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      const newItems = result.items.filter(i => i.type === 'image')
      results.value = [...results.value, ...newItems]
      activeGenerationId.value = result.generation.id
      trackedGenerationIds.value.add(result.generation.id)
      for (const item of newItems) queue.submitAndTrack(item.id)
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Image-to-image failed'
    } finally {
      submitting.value = false
    }
  }

  // ─── Image-to-Video ─────────────────────────────────────────────────

  async function makeVideo(mediaItemId: string, opts: {
    model?: string
    prompt?: string
    negativePrompt?: string
    numFrames?: number
    steps?: number
    cfg?: number
    width?: number
    height?: number
    fps?: number
    loraStrength?: number
    imageStrength?: number
    audioPrompt?: string
    preset?: string
    cameraLora?: string
  } = {}) {
    const key = `video-${mediaItemId}`
    actionLoading.value[key] = true
    error.value = ''
    try {
      const body: Record<string, any> = {
        mediaItemId,
        model: opts.model || 'ltx2',
        numFrames: opts.numFrames ?? 241,
        steps: opts.steps ?? 20,
        cfg: opts.cfg ?? 3.5,
        width: opts.width ?? 1280,
        height: opts.height ?? 720,

      }
      if (opts.prompt) body.prompt = opts.prompt
      if (opts.negativePrompt) body.negativePrompt = opts.negativePrompt
      if (opts.model === 'ltx2') {
        body.fps = opts.fps || 24
        body.loraStrength = opts.loraStrength ?? 0.7
        body.imageStrength = opts.imageStrength ?? 1.0
        if (opts.audioPrompt) body.audioPrompt = opts.audioPrompt
        if (opts.preset) body.preset = opts.preset
        if (opts.cameraLora) body.cameraLora = opts.cameraLora
      }
      const result = await $fetch<{ item: MediaItemResult }>('/api/generate/video', {
        method: 'POST', body,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (result.item) {
        results.value.push(result.item)
        queue.submitAndTrack(result.item.id, actionLoading, key)
      }
    } catch (e: any) {
      error.value = e.data?.message || 'Video generation failed'
      actionLoading.value[key] = false
    }
  }

  // ─── Audio ──────────────────────────────────────────────────────────

  async function makeAudio(mediaItemId: string, promptHint: string = '') {
    const key = `audio-${mediaItemId}`
    actionLoading.value[key] = true
    try {
      const result = await $fetch<{ item: MediaItemResult }>('/api/generate/audio', {
        method: 'POST',
        body: {
          mediaItemId,
          prompt: `ambient music for: ${promptHint || 'image'}`,

        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (result.item) {
        results.value.push(result.item)
        queue.submitAndTrack(result.item.id, actionLoading, key)
      }
    } catch (e: any) {
      error.value = e.data?.message || 'Audio generation failed'
      actionLoading.value[key] = false
    }
  }

  // ─── Upscale ────────────────────────────────────────────────────────

  async function upscale(mediaItemId: string, scale: number = 2) {
    const key = `upscale-${mediaItemId}`
    actionLoading.value[key] = true
    error.value = ''
    try {
      const result = await $fetch<{ item: MediaItemResult }>('/api/generate/upscale', {
        method: 'POST',
        body: { mediaItemId, scale },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (result.item) {
        results.value.push(result.item)
        queue.submitAndTrack(result.item.id, actionLoading, key)
      }
    } catch (e: any) {
      error.value = e.data?.message || 'Upscale failed'
      actionLoading.value[key] = false
    }
  }

  // ─── Text-to-Video (handles both single prompt and batch) ───────────

  async function generateText2Video(opts: {
    prompt?: string
    prompts?: string[]
    /** Rich batch items with per-item negativePrompt/audioPrompt overrides */
    batchItems?: { prompt: string; negativePrompt?: string; audioPrompt?: string; steps?: number; cfg?: number; width?: number; height?: number; cameraLora?: string; loraStrength?: number; fps?: number; textEncoder?: string; seed?: number; frames?: number; }[]
    negativePrompt?: string
    numFrames?: number | number[]
    steps?: number
    cfg?: number
    width?: number
    height?: number
    fps?: number
    loraStrength?: number
    model?: string
    seed?: number
    audioPrompt?: string
    cameraLora?: string
    textEncoder?: string
    count?: number
    append?: boolean
  }) {
    // Build the list of items to generate — batchItems take priority
    const itemsToGenerate: { prompt: string; negativePrompt?: string; audioPrompt?: string; steps?: number; cfg?: number; width?: number; height?: number; cameraLora?: string; loraStrength?: number; fps?: number; textEncoder?: string; seed?: number; frames?: number; }[] =
      opts.batchItems?.length
        ? opts.batchItems
        : opts.prompts?.length
          ? opts.prompts.map(p => ({ prompt: p }))
          : opts.prompt?.trim()
            ? [{ prompt: opts.prompt.trim() }]
            : []
    if (itemsToGenerate.length === 0) return

    const durations = Array.isArray(opts.numFrames) ? opts.numFrames : [opts.numFrames ?? 81]
    const totalJobs = itemsToGenerate.reduce((acc, item) => acc + (item.frames ? 1 : durations.length), 0)

    submitting.value = true
    error.value = ''
    if (!opts.append) results.value = []
    if (totalJobs > 1) batchProgress.value = { current: 0, total: totalJobs }

    let batchGenId: string | undefined
    let submitted = 0

    for (const item of itemsToGenerate) {
      const itemDurations = item.frames ? [item.frames] : durations
      for (const nf of itemDurations) {
        try {
          // Per-item overrides fall back to global opts
          const itemNeg = item.negativePrompt ?? opts.negativePrompt ?? ''
          const itemAudio = item.audioPrompt ?? opts.audioPrompt ?? ''

          const result = await $fetch<{
            generation: { id: string; prompt: string; imageCount: number; status: string; createdAt: string }
            item: MediaItemResult
          }>('/api/generate/text2video', {
            method: 'POST',
            body: {
              prompt: item.prompt, negativePrompt: itemNeg,
              numFrames: nf, steps: item.steps ?? opts.steps ?? 20,
              width: item.width ?? opts.width ?? 1280, height: item.height ?? opts.height ?? 720,
              loraStrength: item.loraStrength ?? opts.loraStrength ?? 1.0, model: opts.model ?? 'ltx2',
              seed: item.seed ?? opts.seed ?? -1,
              ...(itemAudio ? { audioPrompt: itemAudio } : {}),
              ...(item.cameraLora || opts.cameraLora ? { cameraLora: item.cameraLora ?? opts.cameraLora } : {}),
              ...(item.textEncoder || opts.textEncoder ? { textEncoder: item.textEncoder ?? opts.textEncoder } : {}),
              ...(item.cfg != null || opts.cfg != null ? { cfg: item.cfg ?? opts.cfg } : {}),
              ...(item.fps != null || opts.fps != null ? { fps: item.fps ?? opts.fps } : {}),
              ...(batchGenId ? { generationId: batchGenId } : {}),
            },
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          })

          if (result.item) {
            if (!batchGenId) batchGenId = result.generation.id
            results.value = [...results.value, result.item]
            activeGenerationId.value = result.generation.id
            trackedGenerationIds.value.add(result.generation.id)
            const key = `t2v-${result.item.id}`
            actionLoading.value[key] = true
            queue.submitAndTrack(result.item.id, actionLoading, key)
          }
        } catch (e: any) {
          error.value = e.data?.message || e.message || 'Text-to-video generation failed'
        }
        submitted++
        if (totalJobs > 1) batchProgress.value.current = submitted
      }
    }

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

  /**
   * Generate a video via the T2I→I2V pipeline:
   * Creates an image from text, then animates it into a video.
   */
  async function generatePipelineVideo(opts: {
    prompt: string
    negativePrompt?: string
    width?: number
    height?: number
    steps?: number
    cfg?: number
    seed?: number
    imageModel?: string
    samplerName?: string
    scheduler?: string
    videoPrompt?: string
    videoModel?: string
    videoSteps?: number
    videoFrames?: number
    videoFps?: number
    loraStrength?: number
    imageStrength?: number
    count?: number
    generationId?: string
  }) {
    const totalJobs = opts.count ?? 1
    submitting.value = true
    error.value = ''
    results.value = []
    if (totalJobs > 1) batchProgress.value = { current: 0, total: totalJobs }

    let batchGenId = opts.generationId
    let submitted = 0

    for (let i = 0; i < totalJobs; i++) {
      try {
        const result = await $fetch<{
          generation: { id: string; prompt: string; imageCount: number; status: string; createdAt: string }
          item: MediaItemResult
        }>('/api/generate/text2image-video', {
          method: 'POST',
          body: {
            prompt: opts.prompt,
            negativePrompt: opts.negativePrompt || '',
            width: opts.width ?? 832,
            height: opts.height ?? 480,
            steps: opts.steps ?? 30,
            cfg: opts.cfg ?? 5.0,
            seed: opts.seed ?? -1,
            imageModel: opts.imageModel ?? 'cyberrealistic_pony',
            samplerName: opts.samplerName,
            scheduler: opts.scheduler,
            videoPrompt: opts.videoPrompt || opts.prompt,
            videoModel: opts.videoModel ?? 'ltx2',
            videoSteps: opts.videoSteps ?? 35,
            videoFrames: opts.videoFrames ?? 97,
            videoFps: opts.videoFps ?? 24,
            loraStrength: opts.loraStrength ?? 1.0,
            imageStrength: opts.imageStrength ?? 1.0,

            ...(batchGenId ? { generationId: batchGenId } : {}),
          },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        if (result.item) {
          if (!batchGenId) batchGenId = result.generation.id
          results.value = [...results.value, result.item]
          activeGenerationId.value = result.generation.id
          trackedGenerationIds.value.add(result.generation.id)
          const key = `pipeline-${result.item.id}`
          actionLoading.value[key] = true
          queue.submitAndTrack(result.item.id, actionLoading, key)
        }
      } catch (e: any) {
        error.value = e.data?.message || e.message || 'Pipeline video generation failed'
      }
      submitted++
      if (totalJobs > 1) batchProgress.value.current = submitted
    }

    submitting.value = false
  }

  return {
    MAX_IMAGES_PER_BATCH,
    generating, submitting, error, results, activeGenerationId, trackedGenerationIds,
    lastSettings, completedMedia, totalDone, totalFailed, totalPending,
    actionLoading, batchProgress,
    generate, generateImage2Image, generateText2Video, generatePipelineVideo,
    makeVideo, makeAudio, upscale,
    clearResults, downloadMedia,
  }
}
