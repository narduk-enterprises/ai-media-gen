<script setup lang="ts">
import {
  sceneAttributeKeys,
  attributeKeys,
  pickRandom,
  buildBatchPrompts,
  buildPersonaPrompt,
  buildPrompt,
  attributePresets,
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
const shared = useCreateShared()

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

// ═══ MODE 1: Persona + Scene ═══════════════════════════════════════════
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
function addRandomScene() { selectedSceneIds.value = [...selectedSceneIds.value, '__random__'] }

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
    ? { ...activePerson.value, description: activePerson.value.description }
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
    ? { ...activePerson.value, description: activePerson.value.description ?? '' }
    : { description: '' } as Record<string, string>
  const baseArr = basePrompt.value.trim()
    ? [basePrompt.value.trim()]
    : presetConfig.value.basePrompts.length > 0 ? presetConfig.value.basePrompts : undefined
  const batch = buildBatchPrompts(persona as Record<string, string>, scenePayloads.value, countPerScene.value, baseArr)
  for (const model of shared.selectedModels.value) {
    const m = shared.IMAGE_MODELS.find(m => m.id === model)
    await gen.generate({
      prompts: batch.map(b => b.prompt),
      negativePrompt: shared.negativePrompt.value,
      steps: shared.compareMode.value ? (m?.defaultSteps ?? shared.steps.value) : shared.steps.value,
      width: shared.imageWidth.value,
      height: shared.imageHeight.value,
      loraStrength: shared.loraStrength.value,
      model,
      seed: shared.imageSeed.value,
      append: append || shared.selectedModels.value.indexOf(model) > 0,
    })
  }
}

// ═══ MODE 2: Free Build ═════════════════════════════════════════════════
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
function randomizeAllFreeAttrs() { for (const key of attributeKeys) randomizeFreeAttr(key) }
function clearAllFreeAttrs() { for (const key of attributeKeys) freeAttributes.value[key] = '' }

async function generateFree(append = false) {
  if (!canGenerateFree.value) return
  const prompts: string[] = []
  for (let i = 0; i < freeCount.value; i++) prompts.push(freePromptPreview.value)
  for (const model of shared.selectedModels.value) {
    const m = shared.IMAGE_MODELS.find(m => m.id === model)
    await gen.generate({
      prompts,
      negativePrompt: shared.negativePrompt.value,
      steps: shared.compareMode.value ? (m?.defaultSteps ?? shared.steps.value) : shared.steps.value,
      width: shared.imageWidth.value, height: shared.imageHeight.value,
      loraStrength: shared.loraStrength.value, model,
      seed: shared.imageSeed.value,
      append: append || shared.selectedModels.value.indexOf(model) > 0,
    })
  }
}

// ═══ MODE 3: Batch (JSON) ═══════════════════════════════════════════════
const batchPrompts = ref<string[]>([])
const batchCountPerPrompt = ref(1)
const batchExpandedPrompts = computed(() => {
  const out: string[] = []
  for (const p of batchPrompts.value) { for (let i = 0; i < batchCountPerPrompt.value; i++) out.push(p) }
  return out
})
const batchTotal = computed(() => batchExpandedPrompts.value.length)
const canGenerateBatch = computed(() => batchPrompts.value.length > 0 && batchTotal.value > 0)

async function generateBatch() {
  if (!canGenerateBatch.value) return
  await gen.generateBatch({
    prompts: batchExpandedPrompts.value, negativePrompt: shared.negativePrompt.value,
    steps: shared.steps.value, width: shared.imageWidth.value, height: shared.imageHeight.value,
    loraStrength: shared.loraStrength.value, model: shared.selectedModels.value[0] ?? 'wan22', seed: shared.imageSeed.value,
  })
}

