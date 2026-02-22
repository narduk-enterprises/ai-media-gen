<script setup lang="ts">
const gen = useGeneration()
const queue = useQueue()
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
const selectedImageIds = ref<string[]>([])
const basePrompt = ref('')
const audioPrompt = ref('')
const negativePrompt = ref('worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo')
const steps = ref(20)
const numFrames = ref(241)
const width = ref(768)
const height = ref(512)
const imageStrength = ref(1.0)
const loading = ref(false)

// Auto-fill with random audio preset on mount
onMounted(() => {
  const withAudio = audioPresets.filter(p => p.prompt)
  const randAudio = withAudio[Math.floor(Math.random() * withAudio.length)]
  if (randAudio) audioPrompt.value = randAudio.prompt
})

// Pipeline results
const generatedPrompts = ref<string[]>([])
const timing = ref<{ captionSeconds?: number; promptSeconds?: number; totalSeconds?: number }>({})

function onImagesSelected(ids: string[]) {
  selectedImageIds.value = ids
}

const canGenerate = computed(() => selectedImageIds.value.length > 0 && !loading.value)
const totalCount = computed(() => selectedImageIds.value.length)

async function generate() {
  if (!canGenerate.value) return

  loading.value = true
  gen.error.value = ''
  generatedPrompts.value = []

  try {
    const endpoint = customEndpoint.value || runpodEndpoint.value

    // Use batch endpoint — sends all selected images at once
    const result = await $fetch<{
      generation: { id: string; status: string; imageCount: number }
      items: { id: string; generationId: string; type: string; prompt: string; status: string; url: null }[]
    }>('/api/generate/image2video-auto-batch', {
      method: 'POST',
      body: {
        mediaItemIds: selectedImageIds.value,
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
      queue.refresh()
    }
  } catch (e: any) {
    gen.error.value = e.data?.message || e.message || 'Auto video batch failed'
  } finally {
    loading.value = false
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <ImagePicker :multi="true" label="Select images to animate" @update:selected="onImagesSelected" />

    <!-- Direction & Audio -->
    <UCard variant="outline">
      <div class="space-y-4">
        <PromptPresetField v-model="basePrompt" label="Direction prompt" description="Style and camera guidance for the video" placeholder="Or type your own direction..." :presets="directionPresets" :disabled="loading" />
        <PromptPresetField v-model="audioPrompt" label="Audio prompt" description="Soundtrack/ambience for the video" placeholder="Or describe the audio..." :presets="audioPresets" :disabled="loading" />
        <PromptPresetField v-model="negativePrompt" label="Negative prompt" :disabled="loading" />
      </div>
    </UCard>

    <!-- Settings -->
    <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
      <CountSelector v-model="numFrames" label="Duration" :options="[49, 81, 121, 161, 241, 361, 481, 601, 721]" />

      <UFormField label="Resolution" size="sm">
        <div class="flex flex-wrap gap-1">
          <UButton v-for="r in resolutionPresets" :key="r.label" size="xs" :variant="width === r.w && height === r.h ? 'soft' : 'ghost'" :color="width === r.w && height === r.h ? 'primary' : 'neutral'" @click="width = r.w; height = r.h">{{ r.label }} <span class="text-[9px] opacity-60 ml-0.5">{{ r.tag }}</span></UButton>
        </div>
      </UFormField>

      <CountSelector v-model="steps" label="Steps" :options="[12, 20]" />

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
        <p class="text-sm font-medium text-violet-700">Submitting {{ selectedImageIds.length }} images to auto video pipeline...</p>
        <p class="text-xs text-violet-500">Each image will be captioned → prompted → queued for video generation</p>
      </div>
    </div>
  </div>
</template>
