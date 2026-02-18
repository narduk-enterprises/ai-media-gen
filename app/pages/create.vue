<script setup lang="ts">
import {
  attributeLabels,
  attributeKeys,
  characterAttributeKeys,
  pickRandom,
  buildPrompt as _buildPrompt,
  buildVariedPrompts,
  countActiveAttributes,
  createEmptyAttributes,
  type AttributeKey,
} from '~/utils/promptBuilder'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Create' })

// ─── Core refs ─────────────────────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref('ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts')
const imageCount = ref(4)
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const generating = ref(false)
const error = ref('')
const showAdvanced = ref(false)
const enhancing = ref(false)
const genMode = ref<'image' | 'video'>('image')
const videoDuration = ref(81)
const videoCfg = ref(3.5)
const videoItem = ref<MediaItemResult | null>(null)
const videoPolling = ref(false)
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const showPromptBuilder = ref(false)
const varyPerImage = ref(false)
const showSavedSetups = ref(false)
const savingSetup = ref(false)
const setupName = ref('')
const copiedPrompt = ref(false)

// ─── Lightbox state ────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)

// ─── Accumulated results (supports Load More) ─────────────────────────
const allImages = ref<MediaItemResult[]>([])
const activeGenerationId = ref<string | null>(null)
const lastGenerationSettings = ref<Record<string, any> | null>(null)
const totalGenerated = computed(() => allImages.value.filter(i => i.status === 'complete').length)
const totalFailed = computed(() => allImages.value.filter(i => i.status === 'failed').length)
const pendingCount = computed(() => allImages.value.filter(i => i.status !== 'complete' && i.status !== 'failed').length)

// ─── Prompt Builder ────────────────────────────────────────────────────
const { getPresets, config: presetConfig, projects, activeProject, switchProject, setNegativePrompt } = usePromptPresets()
const attributes = reactive(createEmptyAttributes())

// ─── Persons ───────────────────────────────────────────────────────────
const { persons, addPerson, deletePerson: _deletePerson } = usePersons()
const activePersonId = ref<string | null>(null)
const personDescription = ref('')
const savingPerson = ref(false)
const personName = ref('')

const activePerson = computed(() =>
  persons.value.find((p: any) => p.id === activePersonId.value) ?? null
)

function loadPerson(person: import('~/composables/usePersons').Person) {
  activePersonId.value = person.id
  personDescription.value = (person as any).description || ''
  for (const key of characterAttributeKeys) {
    attributes[key] = person[key]
  }
}

function clearPerson() {
  activePersonId.value = null
  personDescription.value = ''
  for (const key of characterAttributeKeys) {
    attributes[key] = ''
  }
}

function saveAsPerson() {
  const attrs: Record<string, string> = { description: personDescription.value }
  for (const key of characterAttributeKeys) {
    attrs[key] = attributes[key]
  }
  const person = addPerson(personName.value, attrs as any)
  activePersonId.value = person.id
  personName.value = ''
  savingPerson.value = false
}

// ─── Persist form state ────────────────────────────────────────────────
const FORM_STORAGE_KEY = 'ai-media-gen:create-form'

interface PersistedFormState {
  prompt: string
  negativePrompt: string
  genMode: 'image' | 'video'
  imageCount: number
  steps: number
  imageWidth: number
  imageHeight: number
  videoDuration: number
  videoCfg: number
  varyPerImage: boolean
  attributes: Record<string, string>
  activePersonId?: string | null
  personDescription?: string
}

function persistForm() {
  if (import.meta.server) return
  try {
    const state: PersistedFormState = {
      prompt: prompt.value,
      negativePrompt: negativePrompt.value,
      genMode: genMode.value,
      imageCount: imageCount.value,
      steps: steps.value,
      imageWidth: imageWidth.value,
      imageHeight: imageHeight.value,
      videoDuration: videoDuration.value,
      videoCfg: videoCfg.value,
      varyPerImage: varyPerImage.value,
      attributes: { ...attributes },
      activePersonId: activePersonId.value,
      personDescription: personDescription.value,
    }
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

function restoreForm() {
  if (import.meta.server) return
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY)
    if (!raw) return
    const state: PersistedFormState = JSON.parse(raw)
    if (state.prompt != null) prompt.value = state.prompt
    if (state.negativePrompt != null) negativePrompt.value = state.negativePrompt
    if (state.genMode) genMode.value = state.genMode
    if (state.imageCount) imageCount.value = state.imageCount
    if (state.steps) steps.value = state.steps
    if (state.imageWidth) imageWidth.value = state.imageWidth
    if (state.imageHeight) imageHeight.value = state.imageHeight
    if (state.videoDuration) videoDuration.value = state.videoDuration
    if (state.videoCfg) videoCfg.value = state.videoCfg
    if (state.varyPerImage != null) varyPerImage.value = state.varyPerImage
    if (state.attributes) {
      for (const [key, val] of Object.entries(state.attributes)) {
        if (key in attributes) (attributes as Record<string, string>)[key] = val
      }
    }
    if (state.activePersonId) {
      const person = persons.value.find((p: any) => p.id === state.activePersonId)
      if (person) {
        activePersonId.value = person.id
        personDescription.value = state.personDescription || (person as any).description || ''
      }
    }
  } catch { /* ignore */ }
}

onMounted(() => {
  restoreForm()
  // Load project negative prompt if available and form doesn't already have one
  if (activeProject.value?.negativePrompt && !negativePrompt.value) {
    negativePrompt.value = activeProject.value.negativePrompt
  }
})