// ═══ MODE 4: Image to Image ════════════════════════════════════════════
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
  reader.onload = () => { const d = reader.result as string; i2iImagePreview.value = d; i2iImageBase64.value = d.replace(/^data:image\/[^;]+;base64,/, '') }
  reader.readAsDataURL(file)
}
function handleI2IDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => { const d = reader.result as string; i2iImagePreview.value = d; i2iImageBase64.value = d.replace(/^data:image\/[^;]+;base64,/, '') }
  reader.readAsDataURL(file)
}
function clearI2IImage() { i2iImageBase64.value = ''; i2iImagePreview.value = '' }

async function generateI2I() {
  if (!canGenerateI2I.value) return
  await gen.generateImage2Image({
    image: i2iImageBase64.value, prompt: i2iPrompt.value.trim(), negativePrompt: shared.negativePrompt.value,
    steps: i2iSteps.value, width: shared.imageWidth.value, height: shared.imageHeight.value, cfg: i2iCfg.value, denoise: i2iDenoise.value,
  })
}

// ═══ MODE 5: Text to Video ═════════════════════════════════════════════
const t2vPrompt = ref('')
const t2vNegativePrompt = ref('')
const t2vNumFrames = ref<number[]>([81])
const t2vCount = ref(1)
const t2vSteps = ref(4)
const t2vSeed = ref(-1)
const t2vResolutionIndex = ref(0)
const t2vCurrentResolution = computed(() => shared.t2vResolutionPresets[t2vResolutionIndex.value]!)
const t2vTotal = computed(() => t2vNumFrames.value.length * t2vCount.value)
const canGenerateT2V = computed(() => t2vPrompt.value.trim().length > 0)

async function generateText2Video() {
  if (!canGenerateT2V.value) return
  const expandedFrames: number[] = []
  for (const nf of t2vNumFrames.value) { for (let i = 0; i < t2vCount.value; i++) expandedFrames.push(nf) }
  await gen.generateText2Video({
    prompt: t2vPrompt.value.trim(), negativePrompt: t2vNegativePrompt.value, numFrames: expandedFrames,
    steps: t2vSteps.value, width: t2vCurrentResolution.value.w, height: t2vCurrentResolution.value.h,
    loraStrength: shared.loraStrength.value, model: shared.selectedVideoModel.value, seed: t2vSeed.value,
  })
}

// ═══ MODE 6: Batch Video ═══════════════════════════════════════════════
const bvPrompts = ref<string[]>([])
const bvNumFrames = ref<number[]>([81])
const bvSteps = ref(4)
const bvSeed = ref(-1)
const bvResolutionIndex = ref(0)
const bvNegativePrompt = ref('')
const bvCurrentResolution = computed(() => shared.t2vResolutionPresets[bvResolutionIndex.value]!)
const bvTotal = computed(() => bvPrompts.value.length * bvNumFrames.value.length)
const canGenerateBV = computed(() => bvPrompts.value.length > 0)

async function generateBatchVideo() {
  if (!canGenerateBV.value) return
  await gen.generateBatchText2Video({
    prompts: bvPrompts.value, negativePrompt: bvNegativePrompt.value, numFrames: bvNumFrames.value,
    steps: bvSteps.value, width: bvCurrentResolution.value.w, height: bvCurrentResolution.value.h,
    loraStrength: shared.loraStrength.value, model: shared.selectedVideoModel.value, seed: bvSeed.value,
  })
}

// ─── Shared: generate / can generate ────────────────────────────────────
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
const showSharedSettings = computed(() => !isVideoMode.value && mode.value !== 'img2img')

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

// ─── Video modal / Lightbox ─────────────────────────────────────────────
const videoModalOpen = ref(false)
const videoModalTarget = ref<string | null>(null)
function openVideoModal(mediaItemId: string) { videoModalTarget.value = mediaItemId; videoModalOpen.value = true }
function handleVideoGenerate(settings: { numFrames: number; steps: number; cfg: number; width: number; height: number }) {
  if (!videoModalTarget.value) return
  gen.makeVideo(videoModalTarget.value, settings)
  videoModalOpen.value = false; videoModalTarget.value = null
}

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
function openLightbox(index: number) { lightboxIndex.value = index; lightboxOpen.value = true }
const lightboxItems = computed(() => gen.completedMedia.value.map(m => ({ id: m.id, url: m.url!, type: m.type })))

