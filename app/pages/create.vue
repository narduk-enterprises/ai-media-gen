<script setup lang="ts">
import {
  characterAttributeKeys,
  sceneAttributeKeys,
  attributeKeys,
  pickRandom,
  buildBatchPrompts,
  buildPersonaPrompt,
  buildPrompt,
  attributePresets,
  attributeLabels,
  createEmptyAttributes,
  type AttributeKey,
} from '~/utils/promptBuilder'
import type { TabsItem } from '@nuxt/ui'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Create' })

// ─── Composables ────────────────────────────────────────────────────────
const { getPresets, config: presetConfig, projects, activeProject, switchProject } = usePromptPresets()
const { persons, getPerson } = usePersons()
const { scenes, getScene } = useScenes()
const gen = useGeneration()

// ─── Mode ───────────────────────────────────────────────────────────────
const mode = ref<string | number>('persona')

const modeTabs: TabsItem[] = [
  { label: 'Persona + Scene', icon: 'i-lucide-users', value: 'persona', slot: 'persona' },
  { label: 'Free Build', icon: 'i-lucide-wand-sparkles', value: 'free', slot: 'free' },
  { label: 'Batch', icon: 'i-lucide-layers', value: 'batch', slot: 'batch' },
  { label: 'Img to Img', icon: 'i-lucide-image-plus', value: 'img2img', slot: 'img2img' },
  { label: 'Text to Video', icon: 'i-lucide-film', value: 'text2video', slot: 'text2video' },
  { label: 'Batch Video', icon: 'i-lucide-clapperboard', value: 'batchvideo', slot: 'batchvideo' },
]

// ─── Shared settings ────────────────────────────────────────────────────
const DEFAULT_NEG = 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const negativePrompt = ref(DEFAULT_NEG)
const loraStrength = ref(1.0)
const showAdvanced = ref(false)

const sizeItems = [512, 768, 1024, 1536, 2048].map(v => ({ label: `${v}`, value: v }))

// ═══════════════════════════════════════════════════════════════════════
// MODE 1: Persona + Scene
// ═══════════════════════════════════════════════════════════════════════

const activePersonId = ref<string | null>(null)
const activePerson = computed(() =>
  activePersonId.value ? getPerson(activePersonId.value) ?? null : null,
)

const selectedSceneIds = ref<string[]>([])
const countPerScene = ref(1)
const basePrompt = ref('')
const showBasePrompt = ref(false)

function toggleScene(id: string) {
  const idx = selectedSceneIds.value.indexOf(id)
  if (idx >= 0) selectedSceneIds.value = selectedSceneIds.value.filter((_, i) => i !== idx)
  else selectedSceneIds.value = [...selectedSceneIds.value, id]
}

function addRandomScene() {
  selectedSceneIds.value = [...selectedSceneIds.value, '__random__']
}

function getScenePayloads(): Record<string, string>[] {
  return selectedSceneIds.value.map(id => {
    if (id === '__random__') {
      const r: Record<string, string> = {}
      for (const key of sceneAttributeKeys) r[key] = pickRandom(attributePresets[key])
      return r
    }
    const scene = getScene(id)
    if (!scene) return null
    return { scene: scene.scene, pose: scene.pose, style: scene.style, lighting: scene.lighting, mood: scene.mood, camera: scene.camera }
  }).filter(Boolean) as Record<string, string>[]
}

const scenePayloads = computed(() => getScenePayloads())
const personaTotal = computed(() => Math.min(scenePayloads.value.length * countPerScene.value, gen.MAX_IMAGES_PER_BATCH))
const canGeneratePersona = computed(() => scenePayloads.value.length > 0 && personaTotal.value >= 1)

const promptPreview = computed(() => {
  const payloads = scenePayloads.value
  if (payloads.length === 0) return []
  const persona = activePerson.value
    ? { description: activePerson.value.description, ...activePerson.value }
    : { description: '' }
  const base = basePrompt.value.trim() || (presetConfig.value.basePrompts[0] ?? '') || ''
  return payloads.slice(0, 3).map((attrs, i) => {
    const prompt = buildPersonaPrompt(base, persona as Record<string, string>, attrs, (persona as any)?.description)
    const name = selectedSceneIds.value[i] === '__random__' ? 'Random' : getScene(selectedSceneIds.value[i]!)?.name ?? `Scene ${i + 1}`
    return { name, prompt }
  })
})

