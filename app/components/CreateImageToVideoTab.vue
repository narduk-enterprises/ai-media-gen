<script setup lang="ts">
import { VIDEO_MODELS } from '~/composables/useCreateShared'

const props = defineProps<{ prefillMediaId?: string | null }>()
const gen = useGeneration()
const shared = useCreateShared()

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

// ─── Source Image ───────────────────────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')

// Auto-select prefilled media from gallery navigation
watch(() => props.prefillMediaId, (id) => {
  if (id) selectedMediaId.value = id
}, { immediate: true })

function onImageSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaId.value = payload.mediaItemId || null
  uploadedBase64.value = payload.base64 || ''
}

function onImageClear() {
  selectedMediaId.value = null
  uploadedBase64.value = ''
}

// ─── Video Settings ─────────────────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref('worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo')
const selectedModel = ref('ltx2')
const steps = ref(20)
const cfg = ref(3.5)
const width = ref(1280)
const height = ref(720)
const numFrames = ref(241)
const seed = ref(-1)
const loraStrength = ref(1.0)
const fps = ref(24)
const imageStrength = ref(1.0)
const audioPrompt = ref('')
const isLtx2 = computed(() => selectedModel.value === 'ltx2')

const params = computed(() => shared.getVideoModelParams(selectedModel.value))
const hasImage = computed(() => !!selectedMediaId.value || !!uploadedBase64.value)

// Auto-fill with random audio preset on mount
onMounted(() => {
  const withAudio = audioPresets.filter(p => p.prompt)
  const randAudio = withAudio[Math.floor(Math.random() * withAudio.length)]
  if (randAudio) audioPrompt.value = randAudio.prompt
})

watch(selectedModel, (id) => {
  const p = shared.getVideoModelParams(id)
  steps.value = p.steps.default
  numFrames.value = p.durations[1]?.value ?? p.durations[0]?.value ?? 81
  if (p.cfg) cfg.value = p.cfg.default
  if (p.fps) fps.value = p.fps.default
  if (p.lora) loraStrength.value = p.lora.default
  if (p.imageStrength) imageStrength.value = p.imageStrength.default
})

// ─── Generate ───────────────────────────────────────────────────────────
const canGenerate = computed(() => hasImage.value)
const totalCount = computed(() => canGenerate.value ? 1 : 0)

const emit = defineEmits<{ 'generate-i2v': [body: Record<string, any>] }>()

function buildVideoOpts() {
  return {
    model: selectedModel.value,
    prompt: prompt.value.trim() || undefined,
    negativePrompt: negativePrompt.value.trim() || undefined,
    numFrames: numFrames.value, steps: steps.value, cfg: cfg.value,
    width: width.value, height: height.value,
    fps: isLtx2.value ? fps.value : undefined,
    loraStrength: isLtx2.value ? loraStrength.value : undefined,
    imageStrength: isLtx2.value ? imageStrength.value : undefined,
    audioPrompt: audioPrompt.value.trim() || undefined,
  }
}

async function generate() {
  if (!canGenerate.value) return
  if (selectedMediaId.value) {
    await gen.makeVideo(selectedMediaId.value, buildVideoOpts())
  } else {
    emit('generate-i2v', { image: uploadedBase64.value, seed: seed.value, ...buildVideoOpts() })
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <ImagePicker label="Source Image" @select="onImageSelect" @clear="onImageClear" />

    <!-- Model Selector -->
    <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="cyan" @update:selected="selectedModel = $event as string" />

    <!-- Direction & Audio Presets -->
    <UCard variant="outline">
      <div class="space-y-4">
        <!-- Direction Presets -->
        <UFormField label="Style Direction" size="sm" description="Leave blank to auto-generate from the image">
          <div class="flex flex-wrap gap-1 mb-2">
            <UButton v-for="p in directionPresets" :key="p.label" size="xs"
              :variant="prompt === p.prompt ? 'soft' : 'ghost'"
              :color="prompt === p.prompt ? 'primary' : 'neutral'"
              @click="prompt = prompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="prompt" placeholder="Optional — AI will caption your image and create a prompt automatically" :rows="2" autoresize class="w-full" size="sm" />
        </UFormField>

        <!-- Audio Presets -->
        <UFormField label="Audio / Soundtrack" size="sm" description="Soundtrack or ambience for the video">
          <div class="flex flex-wrap gap-1 mb-2">
            <UButton v-for="p in audioPresets" :key="p.label" size="xs"
              :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
              :color="audioPrompt === p.prompt ? 'primary' : 'neutral'"
              @click="audioPrompt = audioPrompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="audioPrompt" placeholder="Or describe the audio..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

        <!-- Negative Prompt -->
        <UFormField label="Negative Prompt (−)" size="sm">
          <UTextarea v-model="negativePrompt" placeholder="Things to avoid (optional)..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>
      </div>
    </UCard>

    <!-- Settings -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Duration" size="sm">
          <div class="flex flex-wrap gap-2">
            <UButton v-for="d in params.durations" :key="d.value" size="xs"
              :variant="numFrames === d.value ? 'soft' : 'outline'" :color="numFrames === d.value ? 'primary' : 'neutral'"
              @click="numFrames = d.value">{{ d.label }} <span class="text-[10px] opacity-60">{{ d.description }}</span></UButton>
          </div>
        </UFormField>

        <UFormField label="Resolution" size="sm">
          <div class="flex flex-wrap gap-1">
            <UButton v-for="r in resolutionPresets" :key="r.label" size="xs"
              :variant="width === r.w && height === r.h ? 'soft' : 'ghost'"
              :color="width === r.w && height === r.h ? 'primary' : 'neutral'"
              @click="width = r.w; height = r.h"
            >{{ r.label }} <span class="text-[9px] opacity-60 ml-0.5">{{ r.tag }}</span></UButton>
          </div>
        </UFormField>

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
          <SliderField v-if="params.cfg" v-model="cfg" label="CFG" :min="params.cfg.min" :max="params.cfg.max" :step="params.cfg.step" />
          <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" />
          <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" />

          <UFormField v-if="params.imageStrength" label="Image Fidelity" size="sm" description="How closely video matches source image">
            <div class="flex gap-1">
              <UButton v-for="f in [{l:'Creative',v:0.7},{l:'Balanced',v:0.85},{l:'Faithful',v:0.95},{l:'Exact',v:1.0}]" :key="f.v" size="xs"
                :variant="imageStrength === f.v ? 'soft' : 'ghost'"
                :color="imageStrength === f.v ? 'primary' : 'neutral'"
                @click="imageStrength = f.v"
              >{{ f.l }}</UButton>
            </div>
          </UFormField>

          <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2">
              <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
              <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" />
            </div>
          </UFormField>
        </div>
      </div>
    </UCard>
  </div>
</template>
