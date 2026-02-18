<script setup lang="ts">
import {
  characterAttributeKeys,
  sceneAttributeKeys,
  pickRandom,
  buildBatchPrompts,
  buildPersonaPrompt,
  attributePresets,
  attributeLabels,
} from '~/utils/promptBuilder'
import type { Scene } from '~/composables/useScenes'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Create' })

const MAX_IMAGES_PER_BATCH = 16

// ─── Composables ────────────────────────────────────────────────────────
const { getPresets, config: presetConfig, projects, activeProject, switchProject } = usePromptPresets()
const { persons, getPerson } = usePersons()
const { scenes, getScene } = useScenes()
const { runpodEndpoint } = useAppSettings()

// ─── Persona (single select) ─────────────────────────────────────────────
const activePersonId = ref<string | null>(null)
const activePerson = computed(() =>
  activePersonId.value ? getPerson(activePersonId.value) ?? null : null
)

function selectPerson(id: string | null) {
  activePersonId.value = id
}

function personSummary(person: { name: string; description?: string; [key: string]: any }): string {
  if (person.description?.trim()) {
    return person.description.length > 50 ? person.description.slice(0, 50) + '…' : person.description
  }
  const parts: string[] = []
  for (const key of characterAttributeKeys) {
    if (person[key]) {
      parts.push(person[key])
      if (parts.length >= 2) break
    }
  }
  return parts.join(' · ') || 'No details yet'
}

// ─── Scenes (multi-select). IDs can be scene id or '__random__' for one random scene ─
const selectedSceneIds = ref<string[]>([])

function toggleScene(id: string) {
  const idx = selectedSceneIds.value.indexOf(id)
  if (idx >= 0) {
    selectedSceneIds.value = selectedSceneIds.value.filter((_, i) => i !== idx)
  } else {
    selectedSceneIds.value = [...selectedSceneIds.value, id]
  }
}

function addRandomScene() {
  selectedSceneIds.value = [...selectedSceneIds.value, '__random__']
}

function isSceneSelected(id: string) {
  return selectedSceneIds.value.includes(id)
}

function sceneSummary(scene: Scene): string {
  const parts: string[] = []
  for (const key of sceneAttributeKeys) {
    if (scene[key]?.trim()) {
      parts.push(attributeLabels[key].emoji + ' ' + (scene[key].length > 12 ? scene[key].slice(0, 12) + '…' : scene[key]))
      if (parts.length >= 2) break
    }
  }
  return parts.join(' ') || 'Empty scene'
}

// Resolve selected IDs to scene payloads (for buildBatchPrompts). __random__ → one random scene object.
function getScenePayloads(): Record<string, string>[] {
  const payloads: Record<string, string>[] = []
  for (const id of selectedSceneIds.value) {
    if (id === '__random__') {
      const random: Record<string, string> = {}
      for (const key of sceneAttributeKeys) {
        random[key] = pickRandom(attributePresets[key])
      }
      payloads.push(random)
    } else {
      const scene = getScene(id)
      if (scene) {
        payloads.push({
          scene: scene.scene,
          pose: scene.pose,
          style: scene.style,
          lighting: scene.lighting,
          mood: scene.mood,
          camera: scene.camera,
        })
      }
    }
  }
  return payloads
}

// ─── Base prompt & settings ──────────────────────────────────────────────
const defaultNegativePrompt = 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'
const basePrompt = ref('')
const countPerScene = ref(1)
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const negativePrompt = ref(defaultNegativePrompt)
const showAdvanced = ref(false)
const showBasePrompt = ref(false)

const countPerSceneOptions = [1, 2, 4]
const sizeOptions = [
  { label: '512', value: 512 },
  { label: '768', value: 768 },
  { label: '1024', value: 1024 },
  { label: '1536', value: 1536 },
  { label: '2048', value: 2048 },
]