// ─── Persist & Restore ─────────────────────────────────────────────────
onMounted(() => {
  const s = shared.restoreForm()
  if (s.mode) mode.value = s.mode
  if (s.activePersonId != null) activePersonId.value = s.activePersonId
  if (Array.isArray(s.selectedSceneIds)) selectedSceneIds.value = s.selectedSceneIds
  if (s.basePrompt != null) basePrompt.value = s.basePrompt
  if (s.countPerScene != null) countPerScene.value = s.countPerScene
  if (s.freePrompt != null) freePrompt.value = s.freePrompt
  if (s.freeAttributes) freeAttributes.value = { ...createEmptyAttributes(), ...s.freeAttributes }
  if (s.freeCount != null) freeCount.value = s.freeCount
  if (s.t2vPrompt != null) t2vPrompt.value = s.t2vPrompt
  if (s.t2vNegativePrompt != null) t2vNegativePrompt.value = s.t2vNegativePrompt
  if (s.t2vNumFrames != null) t2vNumFrames.value = Array.isArray(s.t2vNumFrames) ? s.t2vNumFrames : [s.t2vNumFrames]
  if (s.t2vSteps != null) t2vSteps.value = s.t2vSteps
  if (s.t2vSeed != null) t2vSeed.value = s.t2vSeed
  if (s.t2vResolutionIndex != null) t2vResolutionIndex.value = s.t2vResolutionIndex
  if (s.bvNumFrames != null) bvNumFrames.value = Array.isArray(s.bvNumFrames) ? s.bvNumFrames : [s.bvNumFrames]
  if (s.bvSteps != null) bvSteps.value = s.bvSteps
  if (s.bvSeed != null) bvSeed.value = s.bvSeed
  if (s.bvResolutionIndex != null) bvResolutionIndex.value = s.bvResolutionIndex
  if (s.bvNegativePrompt != null) bvNegativePrompt.value = s.bvNegativePrompt
  if (activeProject.value?.negativePrompt && !shared.negativePrompt.value) shared.negativePrompt.value = activeProject.value.negativePrompt
})

watch(
  [mode, activePersonId, selectedSceneIds, basePrompt, countPerScene, freePrompt, freeAttributes, freeCount,
   shared.steps, shared.imageWidth, shared.imageHeight, shared.negativePrompt, shared.loraStrength, shared.selectedModels, shared.selectedVideoModel, shared.imageSeed,
   t2vPrompt, t2vNegativePrompt, t2vNumFrames, t2vSteps, t2vSeed, t2vResolutionIndex, bvNumFrames, bvSteps, bvSeed, bvResolutionIndex, bvNegativePrompt],
  () => shared.persistForm({ mode: mode.value, activePersonId: activePersonId.value, selectedSceneIds: selectedSceneIds.value,
    basePrompt: basePrompt.value, countPerScene: countPerScene.value, freePrompt: freePrompt.value, freeAttributes: freeAttributes.value,
    freeCount: freeCount.value, t2vPrompt: t2vPrompt.value, t2vNegativePrompt: t2vNegativePrompt.value, t2vNumFrames: t2vNumFrames.value,
    t2vSteps: t2vSteps.value, t2vSeed: t2vSeed.value, t2vResolutionIndex: t2vResolutionIndex.value, bvNumFrames: bvNumFrames.value, bvSteps: bvSteps.value,
    bvSeed: bvSeed.value, bvResolutionIndex: bvResolutionIndex.value, bvNegativePrompt: bvNegativePrompt.value }),
  { deep: true },
)

