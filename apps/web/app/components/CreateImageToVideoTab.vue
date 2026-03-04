<script setup lang="ts">
import { VIDEO_MODELS } from '~/composables/useCreateShared'
import { I2V_MOTION_PRESETS, DIRECTION_PRESETS, AUDIO_PRESETS, DEFAULT_NEGATIVE_PROMPT, randomAudioPrompt } from '~/composables/useVideoDefaults'

const props = defineProps<{ prefillMediaId?: string | null }>()
const gen = useGeneration()
const shared = useCreateShared()


// ─── Source Image ───────────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')

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

// ─── Video Settings ─────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref(DEFAULT_NEGATIVE_PROMPT)
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
const selectedPreset = ref('')
const isLtx2 = computed(() => selectedModel.value === 'ltx2')
const runningAllPresets = ref(false)

const params = computed(() => shared.getVideoModelParams(selectedModel.value))
const hasImage = computed(() => !!selectedMediaId.value || !!uploadedBase64.value)

onMounted(() => { audioPrompt.value = randomAudioPrompt() })

watch(selectedModel, (id) => {
  const p = shared.getVideoModelParams(id)
  steps.value = p.steps.default
  numFrames.value = p.durations[1]?.value ?? p.durations[0]?.value ?? 81
  if (p.cfg) cfg.value = p.cfg.default
  if (p.fps) fps.value = p.fps.default
  if (p.lora) loraStrength.value = p.lora.default
  if (p.imageStrength) imageStrength.value = p.imageStrength.default
})

// ─── Generate ───────────────────────────────────────────────
const canGenerate = computed(() => hasImage.value)
const totalCount = computed(() => canGenerate.value ? 1 : 0)

const emit = defineEmits<{ 'generate-i2v': [body: { image: string; seed: number; model: string; prompt?: string; negativePrompt?: string; numFrames: number; steps: number; cfg: number; width: number; height: number; fps?: number; loraStrength?: number; imageStrength?: number; audioPrompt?: string; preset?: string }] }>()

function buildVideoOpts(presetOverride?: string) {
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
    preset: presetOverride ?? (selectedPreset.value || undefined),
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

async function runAllPresets() {
  if (!canGenerate.value || !selectedMediaId.value || runningAllPresets.value) return
  runningAllPresets.value = true
  try {
    for (const preset of I2V_MOTION_PRESETS) {
      await gen.makeVideo(selectedMediaId.value!, buildVideoOpts(preset.key))
    }
  } finally {
    runningAllPresets.value = false
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <ImagePicker label="Source Image" @select="onImageSelect" @clear="onImageClear" />

    <!-- Model Selector -->
    <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="cyan" @update:selected="selectedModel = $event as string" />

    <!-- I2V Workflow Presets (LTX2 only) -->
    <UCard v-if="isLtx2" variant="outline">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">I2V Workflow Preset</h3>
            <p class="text-[10px] text-slate-400 mt-0.5">Each preset tunes CFG, scheduler, sampler, and image strength differently</p>
          </div>
          <UButton
            v-if="hasImage && selectedMediaId"
            size="xs" color="warning" variant="soft" icon="i-lucide-layers"
            :loading="runningAllPresets" @click="runAllPresets"
          >Run All 10 Presets</UButton>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          <button
            v-for="p in I2V_MOTION_PRESETS" :key="p.key"
            class="text-left px-2 py-1.5 rounded-lg border text-xs transition-all"
            :class="selectedPreset === p.key
              ? 'border-cyan-400 bg-cyan-50 text-cyan-700 ring-1 ring-cyan-300'
              : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'"
            @click="selectedPreset = selectedPreset === p.key ? '' : p.key"
          >
            <span class="font-medium block truncate">{{ p.label }}</span>
            <span class="text-[9px] opacity-60 block truncate">{{ p.desc }}</span>
          </button>
        </div>
      </div>
    </UCard>

    <!-- Direction & Audio Presets -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Style Direction" size="sm" description="Leave blank to auto-generate from the image">
          <div class="flex flex-wrap gap-1 mb-2">
            <UButton
v-for="p in DIRECTION_PRESETS" :key="p.label" size="xs"
              :variant="prompt === p.prompt ? 'soft' : 'ghost'"
              :color="prompt === p.prompt ? 'primary' : 'neutral'"
              @click="prompt = prompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="prompt" placeholder="Optional — AI will caption your image and create a prompt automatically" :rows="2" autoresize class="w-full" size="sm" />
        </UFormField>

        <UFormField label="Audio / Soundtrack" size="sm" description="Soundtrack or ambience for the video">
          <div class="flex flex-wrap gap-1 mb-2">
            <UButton
v-for="p in AUDIO_PRESETS" :key="p.label" size="xs"
              :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
              :color="audioPrompt === p.prompt ? 'primary' : 'neutral'"
              @click="audioPrompt = audioPrompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="audioPrompt" placeholder="Or describe the audio..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

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
            <UButton
v-for="d in params.durations" :key="d.value" size="xs"
              :variant="numFrames === d.value ? 'soft' : 'outline'" :color="numFrames === d.value ? 'primary' : 'neutral'"
              @click="numFrames = d.value">{{ d.label }} <span class="text-[10px] opacity-60">{{ d.description }}</span></UButton>
          </div>
        </UFormField>

        <ResolutionSelector v-model:width="width" v-model:height="height" />

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
          <SliderField v-if="params.cfg" v-model="cfg" label="CFG" :min="params.cfg.min" :max="params.cfg.max" :step="params.cfg.step" />
          <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" />
          <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" />
          <FidelitySelector v-if="params.imageStrength" v-model="imageStrength" />

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