const scenePayloads = computed(() => getScenePayloads())
const totalRequested = computed(() => scenePayloads.value.length * countPerScene.value)
const totalImages = computed(() => Math.min(totalRequested.value, MAX_IMAGES_PER_BATCH))
const isOverCap = computed(() => totalRequested.value > MAX_IMAGES_PER_BATCH)

const canGenerate = computed(() => {
  if (scenePayloads.value.length === 0) return false
  return totalImages.value >= 1
})

// Preview: sample prompts for first few scene combos
const promptPreviewItems = computed(() => {
  const payloads = scenePayloads.value
  if (payloads.length === 0) return []
  const persona = activePerson.value
    ? { description: activePerson.value.description, ...activePerson.value }
    : { description: '' }
  const base = basePrompt.value.trim() || (presetConfig.value.basePrompts[0] ?? '') || ''
  const out: { label: string; prompt: string }[] = []
  const maxPreview = 3
  for (let i = 0; i < Math.min(payloads.length, maxPreview); i++) {
    const sceneAttrs = payloads[i]!
    const prompt = buildPersonaPrompt(base, persona as Record<string, string>, sceneAttrs, (persona as any)?.description)
    const sceneName = selectedSceneIds.value[i] === '__random__' ? 'Random' : getScene(selectedSceneIds.value[i]!)?.name ?? `Scene ${i + 1}`
    out.push({ label: sceneName, prompt })
  }
  return out
})

// ─── Generation ────────────────────────────────────────────────────────
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

const generating = ref(false)
const error = ref('')
const allImages = ref<MediaItemResult[]>([])
const activeGenerationId = ref<string | null>(null)
const lastGenerationSettings = ref<Record<string, any> | null>(null)
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const totalGenerated = computed(() => allImages.value.filter(i => i.status === 'complete').length)
const totalFailed = computed(() => allImages.value.filter(i => i.status === 'failed').length)
const pendingCount = computed(() => allImages.value.filter(i => i.status !== 'complete' && i.status !== 'failed').length)