async function generatePersona(append = false) {
  if (!canGeneratePersona.value) return
  const persona = activePerson.value
    ? { description: activePerson.value.description ?? '', ...activePerson.value }
    : { description: '' } as Record<string, string>
  const baseArr = basePrompt.value.trim()
    ? [basePrompt.value.trim()]
    : presetConfig.value.basePrompts.length > 0 ? presetConfig.value.basePrompts : undefined
  const batch = buildBatchPrompts(persona as Record<string, string>, scenePayloads.value, countPerScene.value, baseArr)
  await gen.generate({
    prompts: batch.map(b => b.prompt),
    negativePrompt: negativePrompt.value,
    steps: steps.value,
    width: imageWidth.value,
    height: imageHeight.value,
    loraStrength: loraStrength.value,
    append,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// MODE 2: Free Build
// ═══════════════════════════════════════════════════════════════════════

const freePrompt = ref('')
const freeAttributes = ref<Record<AttributeKey, string>>(createEmptyAttributes())
const freeCount = ref(1)

const freePromptPreview = computed(() => {
  const base = freePrompt.value.trim()
  if (!base && !Object.values(freeAttributes.value).some(v => v.trim())) return ''
  return buildPrompt(base || '', freeAttributes.value as Record<AttributeKey, string>)
})

const canGenerateFree = computed(() => freePromptPreview.value.length > 0)

function randomizeFreeAttr(key: AttributeKey) {
  const pool = getPresets(key)
  freeAttributes.value[key] = pool.length > 0 ? pickRandom(pool) : pickRandom(attributePresets[key])
}

function randomizeAllFreeAttrs() {
  for (const key of attributeKeys) randomizeFreeAttr(key)
}

function clearAllFreeAttrs() {
  for (const key of attributeKeys) freeAttributes.value[key] = ''
}

async function generateFree(append = false) {
  if (!canGenerateFree.value) return
  const prompts: string[] = []
  for (let i = 0; i < freeCount.value; i++) prompts.push(freePromptPreview.value)
  await gen.generate({
    prompts,
    negativePrompt: negativePrompt.value,
    steps: steps.value,
    width: imageWidth.value,
    height: imageHeight.value,
    loraStrength: loraStrength.value,
    append,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// MODE 3: Batch (JSON)
// ═══════════════════════════════════════════════════════════════════════

const batchPrompts = ref<string[]>([])
const batchCountPerPrompt = ref(1)

const batchExpandedPrompts = computed(() => {
  const out: string[] = []
  for (const p of batchPrompts.value) {
    for (let i = 0; i < batchCountPerPrompt.value; i++) out.push(p)
  }
  return out
})

const batchTotal = computed(() => batchExpandedPrompts.value.length)
const canGenerateBatch = computed(() => batchPrompts.value.length > 0 && batchTotal.value > 0)

async function generateBatch() {
  if (!canGenerateBatch.value) return
  await gen.generateBatch({
    prompts: batchExpandedPrompts.value,
    negativePrompt: negativePrompt.value,
    steps: steps.value,
    width: imageWidth.value,
    height: imageHeight.value,
    loraStrength: loraStrength.value,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// MODE: Image to Image
// ═══════════════════════════════════════════════════════════════════════

const i2iPrompt = ref('')
const i2iImageBase64 = ref('')
const i2iImagePreview = ref('')
const i2iCfg = ref(3.5)
const i2iDenoise = ref(0.75)
const i2iSteps = ref(20)

const canGenerateI2I = computed(() => i2iImageBase64.value.length > 0 && i2iPrompt.value.trim().length > 0)

function handleI2IFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    i2iImagePreview.value = dataUrl
    // Strip the data:image/xxx;base64, prefix
    i2iImageBase64.value = dataUrl.replace(/^data:image\/[^;]+;base64,/, '')
  }
  reader.readAsDataURL(file)
}

function handleI2IDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    i2iImagePreview.value = dataUrl
    i2iImageBase64.value = dataUrl.replace(/^data:image\/[^;]+;base64,/, '')
  }
  reader.readAsDataURL(file)
}

function clearI2IImage() {
  i2iImageBase64.value = ''
  i2iImagePreview.value = ''
}

async function generateI2I() {
  if (!canGenerateI2I.value) return
  await gen.generateImage2Image({
    image: i2iImageBase64.value,
    prompt: i2iPrompt.value.trim(),
    negativePrompt: negativePrompt.value,
    steps: i2iSteps.value,
    width: imageWidth.value,
    height: imageHeight.value,
    cfg: i2iCfg.value,
    denoise: i2iDenoise.value,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// MODE 4: Text to Video
// ═══════════════════════════════════════════════════════════════════════

const t2vPrompt = ref('')
const t2vNegativePrompt = ref('')
const t2vNumFrames = ref<number[]>([81])
const t2vCount = ref(1)
const t2vSteps = ref(4)
const t2vResolutionIndex = ref(0)

const t2vResolutionPresets = [
  { label: '640 × 640', w: 640, h: 640 },
  { label: '512 × 512', w: 512, h: 512 },
  { label: '768 × 512', w: 768, h: 512 },
  { label: '512 × 768', w: 512, h: 768 },
  { label: '832 × 480', w: 832, h: 480 },
  { label: '480 × 832', w: 480, h: 832 },
]

const t2vCurrentResolution = computed(() => t2vResolutionPresets[t2vResolutionIndex.value]!)
const t2vTotal = computed(() => t2vNumFrames.value.length * t2vCount.value)
const canGenerateT2V = computed(() => t2vPrompt.value.trim().length > 0)

const durationPresets = [
  { label: '~1.7s', value: 41, description: 'Quick' },
  { label: '~3.4s', value: 81, description: 'Standard' },
  { label: '~5s', value: 121, description: 'Long' },
  { label: '~6.7s', value: 161, description: 'Extended' },
  { label: '~8.4s', value: 201, description: 'Maximum' },
]

async function generateText2Video() {
  if (!canGenerateT2V.value) return
  const expandedFrames: number[] = []
  for (const nf of t2vNumFrames.value) {
    for (let i = 0; i < t2vCount.value; i++) expandedFrames.push(nf)
  }
  await gen.generateText2Video({
    prompt: t2vPrompt.value.trim(),
    negativePrompt: t2vNegativePrompt.value,
    numFrames: expandedFrames,
    steps: t2vSteps.value,
    width: t2vCurrentResolution.value.w,
    height: t2vCurrentResolution.value.h,
    loraStrength: loraStrength.value,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// MODE 5: Batch Video
// ═══════════════════════════════════════════════════════════════════════

const bvPrompts = ref<string[]>([])
const bvNumFrames = ref<number[]>([81])
const bvSteps = ref(4)
const bvResolutionIndex = ref(0)
const bvNegativePrompt = ref('')

const bvCurrentResolution = computed(() => t2vResolutionPresets[bvResolutionIndex.value]!)
const bvTotal = computed(() => bvPrompts.value.length * bvNumFrames.value.length)
const canGenerateBV = computed(() => bvPrompts.value.length > 0)

async function generateBatchVideo() {
  if (!canGenerateBV.value) return
  await gen.generateBatchText2Video({
    prompts: bvPrompts.value,
    negativePrompt: bvNegativePrompt.value,
    numFrames: bvNumFrames.value,
    steps: bvSteps.value,
    width: bvCurrentResolution.value.w,
    height: bvCurrentResolution.value.h,
    loraStrength: loraStrength.value,
  })
}

// ─── Shared: can generate / generate ────────────────────────────────────
const canGenerate = computed(() => {
  if (mode.value === 'persona') return canGeneratePersona.value
  if (mode.value === 'free') return canGenerateFree.value
  if (mode.value === 'batch') return canGenerateBatch.value
  if (mode.value === 'img2img') return canGenerateI2I.value
  if (mode.value === 'text2video') return canGenerateT2V.value
  if (mode.value === 'batchvideo') return canGenerateBV.value
  return false
})

const isVideoMode = computed(() => mode.value === 'text2video' || mode.value === 'batchvideo')

function handleGenerate(append = false) {
  if (mode.value === 'persona') generatePersona(append)
  else if (mode.value === 'free') generateFree(append)
  else if (mode.value === 'batch') generateBatch()
  else if (mode.value === 'img2img') generateI2I()
  else if (mode.value === 'text2video') generateText2Video()
  else if (mode.value === 'batchvideo') generateBatchVideo()
}

function totalForButton() {
  if (mode.value === 'persona') return personaTotal.value
  if (mode.value === 'batch') return batchTotal.value
  if (mode.value === 'text2video') return t2vTotal.value
  if (mode.value === 'batchvideo') return bvTotal.value
  return freeCount.value
}

// ─── Video modal ────────────────────────────────────────────────────────
const videoModalOpen = ref(false)
const videoModalTarget = ref<string | null>(null)

function openVideoModal(mediaItemId: string) {
  videoModalTarget.value = mediaItemId
  videoModalOpen.value = true
}

function handleVideoGenerate(settings: { numFrames: number; steps: number; cfg: number; width: number; height: number }) {
  if (!videoModalTarget.value) return
  gen.makeVideo(videoModalTarget.value, settings)
  videoModalOpen.value = false
  videoModalTarget.value = null
}

// ─── Lightbox ───────────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)

function openLightbox(index: number) {
  lightboxIndex.value = index
  lightboxOpen.value = true
}

const lightboxItems = computed(() =>
  gen.completedMedia.value.map(m => ({
    id: m.id,
    url: m.url!,
    type: m.type,
  }))
)

// ─── Persist form ───────────────────────────────────────────────────────
const FORM_KEY = 'ai-media-gen:create-form'

function persistForm() {
  if (import.meta.server) return
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify({
      mode: mode.value,
      activePersonId: activePersonId.value,
      selectedSceneIds: selectedSceneIds.value,
      basePrompt: basePrompt.value,
      countPerScene: countPerScene.value,
      freePrompt: freePrompt.value,
      freeAttributes: freeAttributes.value,
      freeCount: freeCount.value,
      steps: steps.value,
      imageWidth: imageWidth.value,
      imageHeight: imageHeight.value,
      negativePrompt: negativePrompt.value,
      t2vPrompt: t2vPrompt.value,
      t2vNegativePrompt: t2vNegativePrompt.value,
      t2vNumFrames: t2vNumFrames.value,
      t2vSteps: t2vSteps.value,
      t2vResolutionIndex: t2vResolutionIndex.value,
      bvNumFrames: bvNumFrames.value,
      bvSteps: bvSteps.value,
      bvResolutionIndex: bvResolutionIndex.value,
      bvNegativePrompt: bvNegativePrompt.value,
      loraStrength: loraStrength.value,
    }))
  } catch {}
}

function restoreForm() {
  if (import.meta.server) return
  try {
    const raw = localStorage.getItem(FORM_KEY)
    if (!raw) return
    const s = JSON.parse(raw)
    if (s.mode) mode.value = s.mode
    if (s.activePersonId != null) activePersonId.value = s.activePersonId
    if (Array.isArray(s.selectedSceneIds)) selectedSceneIds.value = s.selectedSceneIds
    if (s.basePrompt != null) basePrompt.value = s.basePrompt
    if (s.countPerScene != null) countPerScene.value = s.countPerScene
    if (s.freePrompt != null) freePrompt.value = s.freePrompt
    if (s.freeAttributes) freeAttributes.value = { ...createEmptyAttributes(), ...s.freeAttributes }
    if (s.freeCount != null) freeCount.value = s.freeCount
    if (s.steps != null) steps.value = s.steps
    if (s.imageWidth != null) imageWidth.value = s.imageWidth
    if (s.imageHeight != null) imageHeight.value = s.imageHeight
    if (s.negativePrompt != null) negativePrompt.value = s.negativePrompt
    if (s.t2vPrompt != null) t2vPrompt.value = s.t2vPrompt
    if (s.t2vNegativePrompt != null) t2vNegativePrompt.value = s.t2vNegativePrompt
    if (s.t2vNumFrames != null) t2vNumFrames.value = Array.isArray(s.t2vNumFrames) ? s.t2vNumFrames : [s.t2vNumFrames]
    if (s.t2vSteps != null) t2vSteps.value = s.t2vSteps
    if (s.t2vResolutionIndex != null) t2vResolutionIndex.value = s.t2vResolutionIndex
    if (s.bvNumFrames != null) bvNumFrames.value = Array.isArray(s.bvNumFrames) ? s.bvNumFrames : [s.bvNumFrames]
    if (s.bvSteps != null) bvSteps.value = s.bvSteps
    if (s.bvResolutionIndex != null) bvResolutionIndex.value = s.bvResolutionIndex
    if (s.bvNegativePrompt != null) bvNegativePrompt.value = s.bvNegativePrompt
    if (s.loraStrength != null) loraStrength.value = s.loraStrength
  } catch {}
}

onMounted(() => {
  restoreForm()
  if (activeProject.value?.negativePrompt && !negativePrompt.value) {
    negativePrompt.value = activeProject.value.negativePrompt
  }
})

watch(
  [mode, activePersonId, selectedSceneIds, basePrompt, countPerScene, freePrompt, freeAttributes, freeCount, steps, imageWidth, imageHeight, negativePrompt, loraStrength, t2vPrompt, t2vNegativePrompt, t2vNumFrames, t2vSteps, t2vResolutionIndex, bvNumFrames, bvSteps, bvResolutionIndex, bvNegativePrompt],
  () => persistForm(),
  { deep: true },
)

function resetForm() {
  activePersonId.value = null
  selectedSceneIds.value = []
  basePrompt.value = ''
  countPerScene.value = 1
  freePrompt.value = ''
  freeAttributes.value = createEmptyAttributes()
  freeCount.value = 1
  batchPrompts.value = []
  batchCountPerPrompt.value = 1
  steps.value = 20
  imageWidth.value = 1024
  imageHeight.value = 1024
  negativePrompt.value = DEFAULT_NEG
  showAdvanced.value = false
  showBasePrompt.value = false
  t2vPrompt.value = ''
  t2vNegativePrompt.value = ''
  t2vNumFrames.value = [81]
  t2vSteps.value = 4
  t2vResolutionIndex.value = 0
  bvPrompts.value = []
  bvNumFrames.value = [81]
  bvSteps.value = 4
  bvResolutionIndex.value = 0
  bvNegativePrompt.value = ''
  gen.clearResults()
  persistForm()
}

// ─── Helpers ────────────────────────────────────────────────────────────
function personSummary(person: { name: string; description?: string; [key: string]: any }): string {
  if (person.description?.trim()) return person.description.length > 50 ? person.description.slice(0, 50) + '…' : person.description
  const parts: string[] = []
  for (const key of characterAttributeKeys) {
    if (person[key]) { parts.push(person[key]); if (parts.length >= 2) break }
  }
  return parts.join(' · ') || 'No details yet'
}

function sceneSummary(scene: any): string {
  const parts: string[] = []
  for (const key of sceneAttributeKeys) {
    if (scene[key]?.trim()) {
      parts.push(attributeLabels[key].emoji + ' ' + (scene[key].length > 12 ? scene[key].slice(0, 12) + '…' : scene[key]))
      if (parts.length >= 2) break
    }
  }
  return parts.join(' ') || 'Empty scene'
}

const gridClass = computed(() => {
  const c = gen.results.value.length
  if (c <= 1) return 'grid-cols-1 max-w-xl mx-auto'
  if (c <= 2) return 'grid-cols-2'
  if (c <= 4) return 'grid-cols-2 xl:grid-cols-4'
  return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-32">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="font-display text-3xl font-bold text-slate-800 mb-1">
          <span class="text-transparent bg-clip-text bg-linear-to-r from-violet-600 to-cyan-600">Create</span>
        </h1>
        <p class="text-sm text-slate-500">{{ isVideoMode ? (mode === 'batchvideo' ? 'Generate multiple videos from a batch of prompts.' : 'Create videos from text prompts.') : 'Build prompts and generate images in batches.' }}</p>
      </div>
      <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-rotate-ccw" @click="resetForm">
        Start Over
      </UButton>
    </div>

    <!-- Project selector -->
    <div v-if="projects.length > 0" class="flex items-center gap-2 mb-6">
      <span class="text-[10px] text-slate-400 font-medium">Project</span>
      <UButton
        v-for="proj in projects"
        :key="proj.id"
        size="xs"
        :variant="activeProject?.id === proj.id ? 'soft' : 'ghost'"
        :color="activeProject?.id === proj.id ? 'primary' : 'neutral'"
        @click="switchProject(proj.id)"
      >
        {{ proj.name }}
      </UButton>
    </div>

    <!-- Error -->
    <UAlert
      v-if="gen.error.value"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="gen.error.value"
      :close="true"
      class="mb-6"
      @update:open="gen.error.value = ''"
    />

    <!-- ═══ Mode Tabs ═══ -->
    <UTabs v-model="mode" :items="modeTabs" class="mb-6" variant="pill">
      <!-- Persona + Scene mode -->
      <template #persona>
        <div class="space-y-6 pt-4">
          <!-- Persona picker -->
          <section>
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Persona</h2>
              <UButton to="/personas" variant="link" size="xs" trailing-icon="i-lucide-arrow-right">Manage</UButton>
            </div>
            <div class="overflow-x-auto pb-2">
              <div class="inline-flex gap-3">
                <button
                  class="shrink-0 w-44 p-3 rounded-xl border-2 text-left transition-all"
                  :class="activePersonId === null ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70' : 'border-slate-200 bg-white hover:border-slate-300'"
                  @click="activePersonId = null"
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
                  :class="activePersonId === person.id ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
                  @click="activePersonId = person.id"
                >
                  <div class="flex items-center gap-2.5 mb-1.5">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      :class="activePersonId === person.id ? 'bg-violet-200 text-violet-700' : 'bg-slate-100 text-slate-500'"
                    >{{ person.name.charAt(0).toUpperCase() }}</div>
                    <span class="font-medium text-sm text-slate-700 truncate">{{ person.name }}</span>
                  </div>
                  <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ personSummary(person) }}</p>
                </button>
              </div>
            </div>
          </section>

          <!-- Scene picker -->
          <section>
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Scenes <span class="text-slate-400 font-normal normal-case tracking-normal">(select one or more)</span>
                </h2>
                <UButton v-if="selectedSceneIds.length > 0" variant="ghost" color="error" size="xs" icon="i-lucide-x" @click="selectedSceneIds = []">
                  Clear {{ selectedSceneIds.length }}
                </UButton>
              </div>
              <UButton to="/personas" variant="link" size="xs" trailing-icon="i-lucide-arrow-right">Manage</UButton>
            </div>
            <div class="overflow-x-auto pb-2">
              <div class="inline-flex gap-3">
                <button
                  v-for="scene in scenes"
                  :key="scene.id"
                  class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
                  :class="selectedSceneIds.includes(scene.id) ? 'ring-2 ring-cyan-400 border-cyan-200 bg-cyan-50/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
                  @click="toggleScene(scene.id)"
                >
                  <div class="flex items-center gap-2.5 mb-1.5">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                      :class="selectedSceneIds.includes(scene.id) ? 'bg-cyan-200 text-cyan-700' : 'bg-slate-100 text-slate-500'"
                    >{{ attributeLabels.scene.emoji }}</div>
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
              </div>
            </div>
          </section>

          <!-- Per-scene count -->
          <CountSelector v-model="countPerScene" label="Per scene" :options="[1, 2, 4]">
            <p v-if="scenePayloads.length > 0" class="text-xs text-slate-500 ml-auto">
              {{ scenePayloads.length }} scene(s) × {{ countPerScene }} =
              <strong>{{ personaTotal }} image{{ personaTotal !== 1 ? 's' : '' }}</strong>
            </p>
          </CountSelector>

          <!-- Base prompt override -->
          <div>
            <UButton variant="link" size="xs" color="neutral" @click="showBasePrompt = !showBasePrompt">
              {{ showBasePrompt ? 'Hide' : 'Show' }} base prompt
            </UButton>
            <div v-if="showBasePrompt" class="mt-2 space-y-2">
              <PromptInput v-model="basePrompt" label="Base Prompt" placeholder="e.g. beautiful high-quality photograph of" :disabled="gen.generating.value">
                <template #actions>
                  <template v-if="presetConfig.basePrompts.length > 0">
                    <UButton
                      v-for="bp in presetConfig.basePrompts.slice(0, 5)"
                      :key="bp"
                      size="xs"
                      variant="outline"
                      color="neutral"
                      @click="basePrompt = bp"
                    >
                      {{ bp.length > 35 ? bp.slice(0, 35) + '…' : bp }}
                    </UButton>
                  </template>
                </template>
              </PromptInput>
            </div>
          </div>

          <!-- Prompt preview -->
          <UCard v-if="promptPreview.length > 0" variant="subtle">
            <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Prompt preview</div>
            <div class="space-y-2">
              <div v-for="(item, i) in promptPreview" :key="i" class="flex gap-2">
                <UBadge size="xs" variant="subtle">{{ item.name }}</UBadge>
                <p class="text-xs text-slate-600 leading-relaxed line-clamp-2">{{ item.prompt }}</p>
              </div>
            </div>
          </UCard>
        </div>
      </template>

      <!-- Free Build mode -->
      <template #free>
        <div class="space-y-6 pt-4">
          <PromptInput v-model="freePrompt" :disabled="gen.generating.value" />

          <!-- Attributes -->
          <section>
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Attributes</h2>
              <div class="flex gap-2">
                <UButton size="xs" variant="ghost" color="primary" icon="i-lucide-shuffle" @click="randomizeAllFreeAttrs">Randomize All</UButton>
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="clearAllFreeAttrs">Clear</UButton>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div v-for="key in attributeKeys" :key="key" class="flex items-center gap-2">
                <label class="text-[11px] text-slate-500 font-medium w-20 shrink-0 flex items-center gap-1">
                  <span>{{ attributeLabels[key].emoji }}</span>
                  <span>{{ attributeLabels[key].label }}</span>
                </label>
                <UInput v-model="freeAttributes[key]" :placeholder="attributePresets[key][0]" size="sm" class="flex-1" :disabled="gen.generating.value" />
                <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="randomizeFreeAttr(key)" />
              </div>
            </div>
          </section>

          <CountSelector v-model="freeCount" label="Images" :options="[1, 2, 4, 8]" />

          <!-- Preview -->
          <UCard v-if="freePromptPreview" variant="subtle">
            <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Composed prompt</div>
            <p class="text-xs text-slate-600 leading-relaxed">{{ freePromptPreview }}</p>
          </UCard>
        </div>
      </template>

      <!-- Batch mode -->
      <template #batch>
        <div class="space-y-6 pt-4">
          <BatchJsonInput v-model:prompts="batchPrompts">
            <template #badges>
              <UBadge size="xs" variant="subtle" color="primary">{{ batchTotal }} total image{{ batchTotal !== 1 ? 's' : '' }}</UBadge>
              <UBadge v-if="batchTotal > gen.MAX_IMAGES_PER_BATCH" size="xs" variant="subtle" color="warning">
                {{ Math.ceil(batchTotal / gen.MAX_IMAGES_PER_BATCH) }} batches
              </UBadge>
            </template>
          </BatchJsonInput>

          <CountSelector v-model="batchCountPerPrompt" label="Images per prompt" :options="[1, 2, 4]" />

          <!-- Batch progress -->
          <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
            <div class="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
            <div class="text-xs text-violet-700">
              Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} to API. Waiting for results…
            </div>
          </div>
        </div>
      </template>

      <!-- Text to Video mode -->
      <template #text2video>
        <div class="space-y-6 pt-4">
          <PromptInput v-model="t2vPrompt" placeholder="Describe the video you want to generate..." :disabled="gen.generating.value" />

          <UFormField label="Negative prompt" size="sm">
            <UTextarea v-model="t2vNegativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
          </UFormField>

          <DurationPicker v-model="t2vNumFrames" :presets="durationPresets" />
          <CountSelector v-model="t2vCount" label="Videos per duration" :options="[1, 2, 4]" />
          <StepsSlider v-model="t2vSteps" />
          <ResolutionPicker v-model="t2vResolutionIndex" :presets="t2vResolutionPresets" />

          <!-- Summary -->
          <UCard v-if="t2vPrompt.trim()" variant="subtle">
            <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Video settings</div>
            <p class="text-xs text-slate-600">
              {{ t2vTotal }} video{{ t2vTotal !== 1 ? 's' : '' }} ({{ t2vNumFrames.length }} duration{{ t2vNumFrames.length !== 1 ? 's' : '' }} × {{ t2vCount }}) ·
              {{ t2vNumFrames.map(f => durationPresets.find(p => p.value === f)?.label ?? f + 'f').join(', ') }} ·
              {{ t2vSteps }} steps · {{ t2vCurrentResolution.w }}×{{ t2vCurrentResolution.h }}
            </p>
          </UCard>
        </div>
      </template>

      <!-- Batch Video mode -->
      <template #batchvideo>
        <div class="space-y-6 pt-4">
          <BatchJsonInput
            v-model:prompts="bvPrompts"
            label="Upload Video Prompts JSON"
            placeholder='["a cat walking through a garden", "ocean waves crashing"]'
          >
            <template #hint>
              <br />Each prompt generates one video. Videos are submitted sequentially and polled in parallel.
            </template>
            <template #badges>
              <UBadge size="xs" variant="subtle" color="info">
                {{ bvNumFrames.map(f => durationPresets.find(p => p.value === f)?.label ?? f + 'f').join(', ') }} · {{ bvSteps }} steps · {{ bvCurrentResolution.w }}×{{ bvCurrentResolution.h }}
              </UBadge>
            </template>
          </BatchJsonInput>

          <UFormField label="Negative prompt" size="sm">
            <UTextarea v-model="bvNegativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
          </UFormField>

          <DurationPicker v-model="bvNumFrames" :presets="durationPresets" />
          <StepsSlider v-model="bvSteps" />
          <ResolutionPicker v-model="bvResolutionIndex" :presets="t2vResolutionPresets" />

          <!-- Batch progress -->
          <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200">
            <div class="w-4 h-4 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
            <div class="text-xs text-cyan-700">
              Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} videos to API. Waiting for results…
            </div>
          </div>
        </div>
      </template>

      <!-- Img2Img mode -->
      <template #img2img>
        <div class="space-y-6 pt-4">
          <!-- Image upload -->
          <section>
            <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Source Image</h2>
            <div
              v-if="!i2iImagePreview"
              class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50/30 transition-colors"
              @click="($refs.i2iFileInput as HTMLInputElement)?.click()"
              @dragover.prevent
              @drop="handleI2IDrop"
            >
              <div class="text-slate-400 mb-2">
                <UIcon name="i-lucide-upload" class="w-8 h-8" />
              </div>
              <p class="text-sm text-slate-500">Drop an image here or click to browse</p>
              <p class="text-xs text-slate-400 mt-1">PNG, JPG, WebP</p>
            </div>
            <div v-else class="relative inline-block">
              <img :src="i2iImagePreview" class="max-h-64 rounded-xl border border-slate-200" />
              <UButton
                icon="i-lucide-x"
                color="error"
                variant="solid"
                size="xs"
                class="absolute top-2 right-2"
                @click="clearI2IImage"
              />
            </div>
            <input
              ref="i2iFileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="handleI2IFileChange"
            />
          </section>

          <!-- Prompt -->
          <PromptInput v-model="i2iPrompt" label="New Prompt" placeholder="Describe the style or changes you want..." />

          <!-- Controls -->
          <div class="flex flex-wrap gap-x-6 gap-y-3">
            <UFormField label="CFG" size="sm" description="Higher = follow prompt more">
              <div class="flex items-center gap-2">
                <USlider v-model="i2iCfg" :min="1" :max="15" :step="0.5" class="w-28" size="xs" />
                <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ i2iCfg }}</span>
              </div>
            </UFormField>
            <UFormField label="Steps" size="sm">
              <div class="flex items-center gap-2">
                <USlider v-model="i2iSteps" :min="4" :max="40" class="w-28" size="xs" />
                <span class="text-xs text-slate-600 font-mono w-5 text-right">{{ i2iSteps }}</span>
              </div>
            </UFormField>
          </div>
        </div>
      </template>
    </UTabs>

    <!-- ═══ Shared Settings ═══ -->
    <UCard class="mb-6" variant="outline">
      <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <UFormField label="Steps" size="sm">
          <div class="flex items-center gap-2">
            <USlider v-model="steps" :min="1" :max="50" class="w-28" size="xs" />
            <span class="text-xs text-slate-600 font-mono w-5 text-right">{{ steps }}</span>
          </div>
        </UFormField>

        <UFormField label="Width" size="sm">
          <USelect v-model="imageWidth" :items="sizeItems" size="sm" class="w-24" />
        </UFormField>

        <UFormField label="Height" size="sm">
          <USelect v-model="imageHeight" :items="sizeItems" size="sm" class="w-24" />
        </UFormField>

        <UFormField label="LoRA" size="sm" description="Speed LoRA strength">
          <div class="flex items-center gap-2">
            <USlider v-model="loraStrength" :min="0" :max="2" :step="0.05" class="w-28" size="xs" />
            <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ loraStrength.toFixed(2) }}</span>
          </div>
        </UFormField>

        <UButton variant="link" size="xs" color="neutral" class="ml-auto" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? 'Hide' : 'Show' }} negative prompt
        </UButton>
      </div>

      <div v-if="showAdvanced" class="mt-3 pt-3 border-t border-slate-100">
        <UTextarea v-model="negativePrompt" placeholder="Things to avoid..." :rows="2" autoresize size="sm" :disabled="gen.generating.value" class="w-full" />
      </div>
    </UCard>

    <!-- ═══ Generate Button (sticky) ═══ -->
    <div class="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 py-3 px-4 z-10">
      <div class="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="resetForm">Start Over</UButton>
          <UButton v-if="gen.results.value.length > 0" variant="ghost" color="error" size="sm" icon="i-lucide-trash-2" @click="gen.clearResults()">Clear Results</UButton>
        </div>
        <UButton
          :loading="gen.generating.value"
          :disabled="!canGenerate"
          size="lg"
          :icon="isVideoMode ? 'i-lucide-film' : 'i-lucide-sparkles'"
          @click="handleGenerate(false)"
        >
          {{ gen.generating.value ? 'Generating…' : (canGenerate ? (isVideoMode ? `Generate ${totalForButton()} Video${totalForButton() !== 1 ? 's' : ''}` : `Generate ${totalForButton()} Image${totalForButton() !== 1 ? 's' : ''}`) : 'Configure above') }}
        </UButton>
      </div>
    </div>

    <!-- ═══ Results ═══ -->
    <section v-if="gen.results.value.length > 0" class="mt-8">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Results</h2>
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <span v-if="gen.totalDone.value > 0" class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <strong>{{ gen.totalDone.value }}</strong> done
            </span>
            <span v-if="gen.totalFailed.value > 0" class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-red-400" />
              {{ gen.totalFailed.value }} failed
            </span>
            <span v-if="gen.totalPending.value > 0" class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              {{ gen.totalPending.value }} pending
            </span>
          </div>
        </div>
        <div class="flex gap-2">
          <UButton v-if="!gen.generating.value && canGenerate" variant="soft" size="xs" icon="i-lucide-plus" @click="handleGenerate(true)">More</UButton>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-x" @click="gen.clearResults()">Clear</UButton>
        </div>
      </div>

      <!-- Progress -->
      <UProgress
        v-if="gen.generating.value && gen.results.value.length > 0"
        :value="Math.max(5, (gen.totalDone.value / gen.results.value.length) * 100)"
        class="mb-4"
        size="xs"
      />

      <!-- Grid -->
      <div :class="['grid gap-3', gridClass]">
        <MediaResultCard
          v-for="(item, index) in gen.results.value"
          :key="item.id"
          :item="item"
          :index="index"
          :action-loading="gen.actionLoading.value"
          @click="openLightbox(gen.completedMedia.value.findIndex(i => i.id === item.id))"
          @video="openVideoModal"
          @audio="gen.makeAudio($event, freePrompt || basePrompt)"
        />
      </div>

      <div v-if="!gen.generating.value && gen.totalDone.value > 0 && canGenerate" class="mt-6 text-center">
        <UButton variant="soft" icon="i-lucide-plus-circle" @click="handleGenerate(true)">
          Generate {{ totalForButton() }} More
        </UButton>
      </div>
    </section>

    <!-- Empty state -->
    <div v-else-if="!gen.generating.value" class="flex flex-col items-center justify-center min-h-[280px] text-center">
      <div class="w-16 h-16 rounded-2xl bg-linear-to-br from-violet-50 to-cyan-50 border border-violet-100/50 flex items-center justify-center mb-4">
        <UIcon name="i-lucide-sparkles" class="w-8 h-8 text-violet-300" />
      </div>
      <p class="text-slate-400 text-sm max-w-xs">
        {{ mode === 'persona' ? 'Select scenes above, then hit Generate.' : mode === 'text2video' ? 'Enter a prompt and configure video settings, then Generate.' : mode === 'batchvideo' ? 'Upload a JSON array of prompts to generate multiple videos.' : 'Enter a prompt and configure attributes, then Generate.' }}
      </p>
    </div>
  </div>

  <!-- ═══ Lightbox ═══ -->
  <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
    <template #toolbar="{ item }">
      <template v-if="item.type === 'image'">
        <UButton variant="ghost" size="xs" icon="i-lucide-film" class="text-white/60 hover:text-white"
          :loading="gen.actionLoading.value[`video-${item.id}`]" @click="openVideoModal(item.id)">
          Video
        </UButton>
        <UButton variant="ghost" size="xs" icon="i-lucide-music" class="text-white/60 hover:text-white"
          :loading="gen.actionLoading.value[`audio-${item.id}`]" @click="gen.makeAudio(item.id, freePrompt || basePrompt)">
          Audio
        </UButton>
      </template>
    </template>
  </AppLightbox>

  <!-- Video Settings Modal -->
  <VideoSettingsModal
    :open="videoModalOpen"
    :loading="videoModalTarget ? gen.actionLoading.value[`video-${videoModalTarget}`] : false"
    @close="videoModalOpen = false"
    @generate="handleVideoGenerate"
  />
</template>