function resetForm() {
  activePersonId.value = null; selectedSceneIds.value = []; basePrompt.value = ''; countPerScene.value = 1
  freePrompt.value = ''; freeAttributes.value = createEmptyAttributes(); freeCount.value = 1
  batchPrompts.value = []; batchCountPerPrompt.value = 1
  t2vPrompt.value = ''; t2vNegativePrompt.value = ''; t2vNumFrames.value = [81]; t2vSteps.value = 4; t2vSeed.value = -1; t2vResolutionIndex.value = 0
  bvPrompts.value = []; bvNumFrames.value = [81]; bvSteps.value = 4; bvSeed.value = -1; bvResolutionIndex.value = 0; bvNegativePrompt.value = ''
  shared.resetShared(); gen.clearResults(); shared.persistForm()
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
      <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-rotate-ccw" @click="resetForm">Start Over</UButton>
    </div>

    <!-- Project selector -->
    <div v-if="projects.length > 0" class="flex items-center gap-2 mb-6">
      <span class="text-[10px] text-slate-400 font-medium">Project</span>
      <UButton v-for="proj in projects" :key="proj.id" size="xs" :variant="activeProject?.id === proj.id ? 'soft' : 'ghost'" :color="activeProject?.id === proj.id ? 'primary' : 'neutral'" @click="switchProject(proj.id)">{{ proj.name }}</UButton>
    </div>

    <!-- Error -->
    <UAlert v-if="gen.error.value" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="gen.error.value" :close="true" class="mb-6" @update:open="gen.error.value = ''" />

    <!-- ═══ Mode Tabs ═══ -->
    <UTabs v-model="mode" :items="modeTabs" class="mb-6" variant="pill">
      <template #persona>
        <CreatePersonaTab
          :persons="persons" :scenes="scenes" :active-person-id="activePersonId" :selected-scene-ids="selectedSceneIds"
          :count-per-scene="countPerScene" :base-prompt="basePrompt" :show-base-prompt="showBasePrompt"
          :preset-base-prompts="presetConfig.basePrompts" :prompt-preview="promptPreview" :scene-payloads="scenePayloads"
          :persona-total="personaTotal" :disabled="gen.generating.value"
          @update:active-person-id="activePersonId = $event" @update:selected-scene-ids="selectedSceneIds = $event"
          @update:count-per-scene="countPerScene = $event" @update:base-prompt="basePrompt = $event"
          @update:show-base-prompt="showBasePrompt = $event" @toggle-scene="toggleScene" @add-random-scene="addRandomScene"
        />
      </template>

      <template #free>
        <CreateFreeTab
          :prompt="freePrompt" :attributes="freeAttributes" :count="freeCount" :prompt-preview="freePromptPreview" :disabled="gen.generating.value"
          @update:prompt="freePrompt = $event" @update:attributes="freeAttributes = $event" @update:count="freeCount = $event"
          @randomize-attr="randomizeFreeAttr" @randomize-all="randomizeAllFreeAttrs" @clear-all="clearAllFreeAttrs"
        />
      </template>

      <template #batch>
        <div class="space-y-6 pt-4">
          <BatchJsonInput v-model:prompts="batchPrompts">
            <template #badges>
              <UBadge size="xs" variant="subtle" color="primary">{{ batchTotal }} total image{{ batchTotal !== 1 ? 's' : '' }}</UBadge>
              <UBadge v-if="batchTotal > gen.MAX_IMAGES_PER_BATCH" size="xs" variant="subtle" color="warning">{{ Math.ceil(batchTotal / gen.MAX_IMAGES_PER_BATCH) }} batches</UBadge>
            </template>
          </BatchJsonInput>
          <CountSelector v-model="batchCountPerPrompt" label="Images per prompt" :options="[1, 2, 4]" />
          <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
            <div class="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
            <div class="text-xs text-violet-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} to API. Waiting for results…</div>
          </div>
        </div>
      </template>

      <template #text2video>
        <div class="space-y-6 pt-4">
          <PromptInput v-model="t2vPrompt" placeholder="Describe the video you want to generate..." :disabled="gen.generating.value" />
          <div>
            <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Video Model</div>
            <div class="grid grid-cols-2 gap-3">
              <button v-for="m in shared.VIDEO_MODELS" :key="m.id" class="flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all duration-150"
                :class="shared.selectedVideoModel.value === m.id ? 'border-cyan-400 bg-cyan-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'" @click="shared.selectedVideoModel.value = m.id">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :class="shared.selectedVideoModel.value === m.id ? 'bg-cyan-100 text-cyan-600' : 'bg-slate-100 text-slate-400'"><UIcon :name="m.icon" class="w-4 h-4" /></div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold" :class="shared.selectedVideoModel.value === m.id ? 'text-cyan-700' : 'text-slate-700'">{{ m.label }}</div>
                  <div class="text-[11px]" :class="shared.selectedVideoModel.value === m.id ? 'text-cyan-500' : 'text-slate-400'">{{ m.description }}</div>
                </div>
                <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0" :class="shared.selectedVideoModel.value === m.id ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300'">
                  <div v-if="shared.selectedVideoModel.value === m.id" class="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              </button>
            </div>
          </div>
          <UFormField label="Negative prompt" size="sm">
            <UTextarea v-model="t2vNegativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
          </UFormField>
          <DurationPicker v-model="t2vNumFrames" :presets="shared.durationPresets" />
          <CountSelector v-model="t2vCount" label="Videos per duration" :options="[1, 2, 4]" />
          <StepsSlider v-model="t2vSteps" />
          <ResolutionPicker v-model="t2vResolutionIndex" :presets="shared.t2vResolutionPresets" />
          <UFormField label="Seed" size="sm" :description="t2vSeed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2"><UInput v-model.number="t2vSeed" type="number" size="sm" class="w-28" /><UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="t2vSeed = -1" title="Random seed" /></div>
          </UFormField>
          <UCard v-if="t2vPrompt.trim()" variant="subtle">
            <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Video settings</div>
            <p class="text-xs text-slate-600">
              {{ t2vTotal }} video{{ t2vTotal !== 1 ? 's' : '' }} · {{ t2vSteps }} steps · {{ t2vCurrentResolution.w }}×{{ t2vCurrentResolution.h }}
            </p>
          </UCard>
        </div>
      </template>

      <template #batchvideo>
        <div class="space-y-6 pt-4">
          <BatchJsonInput v-model:prompts="bvPrompts" label="Upload Video Prompts JSON" placeholder='["a cat walking through a garden", "ocean waves crashing"]'>
            <template #hint><br />Each prompt generates one video.</template>
            <template #badges>
              <UBadge size="xs" variant="subtle" color="info">{{ bvSteps }} steps · {{ bvCurrentResolution.w }}×{{ bvCurrentResolution.h }}</UBadge>
            </template>
          </BatchJsonInput>
          <UFormField label="Negative prompt" size="sm">
            <UTextarea v-model="bvNegativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
          </UFormField>
          <!-- Video Model Selector -->
          <div>
            <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Video Model</div>
            <div class="grid grid-cols-2 gap-3">
              <button v-for="m in shared.VIDEO_MODELS" :key="m.id" class="flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all duration-150"
                :class="shared.selectedVideoModel.value === m.id ? 'border-cyan-400 bg-cyan-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'" @click="shared.selectedVideoModel.value = m.id">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :class="shared.selectedVideoModel.value === m.id ? 'bg-cyan-100 text-cyan-600' : 'bg-slate-100 text-slate-400'"><UIcon :name="m.icon" class="w-4 h-4" /></div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold" :class="shared.selectedVideoModel.value === m.id ? 'text-cyan-700' : 'text-slate-700'">{{ m.label }}</div>
                  <div class="text-[11px]" :class="shared.selectedVideoModel.value === m.id ? 'text-cyan-500' : 'text-slate-400'">{{ m.description }}</div>
                </div>
                <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0" :class="shared.selectedVideoModel.value === m.id ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300'">
                  <div v-if="shared.selectedVideoModel.value === m.id" class="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              </button>
            </div>
          </div>
          <DurationPicker v-model="bvNumFrames" :presets="shared.durationPresets" />
          <StepsSlider v-model="bvSteps" />
          <ResolutionPicker v-model="bvResolutionIndex" :presets="shared.t2vResolutionPresets" />
          <UFormField label="Seed" size="sm" :description="bvSeed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2"><UInput v-model.number="bvSeed" type="number" size="sm" class="w-28" /><UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="bvSeed = -1" title="Random seed" /></div>
          </UFormField>
          <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200">
            <div class="w-4 h-4 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
            <div class="text-xs text-cyan-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} videos. Waiting…</div>
          </div>
        </div>
      </template>

      <template #img2img>
        <CreateI2ITab
          :i2i-prompt="i2iPrompt" :i2i-image-preview="i2iImagePreview" :i2i-cfg="i2iCfg" :i2i-denoise="i2iDenoise" :i2i-steps="i2iSteps"
          :image-width="shared.imageWidth.value" :image-height="shared.imageHeight.value"
          @update:i2i-prompt="i2iPrompt = $event" @update:i2i-cfg="i2iCfg = $event" @update:i2i-denoise="i2iDenoise = $event" @update:i2i-steps="i2iSteps = $event"
          @file-change="handleI2IFileChange" @drop="handleI2IDrop" @clear-image="clearI2IImage"
        />
      </template>
    </UTabs>

    <!-- ═══ Model Selector ═══ -->
    <UCard v-if="!isVideoMode" class="mb-6" variant="outline">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Model</h3>
          <UBadge v-if="shared.compareMode.value" size="xs" variant="subtle" color="info" class="gap-1"><UIcon name="i-lucide-columns-2" class="w-3 h-3" />Compare Mode</UBadge>
        </div>
        <span class="text-[10px] text-slate-400">Select multiple to compare outputs</span>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button v-for="m in shared.IMAGE_MODELS" :key="m.id" class="flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all duration-150"
          :class="shared.selectedModels.value.includes(m.id) ? 'border-violet-400 bg-violet-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'" @click="shared.toggleModel(m.id)">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :class="shared.selectedModels.value.includes(m.id) ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-400'"><UIcon :name="m.icon" class="w-5 h-5" /></div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold" :class="shared.selectedModels.value.includes(m.id) ? 'text-violet-700' : 'text-slate-700'">{{ m.label }}</div>
            <div class="text-[11px]" :class="shared.selectedModels.value.includes(m.id) ? 'text-violet-500' : 'text-slate-400'">{{ m.description }}</div>
          </div>
          <div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors" :class="shared.selectedModels.value.includes(m.id) ? 'border-violet-500 bg-violet-500' : 'border-slate-300'">
            <UIcon v-if="shared.selectedModels.value.includes(m.id)" name="i-lucide-check" class="w-3 h-3 text-white" />
          </div>
        </button>
      </div>
    </UCard>

    <!-- ═══ Shared Settings (image modes only) ═══ -->
    <UCard v-if="showSharedSettings" class="mb-6" variant="outline">
      <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <UFormField label="Steps" size="sm">
          <div class="flex items-center gap-2"><USlider v-model="shared.steps.value" :min="1" :max="50" class="w-28" size="xs" /><span class="text-xs text-slate-600 font-mono w-5 text-right">{{ shared.steps.value }}</span></div>
        </UFormField>
        <UFormField label="Width" size="sm"><USelect v-model="shared.imageWidth.value" :items="shared.sizeItems" size="sm" class="w-24" /></UFormField>
        <UFormField label="Height" size="sm"><USelect v-model="shared.imageHeight.value" :items="shared.sizeItems" size="sm" class="w-24" /></UFormField>
        <UFormField label="LoRA" size="sm" description="Speed LoRA strength">
          <div class="flex items-center gap-2"><USlider v-model="shared.loraStrength.value" :min="0" :max="2" :step="0.05" class="w-28" size="xs" /><span class="text-xs text-slate-600 font-mono w-8 text-right">{{ shared.loraStrength.value.toFixed(2) }}</span></div>
        </UFormField>
        <UFormField label="Seed" size="sm" :description="shared.imageSeed.value < 0 ? 'Random' : 'Fixed'">
          <div class="flex items-center gap-2"><UInput v-model.number="shared.imageSeed.value" type="number" size="sm" class="w-28" /><UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="shared.imageSeed.value = -1" title="Random seed" /></div>
        </UFormField>
        <UButton variant="link" size="xs" color="neutral" class="ml-auto" @click="shared.showAdvanced.value = !shared.showAdvanced.value">{{ shared.showAdvanced.value ? 'Hide' : 'Show' }} negative prompt</UButton>
      </div>
      <div v-if="shared.showAdvanced.value" class="mt-3 pt-3 border-t border-slate-100">
        <UTextarea v-model="shared.negativePrompt.value" placeholder="Things to avoid..." :rows="2" autoresize size="sm" :disabled="gen.generating.value" class="w-full" />
      </div>
    </UCard>

    <!-- ═══ Generate Button (sticky) ═══ -->
    <div class="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 py-3 px-4 z-10">
      <div class="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="resetForm">Start Over</UButton>
          <UButton v-if="gen.results.value.length > 0" variant="ghost" color="error" size="sm" icon="i-lucide-trash-2" @click="gen.clearResults()">Clear Results</UButton>
        </div>
        <UButton :loading="gen.generating.value" :disabled="!canGenerate" size="lg" :icon="isVideoMode ? 'i-lucide-film' : 'i-lucide-sparkles'" @click="handleGenerate(false)">
          {{ gen.generating.value ? 'Generating…' : (canGenerate ? (isVideoMode ? `Generate ${totalForButton()} Video${totalForButton() !== 1 ? 's' : ''}` : `Generate ${totalForButton()} Image${totalForButton() !== 1 ? 's' : ''}`) : 'Configure above') }}
        </UButton>
      </div>
    </div>

    <!-- ═══ Results ═══ -->
    <CreateResults
      :results="gen.results.value" :generating="gen.generating.value" :can-generate="canGenerate" :is-video-mode="isVideoMode"
      :total-done="gen.totalDone.value" :total-failed="gen.totalFailed.value" :total-pending="gen.totalPending.value"
      :completed-media="gen.completedMedia.value" :batch-progress="gen.batchProgress.value" :action-loading="gen.actionLoading.value"
      :grid-class="gridClass" :total-for-button="totalForButton()"
      @generate-more="handleGenerate(true)" @clear="gen.clearResults()" @open-lightbox="openLightbox"
      @open-video-modal="openVideoModal" @make-audio="gen.makeAudio($event, freePrompt || basePrompt)"
    />
  </div>

  <!-- ═══ Lightbox ═══ -->
  <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
    <template #toolbar="{ item }">
      <template v-if="item.type === 'image'">
        <UButton variant="ghost" size="xs" icon="i-lucide-film" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`video-${item.id}`]" @click="openVideoModal(item.id)">Video</UButton>
        <UButton variant="ghost" size="xs" icon="i-lucide-music" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`audio-${item.id}`]" @click="gen.makeAudio(item.id, freePrompt || basePrompt)">Audio</UButton>
      </template>
    </template>
  </AppLightbox>

  <!-- Video Settings Modal -->
  <VideoSettingsModal :open="videoModalOpen" :loading="videoModalTarget ? gen.actionLoading.value[`video-${videoModalTarget}`] : false" @close="videoModalOpen = false" @generate="handleVideoGenerate" />
</template>