// Sync negative prompt when switching projects
watch(() => activeProject.value?.id, () => {
  if (activeProject.value?.negativePrompt) {
    negativePrompt.value = activeProject.value.negativePrompt
  }
})

let _saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [prompt, negativePrompt, genMode, imageCount, steps, imageWidth, imageHeight, videoDuration, videoCfg, varyPerImage, activePersonId, personDescription, () => ({ ...attributes })],
  () => {
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(persistForm, 400)
  },
  { deep: true },
)

// ─── Saved Setups ──────────────────────────────────────────────────────
const { setups, saveSetup: _saveSetup, deleteSetup: _deleteSetup } = useSavedSetups()

function saveCurrentSetup() {
  _saveSetup(setupName.value, {
    prompt: prompt.value,
    negativePrompt: negativePrompt.value,
    genMode: genMode.value,
    imageCount: imageCount.value,
    steps: steps.value,
    imageWidth: imageWidth.value,
    imageHeight: imageHeight.value,
    videoDuration: videoDuration.value,
    videoCfg: videoCfg.value,
    varyPerImage: varyPerImage.value,
    attributes: { ...attributes } as Record<import('~/utils/promptBuilder').AttributeKey, string>,
  })
  setupName.value = ''
  savingSetup.value = false
}

function loadSetup(setup: import('~/composables/useSavedSetups').SavedSetup) {
  prompt.value = setup.prompt
  negativePrompt.value = setup.negativePrompt
  genMode.value = setup.genMode
  imageCount.value = setup.imageCount
  steps.value = setup.steps
  imageWidth.value = setup.imageWidth
  imageHeight.value = setup.imageHeight
  videoDuration.value = setup.videoDuration
  if (setup.videoCfg) videoCfg.value = setup.videoCfg
  varyPerImage.value = setup.varyPerImage
  for (const key of Object.keys(setup.attributes) as (keyof typeof setup.attributes)[]) {
    attributes[key] = setup.attributes[key]
  }
}

// ─── In-browser LLM ───────────────────────────────────────────────────
const { isSupported: webGpuSupported, loadProgress, loadingModel, remixPrompt } = useWebLLM()

function randomizeAttribute(key: AttributeKey) {
  const presets = getPresets(key)
  attributes[key] = pickRandom(presets)
}

function randomizeAll() {
  for (const key of attributeKeys) randomizeAttribute(key)
}

function clearAttributes() {
  for (const key of attributeKeys) attributes[key] = ''
}

function pickRandomBasePrompt() {
  if (presetConfig.value.basePrompts.length === 0) return
  prompt.value = pickRandom(presetConfig.value.basePrompts)
}

const composedPrompt = computed(() => {
  const base = personDescription.value
    ? [prompt.value, personDescription.value].filter(s => s.trim()).join(', ')
    : prompt.value
  return _buildPrompt(base, attributes)
})
const activeAttributeCount = computed(() => countActiveAttributes(attributes))

// Sample varied prompts for preview (regenerates when attributes change)
const sampleVariedPrompts = computed(() => {
  if (!varyPerImage.value || imageCount.value <= 1) return []
  const base = personDescription.value
    ? [prompt.value, personDescription.value].filter(s => s.trim()).join(', ')
    : prompt.value
  return buildVariedPrompts(base, attributes, Math.min(3, imageCount.value), presetConfig.value.basePrompts)
})

// ─── Options ───────────────────────────────────────────────────────────
const durationOptions = [
  { label: '3s', value: 81 },
  { label: '5s', value: 121 },
  { label: '7s', value: 161 },
]

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

const countOptions = [1, 2, 4, 8, 16]
const sizeOptions = [
  { label: '512', value: 512 },
  { label: '768', value: 768 },
  { label: '1024', value: 1024 },
  { label: '1536', value: 1536 },
  { label: '2048', value: 2048 },
]

const actionLoading = ref<Record<string, boolean>>({})

