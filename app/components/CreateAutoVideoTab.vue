<script setup lang="ts">
const gen = useGeneration()
const { customEndpoint, runpodEndpoint } = useAppSettings()

// ─── Preset Suggestions ─────────────────────────────────────────────────
const directionPresets = [
  { label: '🎬 Cinematic', prompt: 'Cinematic motion, smooth camera movements, dramatic lighting, film grain' },
  { label: '🎵 Music Video', prompt: 'Dynamic cuts, vibrant colors, rhythmic camera movement, music video energy' },
  { label: '🌊 Dreamy', prompt: 'Ethereal, slow motion, soft focus transitions, dreamlike atmosphere' },
  { label: '🎥 Documentary', prompt: 'Naturalistic, handheld camera, candid moments, observational style' },
  { label: '⚡ Action', prompt: 'Fast-paced, dynamic tracking shots, intense movement, high energy' },
  { label: '🌅 Timelapse', prompt: 'Slow timelapse feel, gradual changes in lighting, clouds moving, passage of time' },
]

const audioPresets = [
  { label: '🎵 Upbeat', prompt: 'upbeat electronic music, positive energy, rhythmic beats' },
  { label: '🎻 Orchestral', prompt: 'cinematic orchestral score, strings, dramatic crescendo' },
  { label: '🌿 Ambient', prompt: 'ambient nature sounds, gentle wind, birds chirping, peaceful' },
  { label: '🔇 Silent', prompt: '' },
  { label: '🏙️ Urban', prompt: 'city ambience, distant traffic, footsteps, urban atmosphere' },
  { label: '🌊 Ocean', prompt: 'ocean waves crashing, seagulls, coastal breeze, water sounds' },
]

const resolutionPresets = [
  { label: '768×512', w: 768, h: 512, tag: 'Fast' },
  { label: '1280×720', w: 1280, h: 720, tag: 'HD' },
  { label: '512×768', w: 512, h: 768, tag: 'Portrait' },
  { label: '720×1280', w: 720, h: 1280, tag: 'HD Port.' },
  { label: '768×768', w: 768, h: 768, tag: 'Square' },
]

// ─── Local State ────────────────────────────────────────────────────────
const selectedMediaItemId = ref<string | null>(null)
const selectedBase64 = ref('')
const basePrompt = ref('')
const audioPrompt = ref('')
const negativePrompt = ref('worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo')
const count = ref(1)
const steps = ref(20)
const numFrames = ref(241)
const width = ref(768)
const height = ref(512)
const imageStrength = ref(1.0)
const loading = ref(false)

// Auto-fill with random audio preset on mount (direction left empty for I2V fidelity)
onMounted(() => {
  const randAudio = audioPresets.filter(p => p.prompt)[Math.floor(Math.random() * (audioPresets.length - 1))]
  if (randAudio) audioPrompt.value = randAudio.prompt
})

// Pipeline results
const caption = ref('')
const generatedPrompts = ref<string[]>([])
const timing = ref<{ captionSeconds?: number; promptSeconds?: number; totalSeconds?: number }>({})

function onImageSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaItemId.value = payload.mediaItemId || null
  selectedBase64.value = payload.base64 || ''
}

function onImageClear() {
  selectedMediaItemId.value = null
  selectedBase64.value = ''
  caption.value = ''
  generatedPrompts.value = []
}

function selectDirection(preset: typeof directionPresets[number]) {
  basePrompt.value = preset.prompt
}

function selectAudio(preset: typeof audioPresets[number]) {
  audioPrompt.value = preset.prompt
}

// ─── Random Batch ───────────────────────────────────────────────────────
const randomQty = ref(5)
const randomRunning = ref(false)