async function generate(append = false) {
  if (!canGenerate.value) return

  const payloads = scenePayloads.value
  const persona = activePerson.value
    ? { description: activePerson.value.description ?? '', ...activePerson.value }
    : { description: '', hair: '', eyes: '', bodyType: '', skinTone: '', clothing: '' }

  const basePromptsForBatch = basePrompt.value.trim()
    ? [basePrompt.value.trim()]
    : (presetConfig.value.basePrompts.length > 0 ? presetConfig.value.basePrompts : undefined)
  const batch = buildBatchPrompts(
    persona as Record<string, string>,
    payloads,
    countPerScene.value,
    basePromptsForBatch,
  )

  const prompts = batch.map(b => b.prompt).slice(0, MAX_IMAGES_PER_BATCH)
  const count = prompts.length
  if (count === 0) return

  generating.value = true
  error.value = ''
  if (!append) allImages.value = []
  stopPolling()

  try {
    const result = await $fetch<GenerationResult>('/api/generate/image', {
      method: 'POST',
      body: {
        prompt: prompts[0],
        prompts,
        negativePrompt: negativePrompt.value,
        count,
        steps: steps.value,
        width: imageWidth.value,
        height: imageHeight.value,
        attributes: {},
        endpoint: runpodEndpoint.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result.generation.settings) {
      try {
        lastGenerationSettings.value = JSON.parse(result.generation.settings)
      } catch {}
    }

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

function resetForm() {
  activePersonId.value = null
  selectedSceneIds.value = []
  basePrompt.value = ''
  countPerScene.value = 1
  steps.value = 20
  imageWidth.value = 1024
  imageHeight.value = 1024
  negativePrompt.value = defaultNegativePrompt
  showAdvanced.value = false
  showBasePrompt.value = false
  clearResults()
  persistForm()
}

function startPolling(generationId: string) {
  stopPolling()
  const startedAt = Date.now()
  const maxPollMs = 5 * 60 * 1000

  pollingTimer.value = setInterval(async () => {
    if (Date.now() - startedAt > maxPollMs) {
      stopPolling()
      generating.value = false
      for (const img of allImages.value) {
        if (img.status === 'processing') {
          ;(img as any).status = 'failed'
          ;(img as any).error = 'Generation timed out'
        }
      }
      return
    }

    try {
      const result = await $fetch<GenerationResult>('/api/generate/generation-status', {
        params: { id: generationId },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

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

// ─── Image actions (video, audio, download) ──────────────────────────────
const videoDuration = ref(81)
const videoCfg = ref(3.5)
const actionLoading = ref<Record<string, boolean>>({})

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
        endpoint: runpodEndpoint.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.item) {
      allImages.value.push(result.item)
      if (result.item.status === 'processing') {
        pollItemStatus(result.item.id, `video-${mediaItemId}`)
      } else {
        actionLoading.value[`video-${mediaItemId}`] = false
      }
    }
  } catch (e: any) {
    error.value = e.data?.message || 'Video generation failed'
    actionLoading.value[`video-${mediaItemId}`] = false
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
      const idx = allImages.value.findIndex(img => img.id === itemId)
      if (idx >= 0) allImages.value[idx] = result.item
      if (result.item.status === 'complete' || result.item.status === 'failed') {
        actionLoading.value[loadingKey] = false
        return
      }
    } catch { /* continue */ }
  }
  actionLoading.value[loadingKey] = false
}

async function addAudio(mediaItemId: string) {
  actionLoading.value[`audio-${mediaItemId}`] = true
  try {
    const result = await $fetch<{ item: MediaItemResult }>('/api/generate/audio', {
      method: 'POST',
      body: { mediaItemId, prompt: `ambient music for: ${basePrompt.value || 'image'}`, endpoint: runpodEndpoint.value },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.item) {
      allImages.value.push(result.item)
      if (result.item.status === 'processing') {
        pollItemStatus(result.item.id, `audio-${mediaItemId}`)
      } else {
        actionLoading.value[`audio-${mediaItemId}`] = false
      }
    }
  } catch (e: any) {
    error.value = e.data?.message || 'Audio generation failed'
    actionLoading.value[`audio-${mediaItemId}`] = false
  }
}

function downloadImage(url: string, index: number) {
  const a = document.createElement('a')
  a.href = url
  a.download = `generated-${index + 1}.png`
  a.click()
}

// ─── Lightbox ───────────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const completedMedia = computed(() => allImages.value.filter(i => i.status === 'complete' && i.url))

function openLightbox(index: number) {
  lightboxIndex.value = index
  lightboxOpen.value = true
}

function closeLightbox() {
  lightboxOpen.value = false
}

function lightboxNext() {
  if (lightboxIndex.value < completedMedia.value.length - 1) lightboxIndex.value++
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

const currentLightboxItem = computed(() => completedMedia.value[lightboxIndex.value] ?? null)
const showLightboxInfo = ref(false)

function recreateFromSettings() {
  if (!lastGenerationSettings.value) return
  const s = lastGenerationSettings.value
  if (s.negativePrompt != null) negativePrompt.value = s.negativePrompt
  if (s.steps) steps.value = s.steps
  if (s.width) imageWidth.value = s.width
  if (s.height) imageHeight.value = s.height
  closeLightbox()
}

// ─── Persist form ───────────────────────────────────────────────────────
const FORM_STORAGE_KEY = 'ai-media-gen:create-form'

function persistForm() {
  if (import.meta.server) return
  try {
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({
      activePersonId: activePersonId.value,
      selectedSceneIds: selectedSceneIds.value,
      basePrompt: basePrompt.value,
      countPerScene: countPerScene.value,
      steps: steps.value,
      imageWidth: imageWidth.value,
      imageHeight: imageHeight.value,
      negativePrompt: negativePrompt.value,
    }))
  } catch {}
}

function restoreForm() {
  if (import.meta.server) return
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY)
    if (!raw) return
    const state = JSON.parse(raw)
    if (state.activePersonId != null) activePersonId.value = state.activePersonId
    if (Array.isArray(state.selectedSceneIds)) selectedSceneIds.value = state.selectedSceneIds
    if (state.basePrompt != null) basePrompt.value = state.basePrompt
    if (state.countPerScene != null) countPerScene.value = state.countPerScene
    if (state.steps != null) steps.value = state.steps
    if (state.imageWidth != null) imageWidth.value = state.imageWidth
    if (state.imageHeight != null) imageHeight.value = state.imageHeight
    if (state.negativePrompt != null) negativePrompt.value = state.negativePrompt
  } catch {}
}

onMounted(() => {
  restoreForm()
  if (activeProject.value?.negativePrompt && !negativePrompt.value) {
    negativePrompt.value = activeProject.value.negativePrompt
  }
})

watch(
  [activePersonId, selectedSceneIds, basePrompt, countPerScene, steps, imageWidth, imageHeight, negativePrompt],
  () => { persistForm() },
  { deep: true },
)

// ─── Grid class ─────────────────────────────────────────────────────────
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
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-32">
    <div class="mb-8">
      <h1 class="font-display text-3xl font-bold text-slate-800 mb-1">
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-cyan-600">Create</span>
      </h1>
      <p class="text-sm text-slate-500">
        Pick a persona, choose scenes, and generate. Combine building blocks in a single batch.
      </p>
    </div>

    <!-- Project selector -->
    <div v-if="projects.length > 0" class="flex items-center gap-2 mb-6">
      <span class="text-[10px] text-slate-400">Project</span>
      <button
        v-for="proj in projects"
        :key="proj.id"
        class="px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border"
        :class="activeProject?.id === proj.id
          ? 'bg-violet-50 border-violet-300 text-violet-700'
          : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'"
        @click="switchProject(proj.id)"
      >
        {{ proj.name }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm flex items-start gap-3">
      <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 mt-0.5 shrink-0" />
      {{ error }}
      <button class="ml-auto text-red-400 hover:text-red-600" @click="error = ''">✕</button>
    </div>

    <!-- Section 1: Persona Picker -->
    <section class="mb-8">
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Persona</h2>
      <div class="overflow-x-auto pb-2">
        <div class="inline-flex gap-3">
          <button
            class="shrink-0 w-44 p-3 rounded-xl border-2 text-left transition-all"
            :class="activePersonId === null
              ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70'
              : 'border-slate-200 bg-white hover:border-slate-300'"
            @click="selectPerson(null)"
          >
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-sm shrink-0">—</div>
              <span class="font-medium text-sm text-slate-600">None</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-1 pl-10">Free-form prompt only</p>
          </button>
          <button
            v-for="person in persons"
            :key="person.id"
            class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
            :class="activePersonId === person.id
              ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
            @click="selectPerson(person.id)"
          >
            <div class="flex items-center gap-2.5 mb-1.5">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                :class="activePersonId === person.id ? 'bg-violet-200 text-violet-700' : 'bg-slate-100 text-slate-500'"
              >
                {{ person.name.charAt(0).toUpperCase() }}
              </div>
              <span class="font-medium text-sm text-slate-700 truncate">{{ person.name }}</span>
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ personSummary(person) }}</p>
          </button>
          <NuxtLink
            to="/personas"
            class="shrink-0 w-40 p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-slate-50 flex flex-col items-center justify-center gap-1 transition-all text-slate-400 hover:text-violet-600"
          >
            <span class="text-2xl">+</span>
            <span class="text-[11px] font-medium">Manage personas →</span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- Section 2: Scene Picker (multi-select) -->
    <section class="mb-8">
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Scenes <span class="text-slate-400 font-normal normal-case tracking-normal">(select one or more)</span></h2>
      <div class="overflow-x-auto pb-2">
        <div class="inline-flex gap-3">
          <button
            v-for="scene in scenes"
            :key="scene.id"
            class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
            :class="isSceneSelected(scene.id)
              ? 'ring-2 ring-cyan-400 border-cyan-200 bg-cyan-50/70'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
            @click="toggleScene(scene.id)"
          >
            <div class="flex items-center gap-2.5 mb-1.5">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                :class="isSceneSelected(scene.id) ? 'bg-cyan-200 text-cyan-700' : 'bg-slate-100 text-slate-500'"
              >
                {{ attributeLabels.scene.emoji }}
              </div>
              <span class="font-medium text-sm text-slate-700 truncate">{{ scene.name }}</span>
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ sceneSummary(scene) }}</p>
          </button>
          <button
            class="shrink-0 w-44 p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/30 flex flex-col items-center justify-center gap-1 transition-all"
            @click="addRandomScene"
          >
            <span class="text-2xl text-cyan-400">🎲</span>
            <span class="text-[11px] font-medium text-slate-600">Random Scene</span>
          </button>
          <NuxtLink
            to="/personas"
            class="shrink-0 w-40 p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-slate-50 flex flex-col items-center justify-center gap-1 transition-all text-slate-400 hover:text-violet-600"
          >
            <span class="text-2xl">+</span>
            <span class="text-[11px] font-medium">Manage scenes →</span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- Section 3: Quick Settings -->
    <section class="mb-6 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-500 font-medium">Per scene</span>
          <button
            v-for="n in countPerSceneOptions"
            :key="n"
            class="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
            :class="countPerScene === n ? 'bg-violet-50 text-violet-700 border border-violet-300' : 'text-slate-400 border border-slate-200 hover:border-slate-300'"
            @click="countPerScene = n"
          >
            {{ n }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-500 font-medium">Steps</span>
          <input v-model.number="steps" type="range" min="1" max="50" class="w-24 accent-violet-500 h-1" />
          <span class="text-[10px] text-slate-600 font-mono w-5">{{ steps }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-500 font-medium">Size</span>
          <select
            v-model="imageWidth"
            class="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none"
          >
            <option v-for="s in sizeOptions" :key="s.value" :value="s.value">{{ s.value }}</option>
          </select>
          <span class="text-slate-300">×</span>
          <select
            v-model="imageHeight"
            class="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none"
          >
            <option v-for="s in sizeOptions" :key="s.value" :value="s.value">{{ s.value }}</option>
          </select>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button
            class="text-[10px] text-slate-400 hover:text-slate-600"
            @click="showAdvanced = !showAdvanced"
          >
            Negative prompt
          </button>
          <button
            class="text-[10px] text-slate-400 hover:text-slate-600"
            @click="showBasePrompt = !showBasePrompt"
          >
            Base prompt
          </button>
        </div>
      </div>

      <div v-if="showAdvanced" class="mt-2">
        <textarea
          v-model="negativePrompt"
          placeholder="Things to avoid…"
          class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 placeholder-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/20 min-h-[60px]"
          :disabled="generating"
        />
      </div>

      <div v-if="showBasePrompt" class="mt-2">
        <p class="text-[10px] text-slate-500 mb-1">Optional. Leave empty to use a random project base prompt when available.</p>
        <textarea
          v-model="basePrompt"
          placeholder="e.g. beautiful high-quality photograph of"
          rows="2"
          class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/20"
          :disabled="generating"
        />
        <div v-if="presetConfig.basePrompts.length > 0" class="flex flex-wrap gap-1.5 mt-1.5">
          <button
            v-for="bp in presetConfig.basePrompts.slice(0, 5)"
            :key="bp"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-white border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-600"
            @click="basePrompt = bp"
          >
            {{ bp.length > 35 ? bp.slice(0, 35) + '…' : bp }}
          </button>
        </div>
      </div>

      <p v-if="selectedSceneIds.length > 0" class="mt-3 text-xs text-slate-500">
        <span v-if="isOverCap" class="text-amber-600">Capped at {{ MAX_IMAGES_PER_BATCH }} images per batch. </span>
        {{ scenePayloads.length }} scene(s) × {{ countPerScene }} each = <strong>{{ totalImages }} image{{ totalImages !== 1 ? 's' : '' }}</strong>
      </p>
    </section>

    <!-- Section 4: Prompt Preview -->
    <div v-if="promptPreviewItems.length > 0" class="mb-6 p-4 rounded-xl bg-slate-50/80 border border-slate-200/80">
      <h3 class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Prompt preview</h3>
      <div class="space-y-2">
        <div v-for="(item, i) in promptPreviewItems" :key="i" class="flex gap-2">
          <span class="text-[10px] text-violet-500 font-medium shrink-0">{{ item.label }}:</span>
          <p class="text-xs text-slate-600 leading-relaxed line-clamp-2">{{ item.prompt }}</p>
        </div>
      </div>
    </div>

    <!-- Section 5: Generate Button (sticky) -->
    <div class="fixed bottom-0 left-0 right-0 glass border-t border-slate-200/60 py-3 px-4 z-10">
      <div class="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <button
          class="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-slate-200 transition-all"
          @click="resetForm"
        >
          <span class="flex items-center gap-1.5">
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5" />
            Reset
          </span>
        </button>
        <UButton
          :loading="generating"
          :disabled="!canGenerate"
          size="lg"
          @click="generate(false)"
        >
          <template #leading>
            <UIcon name="i-heroicons-sparkles" />
          </template>
          {{ generating ? 'Generating…' : (totalImages > 0 ? `Generate ${totalImages} Image${totalImages !== 1 ? 's' : ''}` : 'Select at least one scene') }}
          <template v-if="!generating && scenePayloads.length > 0 && totalImages > 0" #trailing>
            <span class="text-[10px] opacity-80">{{ scenePayloads.length }} × {{ countPerScene }}</span>
          </template>
        </UButton>
        <div class="w-[72px]" />
      </div>
    </div>

    <!-- Section 6: Results -->
    <section v-if="allImages.length > 0" class="mt-8">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Results</h2>
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <span class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span class="font-medium text-slate-700">{{ totalGenerated }}</span> done
            </span>
            <span v-if="totalFailed > 0" class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-red-400" />
              {{ totalFailed }} failed
            </span>
            <span v-if="pendingCount > 0" class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              {{ pendingCount }} pending
            </span>
          </div>
        </div>
        <div class="flex gap-2">
          <button
            v-if="!generating && canGenerate"
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition-colors flex items-center gap-1"
            @click="loadMore"
          >
            <UIcon name="i-heroicons-plus" class="w-3.5 h-3.5" /> More
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1"
            @click="clearResults"
          >
            <UIcon name="i-heroicons-x-mark" class="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      </div>

      <div v-if="generating && allImages.length > 0" class="mb-4">
        <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-700 ease-out"
            :style="{ width: `${Math.max(5, (totalGenerated / allImages.length) * 100)}%` }"
          />
        </div>
      </div>

      <div :class="['grid gap-3', gridClass]">
        <div
          v-for="(item, index) in allImages"
          :key="item.id"
          class="group relative animate-reveal"
        >
          <!-- Completed image -->
          <div
            v-if="item.url && item.status === 'complete' && item.type === 'image'"
            class="relative aspect-square rounded-xl overflow-hidden border border-slate-200 hover:border-violet-300 transition-all cursor-pointer shadow-sm hover:shadow-md"
            @click="openLightbox(completedMedia.findIndex(i => i.id === item.id))"
          >
            <NuxtImg
              :src="item.url"
              alt="Generated"
              width="512"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button
                class="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white/80 hover:text-white hover:bg-black/60 text-xs"
                title="Download"
                @click.stop="downloadImage(item.url!, index)"
              >
                <UIcon name="i-heroicons-arrow-down-tray" class="w-4 h-4" />
              </button>
              <div class="absolute bottom-0 left-0 right-0 p-2.5 flex gap-1.5">
                <button
                  class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors"
                  :class="{ 'opacity-50 pointer-events-none': actionLoading[`video-${item.id}`] }"
                  @click.stop="makeVideo(item.id)"
                >
                  <span class="flex items-center justify-center gap-1">
                    <UIcon name="i-heroicons-film" class="w-3.5 h-3.5" />
                    Video
                  </span>
                </button>
                <button
                  class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors"
                  :class="{ 'opacity-50 pointer-events-none': actionLoading[`audio-${item.id}`] }"
                  @click.stop="addAudio(item.id)"
                >
                  <span class="flex items-center justify-center gap-1">
                    <UIcon name="i-heroicons-speaker-wave" class="w-3.5 h-3.5" />
                    Audio
                  </span>
                </button>
              </div>
            </div>
            <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/30 text-white text-[10px] font-mono">
              {{ index + 1 }}
            </div>
          </div>

          <!-- Completed video -->
          <div
            v-else-if="item.url && item.status === 'complete' && item.type === 'video'"
            class="relative aspect-square rounded-xl overflow-hidden border border-cyan-200 hover:border-cyan-400 transition-all cursor-pointer shadow-sm hover:shadow-md bg-slate-900"
            @click="openLightbox(completedMedia.findIndex(i => i.id === item.id))"
          >
            <video
              :src="item.url"
              class="w-full h-full object-cover"
              muted
              loop
              playsinline
              @mouseenter="($event.target as HTMLVideoElement).play()"
              @mouseleave="($event.target as HTMLVideoElement).pause()"
            />
            <div class="absolute top-2 left-2 flex items-center gap-1.5">
              <span class="px-1.5 py-0.5 rounded bg-black/30 text-white text-[10px] font-mono">{{ index + 1 }}</span>
              <span class="px-2 py-0.5 rounded-full bg-cyan-500/80 text-white text-[10px] font-medium flex items-center gap-1">
                <UIcon name="i-heroicons-film" class="w-3 h-3" /> Video
              </span>
            </div>
            <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button
                class="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white/80 hover:text-white hover:bg-black/60 text-xs"
                title="Download"
                @click.stop="downloadImage(item.url!, index)"
              >
                <UIcon name="i-heroicons-arrow-down-tray" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Failed -->
          <div v-else-if="item.status === 'failed'" class="aspect-square rounded-xl border border-red-200 bg-red-50/50 flex flex-col items-center justify-center gap-2">
            <UIcon name="i-heroicons-exclamation-circle" class="w-6 h-6 text-red-300" />
            <p class="text-[10px] text-red-400 font-medium">Failed</p>
          </div>

          <!-- Loading -->
          <div v-else class="aspect-square rounded-xl shimmer border border-slate-200 flex flex-col items-center justify-center gap-2">
            <div class="w-6 h-6 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
            <p class="text-[10px] text-slate-400">{{ item.type === 'video' ? 'Generating video…' : 'Generating…' }}</p>
          </div>
        </div>
      </div>

      <div v-if="!generating && totalGenerated > 0 && canGenerate" class="mt-6 text-center">
        <button
          class="px-6 py-2.5 rounded-xl text-sm font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition-colors inline-flex items-center gap-2"
          @click="loadMore"
        >
          <UIcon name="i-heroicons-plus-circle" class="w-4 h-4" />
          Generate {{ totalImages }} More
        </button>
      </div>
    </section>

    <!-- Empty state -->
    <div v-else-if="!generating" class="flex flex-col items-center justify-center min-h-[280px] text-center">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-50 to-cyan-50 border border-violet-100/50 flex items-center justify-center mb-4">
        <UIcon name="i-heroicons-sparkles" class="w-8 h-8 text-violet-300" />
      </div>
      <p class="text-slate-400 text-sm max-w-xs">Select a persona and one or more scenes above, then hit <strong class="text-slate-500">Generate</strong>.</p>
    </div>
  </div>

  <!-- Lightbox -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="lightboxOpen && currentLightboxItem"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md"
        @click.self="closeLightbox"
      >
        <button
          class="absolute top-4 right-4 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 z-10"
          @click="closeLightbox"
        >
          <UIcon name="i-heroicons-x-mark" class="w-6 h-6" />
        </button>
        <div class="absolute top-4 left-4 flex items-center gap-2">
          <span class="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-xs font-mono">
            {{ lightboxIndex + 1 }} / {{ completedMedia.length }}
          </span>
          <span
            v-if="currentLightboxItem.type === 'video'"
            class="px-2.5 py-1 rounded-full bg-cyan-500/80 text-white text-[10px] font-medium flex items-center gap-1"
          >
            <UIcon name="i-heroicons-film" class="w-3 h-3" /> Video
          </span>
        </div>
        <button
          v-if="lightboxIndex > 0"
          class="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full text-white/40 hover:text-white hover:bg-white/10"
          @click="lightboxPrev"
        >
          <UIcon name="i-heroicons-chevron-left" class="w-8 h-8" />
        </button>
        <button
          v-if="lightboxIndex < completedMedia.length - 1"
          class="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full text-white/40 hover:text-white hover:bg-white/10"
          @click="lightboxNext"
        >
          <UIcon name="i-heroicons-chevron-right" class="w-8 h-8" />
        </button>
        <div class="max-w-[90vw] max-h-[85vh] relative">
          <video
            v-if="currentLightboxItem.type === 'video'"
            :src="currentLightboxItem.url!"
            :key="currentLightboxItem.id"
            class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            controls
            autoplay
            loop
          />
          <img
            v-else
            :src="currentLightboxItem.url!"
            :key="currentLightboxItem.id"
            alt="Generated"
            class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white/10 backdrop-blur-md">
          <button
            class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
            @click="downloadImage(currentLightboxItem.url!, lightboxIndex)"
          >
            <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5" /> Download
          </button>
          <template v-if="currentLightboxItem.type === 'image'">
            <button
              class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5"
              :class="actionLoading[`video-${currentLightboxItem.id}`] ? 'opacity-50 pointer-events-none text-white/30' : 'text-white/60 hover:text-white hover:bg-white/10'"
              @click="makeVideo(currentLightboxItem.id)"
            >
              <UIcon name="i-heroicons-film" class="w-3.5 h-3.5" /> Video
            </button>
            <button
              class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5"
              :class="actionLoading[`audio-${currentLightboxItem.id}`] ? 'opacity-50 pointer-events-none text-white/30' : 'text-white/60 hover:text-white hover:bg-white/10'"
              @click="addAudio(currentLightboxItem.id)"
            >
              <UIcon name="i-heroicons-speaker-wave" class="w-3.5 h-3.5" /> Audio
            </button>
          </template>
          <button
            class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
            @click="showLightboxInfo = !showLightboxInfo"
          >
            <UIcon name="i-heroicons-information-circle" class="w-3.5 h-3.5" /> Info
          </button>
          <button
            v-if="lastGenerationSettings"
            class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
            @click="recreateFromSettings"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5" /> Recreate
          </button>
        </div>
        <Transition name="fade">
          <div v-if="showLightboxInfo && lastGenerationSettings" class="absolute bottom-16 left-1/2 -translate-x-1/2 w-[400px] max-h-[300px] overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md p-4 text-sm text-white/80 space-y-2">
            <div class="flex justify-between mb-2">
              <span class="text-xs uppercase tracking-wider text-white/50 font-medium">Settings</span>
              <button class="text-white/40 hover:text-white text-xs" @click="showLightboxInfo = false">
                <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
              </button>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span class="text-white/40">Dimensions</span>
              <span>{{ lastGenerationSettings.width }} × {{ lastGenerationSettings.height }}</span>
              <span class="text-white/40">Steps</span>
              <span>{{ lastGenerationSettings.steps }}</span>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
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