// ─── Generation logic ──────────────────────────────────────────────────
async function generate(append = false) {
  if (!prompt.value.trim() && activeAttributeCount.value === 0) return
  if (genMode.value === 'video') return generateT2V()

  generating.value = true
  error.value = ''
  if (!append) allImages.value = []
  stopPolling()

  const finalPrompt = composedPrompt.value || prompt.value
  let perImagePrompts: string[] | undefined
  if (varyPerImage.value && imageCount.value > 1) {
    const baseWithDesc = personDescription.value
      ? [prompt.value, personDescription.value].filter(s => s.trim()).join(', ')
      : prompt.value
    perImagePrompts = buildVariedPrompts(baseWithDesc, attributes, imageCount.value, presetConfig.value.basePrompts)
  }

  try {
    // Build attributes object (only non-empty)
    const activeAttrs: Record<string, string> = {}
    for (const key of attributeKeys) {
      if (attributes[key]) activeAttrs[key] = attributes[key]
    }

    const result = await $fetch<GenerationResult>('/api/generate/image', {
      method: 'POST',
      body: {
        prompt: finalPrompt,
        prompts: perImagePrompts,
        negativePrompt: negativePrompt.value,
        count: imageCount.value,
        steps: steps.value,
        width: imageWidth.value,
        height: imageHeight.value,
        attributes: Object.keys(activeAttrs).length > 0 ? activeAttrs : undefined,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    // Store generation settings for metadata display
    if (result.generation.settings) {
      try { lastGenerationSettings.value = JSON.parse(result.generation.settings) } catch {}
    }

    // Add new items with placeholder status
    const newImages = result.items.filter(i => i.type === 'image')
    allImages.value = [...allImages.value, ...newImages]
    activeGenerationId.value = result.generation.id
    startPolling(result.generation.id)
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Generation failed'
    generating.value = false
  }
}

function loadMore() {
  generate(true)
}

function clearResults() {
  allImages.value = []
  stopPolling()
  generating.value = false
  activeGenerationId.value = null
}

function startPolling(generationId: string) {
  stopPolling()
  const startedAt = Date.now()
  const maxPollMs = 5 * 60 * 1000 // 5 minutes

  pollingTimer.value = setInterval(async () => {
    if (Date.now() - startedAt > maxPollMs) {
      stopPolling()
      generating.value = false
      for (const img of allImages.value) {
        if (img.status === 'processing') {
          img.status = 'failed'
          img.error = 'Generation timed out'
        }
      }
      return
    }

    try {
      const result = await $fetch<GenerationResult>('/api/generate/generation-status', {
        params: { id: generationId },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      // Update matching items in allImages
      for (const updated of result.items) {
        const idx = allImages.value.findIndex(i => i.id === updated.id)
        if (idx >= 0) allImages.value[idx] = updated
      }

      const genItems = result.items.filter(i => i.type === 'image')
      const done = genItems.every(i => i.status === 'complete' || i.status === 'failed')
      if (done) {
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

onUnmounted(() => stopPolling())

// ─── Video generation ──────────────────────────────────────────────────
async function generateT2V() {
  generating.value = true
  error.value = ''
  videoItem.value = null

  try {
    const result = await $fetch<{ generation: any; item: MediaItemResult }>('/api/generate/text2video', {
      method: 'POST',
      body: { prompt: prompt.value, width: 640, height: 640, numFrames: videoDuration.value, steps: 4 },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    videoItem.value = result.item
    videoPolling.value = true
    pollVideoStatus(result.item.id)
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Video generation failed'
    generating.value = false
  }
}

async function pollVideoStatus(itemId: string) {
  const maxAttempts = 120
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const result = await $fetch<{ item: MediaItemResult }>(`/api/generate/status/${itemId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      videoItem.value = result.item
      if (result.item.status === 'complete' || result.item.status === 'failed') {
        generating.value = false
        videoPolling.value = false
        return
      }
    } catch { /* continue */ }
  }
  generating.value = false
  videoPolling.value = false
  error.value = 'Video generation timed out'
}

// ─── Prompt remix ──────────────────────────────────────────────────────
async function enhancePrompt() {
  if (!prompt.value.trim()) return
  enhancing.value = true
  try {
    prompt.value = await remixPrompt(prompt.value)
  } catch (e: any) {
    error.value = e.message || 'Prompt remix failed'
  } finally {
    enhancing.value = false
  }
}

// ─── Image actions ─────────────────────────────────────────────────────
async function makeVideo(mediaItemId: string) {
  actionLoading.value[`video-${mediaItemId}`] = true
  try {
    const result = await $fetch<{ item: MediaItemResult }>('/api/generate/video', {
      method: 'POST',
      body: {
        mediaItemId,
        numFrames: videoDuration.value,
        steps: steps.value,
        cfg: videoCfg.value,
        width: imageWidth.value,
        height: imageHeight.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.item) allImages.value.push(result.item)
  } catch (e: any) {
    error.value = e.data?.message || 'Video generation failed'
  } finally {
    actionLoading.value[`video-${mediaItemId}`] = false
  }
}

async function addAudio(mediaItemId: string) {
  actionLoading.value[`audio-${mediaItemId}`] = true
  try {
    const result = await $fetch<{ item: MediaItemResult }>('/api/generate/audio', {
      method: 'POST',
      body: { mediaItemId, prompt: `ambient music for: ${prompt.value}` },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.item) allImages.value.push(result.item)
  } catch (e: any) {
    error.value = e.data?.message || 'Audio generation failed'
  } finally {
    actionLoading.value[`audio-${mediaItemId}`] = false
  }
}

function downloadImage(url: string, index: number) {
  const a = document.createElement('a')
  a.href = url
  a.download = `generated-${index + 1}.png`
  a.click()
}

function copyPromptToClipboard() {
  const text = composedPrompt.value || prompt.value
  navigator.clipboard.writeText(text)
  copiedPrompt.value = true
  setTimeout(() => copiedPrompt.value = false, 2000)
}

// ─── Lightbox ──────────────────────────────────────────────────────────
const completedImages = computed(() => allImages.value.filter(i => i.status === 'complete' && i.url))

function openLightbox(index: number) {
  // Find the index within completedImages
  lightboxIndex.value = index
  lightboxOpen.value = true
}

function closeLightbox() {
  lightboxOpen.value = false
}

function lightboxNext() {
  if (lightboxIndex.value < completedImages.value.length - 1) lightboxIndex.value++
}

function lightboxPrev() {
  if (lightboxIndex.value > 0) lightboxIndex.value--
}

function handleLightboxKeydown(e: KeyboardEvent) {
  if (!lightboxOpen.value) return
  if (e.key === 'ArrowRight') lightboxNext()
  else if (e.key === 'ArrowLeft') lightboxPrev()
  else if (e.key === 'Escape') closeLightbox()
}

onMounted(() => {
  if (import.meta.client) {
    window.addEventListener('keydown', handleLightboxKeydown)
  }
})

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('keydown', handleLightboxKeydown)
  }
})

const currentLightboxImage = computed(() => completedImages.value[lightboxIndex.value] ?? null)

// ─── Recreate from metadata ────────────────────────────────────────────
function recreateFromSettings() {
  if (!lastGenerationSettings.value) return
  const s = lastGenerationSettings.value
  if (s.negativePrompt != null) negativePrompt.value = s.negativePrompt
  if (s.steps) steps.value = s.steps
  if (s.width) imageWidth.value = s.width
  if (s.height) imageHeight.value = s.height
  if (s.attributes) {
    for (const [key, val] of Object.entries(s.attributes)) {
      if (key in attributes) (attributes as Record<string, string>)[key] = val as string
    }
  }
  closeLightbox()
}

const showLightboxInfo = ref(false)

// ─── Keyboard shortcut for generate ────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate()
}

// ─── Grid columns ──────────────────────────────────────────────────────
const gridClass = computed(() => {
  const count = allImages.value.length
  if (count <= 1) return 'grid-cols-1 max-w-xl mx-auto'
  if (count <= 2) return 'grid-cols-2'
  if (count <= 4) return 'grid-cols-2 xl:grid-cols-4'
  if (count <= 8) return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
  return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-4rem)]">
    <!-- ══════════════════════════════════════════════════════════════════
         LEFT SIDEBAR — Prompt & Controls (sticky)
         ══════════════════════════════════════════════════════════════════ -->
    <aside class="w-[440px] xl:w-[500px] shrink-0 border-r border-slate-200 bg-white overflow-y-auto sticky top-16 h-[calc(100vh-4rem)]">
      <div class="p-5 space-y-4">
        <!-- Header -->
        <div>
          <h1 class="font-display text-xl font-bold text-slate-800 flex items-center gap-2">
            <span class="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-cyan-600">Create</span>
          </h1>
        </div>

        <!-- Project selector -->
        <div v-if="projects.length > 0" class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] text-slate-400 shrink-0">📁</span>
          <button
            v-for="proj in projects"
            :key="proj.id"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border"
            :class="activeProject?.id === proj.id
              ? 'bg-violet-50 border-violet-300 text-violet-700'
              : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'"
            @click="switchProject(proj.id)"
          >
            {{ proj.name }}
          </button>
        </div>

        <!-- ═══ Persona Selector ═══ -->
        <div class="flex items-start gap-1.5">
          <span class="text-[10px] text-slate-400 shrink-0 mt-1">👤</span>
          <div class="flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <button
                v-if="activePersonId"
                class="px-2 py-0.5 rounded-full text-[10px] font-medium text-slate-400 border border-slate-200 hover:border-slate-300 transition-all"
                @click="clearPerson"
              >
                None
              </button>
              <button
                v-for="person in persons"
                :key="person.id"
                class="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border"
                :class="activePersonId === person.id
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'"
                @click="activePersonId === person.id ? clearPerson() : loadPerson(person)"
              >
                {{ person.name }}
              </button>
              <NuxtLink
                to="/personas"
                class="px-1.5 py-0.5 rounded-full text-[10px] text-slate-300 border border-dashed border-slate-200 hover:border-violet-300 hover:text-violet-500 transition-colors"
              >
                {{ persons.length > 0 ? 'Manage →' : '+ Create personas →' }}
              </NuxtLink>
            </div>
            <p v-if="activePersonId && personDescription" class="text-[9px] text-amber-500/70 mt-0.5 leading-relaxed line-clamp-1">
              {{ personDescription }}
            </p>
          </div>
        </div>

        <!-- Saved prompts -->
        <div v-if="presetConfig.basePrompts.length > 0" class="flex items-center gap-1.5">
          <select
            class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30 cursor-pointer appearance-none"
            @change="(e: Event) => { prompt = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).selectedIndex = 0 }"
          >
            <option value="" disabled selected>📝 Saved prompts…</option>
            <option v-for="bp in presetConfig.basePrompts" :key="bp" :value="bp">
              {{ bp.length > 50 ? bp.slice(0, 50) + '…' : bp }}
            </option>
          </select>
          <button
            class="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
            title="Random saved prompt"
            @click="pickRandomBasePrompt"
          >
            🎲
          </button>
        </div>

        <!-- Prompt textarea -->
        <div>
          <textarea
            v-model="prompt"
            placeholder="A cyberpunk city at sunset, neon lights reflecting in puddles…"
            class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm text-slate-800 placeholder-slate-400 resize-vertical focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 leading-relaxed min-h-[160px] transition-all"
            :disabled="generating"
            @keydown="handleKeydown"
          />
          <!-- Prompt toolbar -->
          <div class="flex items-center gap-1.5 mt-1.5">
            <button
              class="text-[10px] text-slate-400 hover:text-violet-600 transition-colors flex items-center gap-0.5"
              :class="{ 'text-emerald-600': copiedPrompt }"
              @click="copyPromptToClipboard"
            >
              {{ copiedPrompt ? '✓ Copied' : '📋 Copy' }}
            </button>
            <span class="text-slate-300">·</span>
            <button
              class="text-[10px] transition-colors flex items-center gap-0.5"
              :class="enhancing || loadingModel ? 'text-violet-500' : (webGpuSupported ? 'text-slate-400 hover:text-violet-600' : 'text-slate-300 cursor-not-allowed')"
              :disabled="!prompt.trim() || generating || !webGpuSupported || enhancing"
              @click="enhancePrompt"
            >
              ✨ {{ loadingModel ? `AI (${loadProgress}%)` : 'Remix' }}
            </button>
            <div class="flex-1" />
            <span class="text-[10px] text-slate-400">⌘+Enter</span>
          </div>
        </div>

        <!-- Negative prompt (collapsed) -->
        <div>
          <button
            class="text-[10px] text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1"
            @click="showAdvanced = !showAdvanced"
          >
            <UIcon :name="showAdvanced ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3 h-3" />
            Negative prompt
          </button>
          <div v-if="showAdvanced" class="mt-1.5">
            <textarea
              v-model="negativePrompt"
              placeholder="Things to avoid…"
              class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 placeholder-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/20 min-h-[50px]"
              :disabled="generating"
            />
          </div>
        </div>

        <!-- ═══ Prompt Builder ═══ -->
        <div class="border-t border-slate-100 pt-3">
          <button
            class="text-xs transition-colors flex items-center gap-1.5 w-full"
            :class="showPromptBuilder ? 'text-violet-600' : 'text-slate-500 hover:text-slate-700'"
            @click="showPromptBuilder = !showPromptBuilder"
          >
            <UIcon :name="showPromptBuilder ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3 h-3" />
            🧩 Prompt Builder
            <span v-if="activeAttributeCount > 0" class="ml-auto px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-medium">
              {{ activeAttributeCount }}
            </span>
          </button>

          <div v-if="showPromptBuilder" class="mt-2 space-y-1.5">
            <!-- Toolbar -->
            <div class="flex items-center gap-1.5 mb-2">
              <button class="px-2 py-1 rounded text-[10px] font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors" @click="randomizeAll">🎲 All</button>
              <button v-if="activeAttributeCount > 0" class="px-2 py-1 rounded text-[10px] font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" @click="clearAttributes">✕ Clear</button>
            </div>

            <!-- ═══ Save as Person ═══ -->
            <div class="py-1.5 border-b border-slate-100">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] text-slate-400 shrink-0">👤</span>
                <span v-if="activePerson" class="text-[10px] text-amber-600 font-medium">{{ activePerson.name }}</span>
                <span v-else class="text-[10px] text-slate-400">No persona</span>
                <div class="flex-1" />
                <button
                  v-if="!savingPerson"
                  class="px-1.5 py-0.5 rounded-full text-[10px] text-slate-400 border border-dashed border-slate-200 hover:border-violet-300 hover:text-violet-600 transition-colors"
                  @click="savingPerson = true"
                >
                  + Save as Persona
                </button>
              </div>
              <div v-if="savingPerson" class="flex items-center gap-1.5 mt-1.5">
                <input
                  v-model="personName"
                  placeholder="Persona name…"
                  class="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                  @keydown.enter="saveAsPerson"
                  @keydown.escape="savingPerson = false"
                />
                <button class="px-2 py-1 rounded text-[10px] font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors" @click="saveAsPerson">Save</button>
                <button class="text-[10px] text-slate-400" @click="savingPerson = false">✕</button>
              </div>
            </div>

            <!-- Attribute rows -->
            <div v-for="(info, key) in attributeLabels" :key="key" class="flex items-center gap-1.5">
              <span class="text-[10px] text-slate-400 w-14 shrink-0 truncate" :title="info.label">{{ info.emoji }} {{ info.label }}</span>
              <input
                v-model="attributes[key]"
                :placeholder="getPresets(key)[0]"
                class="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/20 min-w-0"
                :disabled="generating"
              />
              <select
                class="appearance-none bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px] text-slate-500 focus:outline-none cursor-pointer max-w-[100px]"
                :value="''"
                @change="(e: Event) => { attributes[key] = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = '' }"
              >
                <option value="" disabled selected>▾</option>
                <option v-for="preset in getPresets(key)" :key="preset" :value="preset">{{ preset }}</option>
              </select>
              <button class="p-1 rounded text-slate-400 hover:text-violet-600 transition-colors text-[10px]" @click="randomizeAttribute(key)">🎲</button>
            </div>
          </div>
        </div>

        <!-- ═══ Saved Setups ═══ -->
        <div class="border-t border-slate-100 pt-3">
          <button
            class="text-xs transition-colors flex items-center gap-1.5 w-full"
            :class="showSavedSetups ? 'text-violet-600' : 'text-slate-500 hover:text-slate-700'"
            @click="showSavedSetups = !showSavedSetups"
          >
            <UIcon :name="showSavedSetups ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3 h-3" />
            💾 Setups
            <span v-if="setups.length > 0" class="ml-auto px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-medium">{{ setups.length }}</span>
          </button>

          <div v-if="showSavedSetups" class="mt-2 space-y-2">
            <div v-if="!savingSetup" class="flex items-center gap-1.5">
              <button class="px-2 py-1 rounded text-[10px] font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors" @click="savingSetup = true">💾 Save Current</button>
            </div>
            <div v-else class="flex items-center gap-1.5">
              <input v-model="setupName" placeholder="Name…" class="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/20" @keydown.enter="saveCurrentSetup" @keydown.escape="savingSetup = false" />
              <button class="px-2 py-1 rounded text-[10px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors" @click="saveCurrentSetup">Save</button>
              <button class="text-[10px] text-slate-400" @click="savingSetup = false">✕</button>
            </div>
            <div v-if="setups.length === 0" class="text-center py-3">
              <p class="text-[10px] text-slate-400">No saved setups</p>
            </div>
            <div v-else class="flex flex-wrap gap-1">
              <div
                v-for="setup in setups"
                :key="setup.id"
                class="group flex items-center gap-1 px-2 py-1 rounded bg-slate-50 border border-slate-200 hover:border-violet-300 hover:bg-violet-50 transition-all cursor-pointer text-[10px]"
                @click="loadSetup(setup)"
              >
                <span class="text-slate-600">{{ setup.name }}</span>
                <button class="ml-0.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all" @click.stop="_deleteSetup(setup.id)">✕</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Generation Controls ═══ -->
        <div class="border-t border-slate-100 pt-3 space-y-3">
          <!-- Mode toggle -->
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">Mode</span>
            <button
              class="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
              :class="genMode === 'image' ? 'bg-violet-50 text-violet-700 border border-violet-300' : 'text-slate-400 border border-transparent hover:border-slate-200'"
              @click="genMode = 'image'"
            >🖼️ Image</button>
            <button
              class="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
              :class="genMode === 'video' ? 'bg-cyan-50 text-cyan-700 border border-cyan-300' : 'text-slate-400 border border-transparent hover:border-slate-200'"
              @click="genMode = 'video'"
            >🎬 Video</button>
          </div>

          <!-- Image count -->
          <div v-if="genMode === 'image'" class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">Count</span>
            <button
              v-for="count in countOptions"
              :key="count"
              class="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
              :class="imageCount === count ? 'bg-violet-50 text-violet-700 border border-violet-300' : 'text-slate-400 border border-transparent hover:border-slate-200'"
              @click="imageCount = count"
            >{{ count }}</button>
          </div>

          <!-- Vary per image toggle (prominent, always visible for images) -->
          <div v-if="genMode === 'image' && imageCount > 1" class="flex items-start gap-1.5">
            <span class="text-[10px] text-slate-400 w-14 shrink-0 mt-1">Vary</span>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <div
                  class="relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0"
                  :class="varyPerImage ? 'bg-violet-500' : 'bg-slate-300'"
                  @click="varyPerImage = !varyPerImage"
                >
                  <div class="absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-sm" :class="varyPerImage ? 'translate-x-[17px]' : 'translate-x-[3px]'" />
                </div>
                <span class="text-[10px]" :class="varyPerImage ? 'text-violet-600 font-medium' : 'text-slate-400'">
                  {{ varyPerImage ? `Each of ${imageCount} images will be unique` : 'All images use same prompt' }}
                </span>
              </div>
              <p v-if="varyPerImage" class="text-[9px] text-slate-400 mt-1 leading-relaxed">
                Every image gets random style, lighting, mood, and composition from your presets
              </p>
            </div>
          </div>

          <!-- Video duration (shown for video mode AND for image mode since I2V uses it) -->
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">Duration</span>
            <button
              v-for="dur in durationOptions"
              :key="dur.value"
              class="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
              :class="videoDuration === dur.value ? 'bg-cyan-50 text-cyan-700 border border-cyan-300' : 'text-slate-400 border border-transparent hover:border-slate-200'"
              @click="videoDuration = dur.value"
            >{{ dur.label }}</button>
            <span class="text-[9px] text-slate-300 ml-0.5">video</span>
          </div>

          <!-- CFG (video quality control) -->
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">CFG</span>
            <input v-model.number="videoCfg" type="range" min="1" max="10" step="0.5" class="flex-1 accent-cyan-500 h-1" />
            <span class="text-[10px] text-slate-600 font-mono w-6 text-right">{{ videoCfg }}</span>
            <span class="text-[9px] text-slate-300 ml-0.5">video</span>
          </div>

          <!-- Steps -->
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">Steps</span>
            <input v-model.number="steps" type="range" min="1" max="50" class="flex-1 accent-violet-500 h-1" />
            <span class="text-[10px] text-slate-600 font-mono w-5 text-right">{{ steps }}</span>
          </div>

          <!-- Width -->
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">Width</span>
            <button
              v-for="size in sizeOptions"
              :key="size.value"
              class="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
              :class="imageWidth === size.value ? 'bg-cyan-50 text-cyan-700 border border-cyan-300' : 'text-slate-400 border border-transparent hover:border-slate-200'"
              @click="imageWidth = size.value"
            >{{ size.label }}</button>
          </div>

          <!-- Height -->
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-[10px] text-slate-400 w-14 shrink-0">Height</span>
            <button
              v-for="size in sizeOptions"
              :key="size.value"
              class="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
              :class="imageHeight === size.value ? 'bg-cyan-50 text-cyan-700 border border-cyan-300' : 'text-slate-400 border border-transparent hover:border-slate-200'"
              @click="imageHeight = size.value"
            >{{ size.label }}</button>
          </div>
        </div>

        <!-- ═══ Final Prompt Preview (always visible) ═══ -->
        <div v-if="composedPrompt || prompt.trim()" class="border-t border-slate-100 pt-3">
          <div class="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div class="flex items-center gap-1.5 mb-1.5">
              <span class="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Final Prompt</span>
              <div class="flex-1" />
              <span v-if="varyPerImage && imageCount > 1" class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[9px] font-medium">🎲 {{ imageCount }} unique variants</span>
            </div>
            <p class="text-xs text-slate-700 leading-relaxed">{{ composedPrompt || prompt }}</p>

            <!-- Sample varied prompts when Vary is ON -->
            <div v-if="varyPerImage && imageCount > 1 && sampleVariedPrompts.length > 0" class="mt-2 pt-2 border-t border-slate-200 space-y-1">
              <p class="text-[9px] text-slate-400 uppercase tracking-wider font-medium">Sample variations (each image gets one like these):</p>
              <div v-for="(sp, si) in sampleVariedPrompts" :key="si" class="flex gap-1.5">
                <span class="text-[9px] text-violet-400 font-mono shrink-0">{{ si + 1 }}.</span>
                <p class="text-[10px] text-slate-500 leading-relaxed line-clamp-2">{{ sp }}</p>
              </div>
              <p v-if="imageCount > 3" class="text-[9px] text-slate-400 italic">…and {{ imageCount - 3 }} more unique prompts</p>
            </div>
          </div>
        </div>

        <!-- ═══ Generate Button ═══ -->
        <div class="sticky bottom-0 bg-white pt-2 pb-1 -mx-5 px-5 border-t border-slate-100">
          <UButton
            :loading="generating"
            :disabled="!prompt.trim() && activeAttributeCount === 0"
            @click="generate(false)"
            size="lg"
            block
          >
            <template #leading>
              <UIcon :name="genMode === 'image' ? 'i-heroicons-sparkles' : 'i-heroicons-play'" />
            </template>
            {{ generating ? 'Generating…' : (genMode === 'image' ? (varyPerImage && imageCount > 1 ? `Generate ${imageCount} Unique Images` : `Generate ${imageCount} Image${imageCount > 1 ? 's' : ''}`) : 'Generate Video') }}
          </UButton>
        </div>
      </div>
    </aside>

    <!-- ══════════════════════════════════════════════════════════════════
         RIGHT — Results Area (fills remaining width)
         ══════════════════════════════════════════════════════════════════ -->
    <main class="flex-1 min-w-0 overflow-y-auto bg-slate-50">
      <div class="p-6">
        <!-- Error -->
        <div v-if="error" class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm flex items-start gap-3 max-w-3xl">
          <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 mt-0.5 shrink-0" />
          {{ error }}
          <button class="ml-auto text-red-400 hover:text-red-600" @click="error = ''">✕</button>
        </div>

        <!-- Stats bar (when we have results) -->
        <div v-if="allImages.length > 0" class="flex items-center gap-3 mb-4 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500">
              <span class="font-medium text-slate-700">{{ totalGenerated }}</span> generated
            </span>
            <span v-if="totalFailed > 0" class="text-xs text-red-400">· {{ totalFailed }} failed</span>
            <span v-if="pendingCount > 0" class="text-xs text-violet-500">· {{ pendingCount }} pending</span>
          </div>
          <div class="flex-1" />
          <button
            v-if="!generating"
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors border border-violet-200"
            @click="loadMore"
          >
            ➕ Load More
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            @click="clearResults"
          >
            ✕ Clear
          </button>
        </div>

        <!-- Progress bar -->
        <div v-if="generating && allImages.length > 0" class="mb-4">
          <div class="h-1 bg-slate-200 rounded-full overflow-hidden max-w-lg">
            <div
              class="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-700 ease-out"
              :style="{ width: `${allImages.length > 0 ? (totalGenerated / allImages.length) * 100 : 0}%` }"
            />
          </div>
        </div>

        <!-- Video loading -->
        <div v-if="generating && genMode === 'video'" class="max-w-lg">
          <div class="aspect-video rounded-xl shimmer" />
          <p class="text-center text-sm text-slate-500 mt-4 animate-pulse">
            Generating video… This may take a few minutes
          </p>
        </div>

        <!-- Video result -->
        <div v-else-if="videoItem && videoItem.status === 'complete' && videoItem.url" class="max-w-lg">
          <div class="glass-card p-4 rounded-xl">
            <video :src="videoItem.url" controls autoplay loop class="w-full rounded-lg" />
            <div class="flex items-center justify-between mt-3">
              <span class="text-xs text-slate-500">🎬 Text-to-Video</span>
              <a :href="videoItem.url" download="generated_video.mp4" class="text-xs text-cyan-600 hover:text-cyan-700 transition-colors">Download ↓</a>
            </div>
          </div>
        </div>

        <!-- Video failed -->
        <div v-else-if="videoItem && videoItem.status === 'failed'" class="max-w-lg">
          <div class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">Video generation failed</div>
        </div>

        <!-- ═══ Image Grid ═══ -->
        <div v-else-if="allImages.length > 0">
          <div :class="['grid gap-3', gridClass]">
            <div
              v-for="(item, index) in allImages"
              :key="item.id"
              class="group relative"
            >
              <!-- Completed image -->
              <div
                v-if="item.url && item.status === 'complete'"
                class="relative aspect-square rounded-xl overflow-hidden border border-slate-200 hover:border-violet-300 transition-all cursor-pointer animate-reveal shadow-sm hover:shadow-md"
                @click="openLightbox(completedImages.findIndex(i => i.id === item.id))"
              >
                <NuxtImg
                  :src="item.url"
                  alt="Generated image"
                  width="512"
                  class="w-full h-full object-cover"
                  loading="lazy"
                />

                <!-- Hover overlay -->
                <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <!-- Top-right: download -->
                  <button
                    class="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-all text-xs"
                    title="Download"
                    @click.stop="downloadImage(item.url!, index)"
                  >
                    ⬇
                  </button>

                  <!-- Bottom actions -->
                  <div class="absolute bottom-0 left-0 right-0 p-2.5 flex gap-1.5">
                    <button
                      class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors"
                      :class="{ 'opacity-50 pointer-events-none': actionLoading[`video-${item.id}`] }"
                      @click.stop="makeVideo(item.id)"
                    >
                      🎬 Video
                    </button>
                    <button
                      class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors"
                      :class="{ 'opacity-50 pointer-events-none': actionLoading[`audio-${item.id}`] }"
                      @click.stop="addAudio(item.id)"
                    >
                      🔊 Audio
                    </button>
                  </div>
                </div>

                <!-- Index badge -->
                <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/30 text-white text-[10px] font-mono backdrop-blur-sm">
                  {{ index + 1 }}
                </div>
              </div>

              <!-- Failed -->
              <div v-else-if="item.status === 'failed'" class="aspect-square rounded-xl border border-red-200 bg-red-50 flex items-center justify-center">
                <div class="text-center">
                  <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-400 mx-auto mb-1" />
                  <p class="text-[10px] text-red-500">Failed</p>
                </div>
              </div>

              <!-- Still generating -->
              <div v-else class="aspect-square rounded-xl shimmer relative overflow-hidden border border-slate-200">
                <div class="absolute inset-0 flex items-center justify-center">
                  <div class="text-center">
                    <div class="w-5 h-5 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin mx-auto mb-1" />
                    <p class="text-[10px] text-slate-400">Generating…</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Load More button (bottom of grid) -->
          <div v-if="!generating && totalGenerated > 0" class="mt-6 text-center">
            <button
              class="px-6 py-2.5 rounded-xl text-sm font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors border border-violet-200 shadow-sm hover:shadow"
              @click="loadMore"
            >
              ➕ Generate {{ imageCount }} More
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="!generating" class="flex items-center justify-center h-full min-h-[400px]">
          <div class="text-center">
            <div class="w-24 h-24 mx-auto rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-4">
              <UIcon name="i-heroicons-sparkles" class="w-12 h-12 text-violet-300" />
            </div>
            <p class="text-slate-400 text-sm mb-1">Your creations will appear here</p>
            <p class="text-slate-300 text-xs">Write a prompt and hit Generate</p>
          </div>
        </div>
      </div>
    </main>

    <!-- ══════════════════════════════════════════════════════════════════
         LIGHTBOX — Full-screen with keyboard navigation
         ══════════════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="lightboxOpen && currentLightboxImage"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md"
          @click.self="closeLightbox"
        >
          <!-- Close -->
          <button
            class="absolute top-4 right-4 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all z-10"
            @click="closeLightbox"
          >
            <UIcon name="i-heroicons-x-mark" class="w-6 h-6" />
          </button>

          <!-- Counter -->
          <div class="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-xs font-mono backdrop-blur-sm">
            {{ lightboxIndex + 1 }} / {{ completedImages.length }}
          </div>

          <!-- Prev arrow -->
          <button
            v-if="lightboxIndex > 0"
            class="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
            @click="lightboxPrev"
          >
            <UIcon name="i-heroicons-chevron-left" class="w-8 h-8" />
          </button>

          <!-- Next arrow -->
          <button
            v-if="lightboxIndex < completedImages.length - 1"
            class="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
            @click="lightboxNext"
          >
            <UIcon name="i-heroicons-chevron-right" class="w-8 h-8" />
          </button>

          <!-- Image -->
          <div class="max-w-[90vw] max-h-[85vh] relative">
            <img
              :src="currentLightboxImage.url!"
              :key="currentLightboxImage.id"
              alt="Generated image"
              class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
          </div>

          <!-- Bottom toolbar -->
          <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md">
            <button
              class="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1"
              @click="downloadImage(currentLightboxImage.url!, lightboxIndex)"
            >
              ⬇ Download
            </button>
            <span class="text-white/20">|</span>
            <button
              class="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1"
              :class="{ 'opacity-50 pointer-events-none': actionLoading[`video-${currentLightboxImage.id}`] }"
              @click="makeVideo(currentLightboxImage.id)"
            >
              🎬 Video
            </button>
            <span class="text-white/20">|</span>
            <button
              class="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1"
              :class="{ 'opacity-50 pointer-events-none': actionLoading[`audio-${currentLightboxImage.id}`] }"
              @click="addAudio(currentLightboxImage.id)"
            >
              🔊 Audio
            </button>
            <span class="text-white/20">|</span>
            <button
              class="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1"
              @click="showLightboxInfo = !showLightboxInfo"
            >
              ℹ️ Info
            </button>
            <template v-if="lastGenerationSettings">
              <span class="text-white/20">|</span>
              <button
                class="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1"
                @click="recreateFromSettings"
              >
                🔄 Recreate
              </button>
            </template>
          </div>

          <!-- Info panel -->
          <Transition name="fade">
            <div v-if="showLightboxInfo && lastGenerationSettings" class="absolute bottom-16 left-1/2 -translate-x-1/2 w-[400px] max-h-[300px] overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md p-4 text-sm text-white/80 space-y-2">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs uppercase tracking-wider text-white/50 font-medium">Generation Settings</span>
                <button class="text-white/40 hover:text-white text-xs" @click="showLightboxInfo = false">✕</button>
              </div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span class="text-white/40">Dimensions</span>
                <span>{{ lastGenerationSettings.width }} × {{ lastGenerationSettings.height }}</span>
                <span class="text-white/40">Steps</span>
                <span>{{ lastGenerationSettings.steps }}</span>
                <template v-if="lastGenerationSettings.negativePrompt">
                  <span class="text-white/40">Neg. prompt</span>
                  <span class="truncate" :title="lastGenerationSettings.negativePrompt">{{ lastGenerationSettings.negativePrompt.slice(0, 60) }}…</span>
                </template>
              </div>
              <div v-if="lastGenerationSettings.attributes && Object.keys(lastGenerationSettings.attributes).length > 0" class="border-t border-white/10 pt-2 mt-2">
                <span class="text-xs uppercase tracking-wider text-white/50 font-medium block mb-1">Attributes</span>
                <div class="flex flex-wrap gap-1">
                  <span v-for="(val, key) in lastGenerationSettings.attributes" :key="String(key)" class="px-2 py-0.5 rounded-full bg-white/10 text-[10px]">{{ key }}: {{ val }}</span>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