async function generateRandom() {
  if (randomRunning.value) return
  randomRunning.value = true
  gen.error.value = ''

  try {
    // 1. Fetch random image IDs
    const { items: randomImages } = await $fetch<{ items: { id: string }[] }>('/api/media/random', {
      params: { count: randomQty.value },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (!randomImages.length) {
      gen.error.value = 'No images found in gallery'
      return
    }

    // 2. Single batch call — returns immediately, server processes in background
    const endpoint = customEndpoint.value || runpodEndpoint.value
    const result = await $fetch<{
      generation: { id: string; status: string; imageCount: number }
      items: { id: string; generationId: string; type: string; prompt: string; status: string; url: null }[]
    }>('/api/generate/image2video-auto-batch', {
      method: 'POST',
      body: {
        mediaItemIds: randomImages.map(i => i.id),
        basePrompt: basePrompt.value, audioPrompt: audioPrompt.value,
        negativePrompt: negativePrompt.value,
        steps: steps.value, numFrames: numFrames.value,
        width: width.value, height: height.value,
        imageStrength: imageStrength.value, endpoint,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result.items?.length) {
      gen.results.value = [...gen.results.value, ...result.items.map(item => ({
        ...item, parentId: null,
      }))] as any
      gen.activeGenerationId.value = result.generation.id
    }
  } catch (e: any) {
    gen.error.value = e.data?.message || e.message || 'Random batch failed'
  } finally {
    randomRunning.value = false
  }
}

const canGenerate = computed(() => ((!!selectedMediaItemId.value || !!selectedBase64.value) && !loading.value) || randomRunning.value)
const totalCount = computed(() => count.value)

async function generate() {
  if (!canGenerate.value) return

  loading.value = true
  gen.error.value = ''
  caption.value = ''
  generatedPrompts.value = []

  try {
    const endpoint = customEndpoint.value || runpodEndpoint.value
    const body: Record<string, any> = {
      basePrompt: basePrompt.value, audioPrompt: audioPrompt.value,
      negativePrompt: negativePrompt.value, count: count.value,
      steps: steps.value, numFrames: numFrames.value,
      width: width.value, height: height.value,
      imageStrength: imageStrength.value, endpoint,
    }

    if (selectedMediaItemId.value) {
      body.mediaItemId = selectedMediaItemId.value
    } else if (selectedBase64.value) {
      body.image = selectedBase64.value
    }

    const result = await $fetch<{
      generation: { id: string; status: string }
      items: { id: string; type: string; status: string; prompt: string }[]
      caption: string
      prompts: string[]
      timing: { captionSeconds?: number; promptSeconds?: number; totalSeconds?: number }
    }>('/api/generate/image2video-auto', {
      method: 'POST', body,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    caption.value = result.caption
    generatedPrompts.value = result.prompts
    timing.value = result.timing

    if (result.items?.length) {
      gen.results.value = [...gen.results.value, ...result.items.map(item => ({
        ...item, url: null, parentId: null, generationId: result.generation.id,
      }))] as any
      gen.activeGenerationId.value = result.generation.id
    }
  } catch (e: any) {
    gen.error.value = e.data?.message || e.message || 'Auto video pipeline failed'
  } finally {
    loading.value = false
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <ImagePicker :limit="100" @select="onImageSelect" @clear="onImageClear" />

    <!-- ═══ Random Batch ═══ -->
    <UCard variant="outline">
      <div class="flex items-center gap-2 mb-3">
        <UIcon name="i-lucide-shuffle" class="w-4 h-4 text-violet-500" />
        <span class="text-sm font-semibold text-slate-700">Random Batch</span>
        <span class="text-xs text-slate-400">Pick random images from your gallery</span>
      </div>
      <div class="flex flex-wrap items-end gap-4">
        <UFormField label="Quantity" size="sm">
          <div class="flex gap-1">
            <UButton v-for="n in [1, 5, 10, 25, 50, 100]" :key="n" size="xs" :variant="randomQty === n ? 'soft' : 'ghost'" :color="randomQty === n ? 'primary' : 'neutral'" @click="randomQty = n">{{ n }}</UButton>
          </div>
        </UFormField>
        <UButton
          :loading="randomRunning"
          :disabled="randomRunning"
          size="sm"
          color="primary"
          variant="soft"
          icon="i-lucide-shuffle"
          @click="generateRandom"
        >{{ randomRunning ? 'Submitting…' : `Generate ${randomQty} Random Videos` }}</UButton>
      </div>
    </UCard>

    <!-- Direction & Audio -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Direction prompt" size="sm" description="Style and camera guidance for the video">
          <div class="flex flex-wrap gap-1.5 mb-2">
            <UButton
              v-for="p in directionPresets" :key="p.label"
              size="xs"
              :variant="basePrompt === p.prompt ? 'soft' : 'ghost'"
              :color="basePrompt === p.prompt ? 'primary' : 'neutral'"
              @click="selectDirection(p)"
              :disabled="loading"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="basePrompt" placeholder="Or type your own direction..." :rows="2" autoresize :disabled="loading" class="w-full" size="sm" />
        </UFormField>

        <UFormField label="Audio prompt" size="sm" description="Soundtrack/ambience for the video">
          <div class="flex flex-wrap gap-1.5 mb-2">
            <UButton
              v-for="p in audioPresets" :key="p.label"
              size="xs"
              :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
              :color="audioPrompt === p.prompt ? 'primary' : 'neutral'"
              @click="selectAudio(p)"
              :disabled="loading"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="audioPrompt" placeholder="Or describe the audio..." :rows="2" autoresize :disabled="loading" class="w-full" size="sm" />
        </UFormField>

        <UFormField label="Negative prompt" size="sm">
          <UTextarea v-model="negativePrompt" :rows="2" autoresize :disabled="loading" class="w-full" size="sm" />
        </UFormField>
      </div>
    </UCard>

    <!-- Settings -->
    <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
      <UFormField label="Variations" size="sm" description="How many videos to generate">
        <div class="flex gap-1">
          <UButton v-for="n in [1, 3, 5, 10]" :key="n" size="xs" :variant="count === n ? 'soft' : 'ghost'" :color="count === n ? 'primary' : 'neutral'" @click="count = n">{{ n }}</UButton>
        </div>
      </UFormField>

      <UFormField label="Duration" size="sm">
        <div class="flex flex-wrap gap-1">
          <UButton v-for="d in [{l:'2s',v:49},{l:'3s',v:81},{l:'5s',v:121},{l:'7s',v:161},{l:'10s',v:241},{l:'15s',v:361},{l:'20s',v:481},{l:'25s',v:601},{l:'30s',v:721}]" :key="d.v" size="xs" :variant="numFrames === d.v ? 'soft' : 'ghost'" :color="numFrames === d.v ? 'primary' : 'neutral'" @click="numFrames = d.v">{{ d.l }}</UButton>
        </div>
      </UFormField>

      <UFormField label="Resolution" size="sm">
        <div class="flex flex-wrap gap-1">
          <UButton v-for="r in resolutionPresets" :key="r.label" size="xs" :variant="width === r.w && height === r.h ? 'soft' : 'ghost'" :color="width === r.w && height === r.h ? 'primary' : 'neutral'" @click="width = r.w; height = r.h">{{ r.label }} <span class="text-[9px] opacity-60 ml-0.5">{{ r.tag }}</span></UButton>
        </div>
      </UFormField>

      <UFormField label="Steps" size="sm">
        <div class="flex gap-1">
          <UButton v-for="s in [12, 20]" :key="s" size="xs" :variant="steps === s ? 'soft' : 'ghost'" :color="steps === s ? 'primary' : 'neutral'" @click="steps = s">{{ s }}</UButton>
        </div>
      </UFormField>

      <UFormField label="Image Fidelity" size="sm" description="How closely video matches source image">
        <div class="flex gap-1">
          <UButton v-for="f in [{l:'Creative',v:0.7},{l:'Balanced',v:0.85},{l:'Faithful',v:0.95},{l:'Exact',v:1.0}]" :key="f.v" size="xs" :variant="imageStrength === f.v ? 'soft' : 'ghost'" :color="imageStrength === f.v ? 'primary' : 'neutral'" @click="imageStrength = f.v">{{ f.l }}</UButton>
        </div>
      </UFormField>
    </div>

    <!-- Pipeline Status -->
    <div v-if="loading" class="flex items-center gap-3 p-4 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-5 h-5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div>
        <p class="text-sm font-medium text-violet-700">AI is analyzing your image...</p>
        <p class="text-xs text-violet-500">Captioning → Generating {{ count }} prompts → Queuing videos</p>
      </div>
    </div>

    <!-- Results Preview -->
    <div v-if="generatedPrompts.length > 0" class="space-y-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-amber-500" />
        <span class="text-sm font-semibold text-gray-700">Generated {{ generatedPrompts.length }} prompts</span>
        <UBadge v-if="timing.totalSeconds" size="xs" variant="subtle" color="neutral">{{ timing.captionSeconds }}s caption + {{ timing.promptSeconds }}s prompts</UBadge>
      </div>
      <div v-for="(p, i) in generatedPrompts" :key="i" class="p-3 rounded-lg bg-gray-50 border border-gray-200">
        <div class="flex items-center gap-1.5 mb-1">
          <UBadge size="xs" variant="subtle" color="primary">{{ i + 1 }}</UBadge>
          <span class="text-[10px] text-gray-400">queued for generation</span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">{{ p }}</p>
      </div>
    </div>
  </div>
</template>

