<script setup lang="ts">
import { VIDEO_MODELS } from '~/composables/useCreateShared'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Source Image ───────────────────────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')

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
const negativePrompt = ref('')
const selectedModel = ref('wan22')
const steps = ref(4)
const cfg = ref(3.5)
const resolutionIndex = ref(0)
const numFrames = ref(81)
const seed = ref(-1)
const loraStrength = ref(1.0)
const fps = ref(24)
const imageStrength = ref(1.0)
const audioPrompt = ref('')
const isLtx2 = computed(() => selectedModel.value === 'ltx2')

const params = computed(() => shared.getVideoModelParams(selectedModel.value))
const currentResolution = computed(() => params.value.resolutions[resolutionIndex.value] ?? params.value.resolutions[0]!)
const hasImage = computed(() => !!selectedMediaId.value || !!uploadedBase64.value)

watch(selectedModel, (id) => {
  const p = shared.getVideoModelParams(id)
  steps.value = p.steps.default
  resolutionIndex.value = 0
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
    width: currentResolution.value.w, height: currentResolution.value.h,
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
    <ImagePicker cols="grid-cols-5" label="Source Image" @select="onImageSelect" @clear="onImageClear" />

    <!-- Model Selector -->
    <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="cyan" @update:selected="selectedModel = $event as string" />

    <!-- Prompts -->
    <UCard variant="outline">
      <div class="space-y-3">
        <UFormField label="Prompt (+)" size="sm" description="Guide the video motion and style">
          <UTextarea v-model="prompt" placeholder="Describe the motion, action, or style you want..." :rows="2" autoresize class="w-full" size="sm" />
        </UFormField>
        <UFormField label="Negative Prompt (−)" size="sm">
          <UTextarea v-model="negativePrompt" placeholder="Things to avoid (optional)..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>
        <UFormField label="Audio Prompt" size="sm" description="Describe the audio/sound (optional)">
          <UTextarea v-model="audioPrompt" placeholder="birds chirping, wind blowing, footsteps on gravel..." :rows="1" autoresize class="w-full" size="sm" />
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

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
          <SliderField v-if="params.cfg" v-model="cfg" label="CFG" :min="params.cfg.min" :max="params.cfg.max" :step="params.cfg.step" />
          <ResolutionPicker v-model="resolutionIndex" :presets="params.resolutions" />
          <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" />
          <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" :format="v => v.toFixed(2)" />
          <SliderField v-if="params.imageStrength" v-model="imageStrength" label="Img Strength" :min="params.imageStrength.min" :max="params.imageStrength.max" :step="params.imageStrength.step" :format="v => v.toFixed(2)" />
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
