<script setup lang="ts">
const props = defineProps<{
  open: boolean
  loading?: boolean
  mediaItemId?: string | null
}>()

const emit = defineEmits<{
  'update:open': [val: boolean]
  close: []
  generate: [settings: VideoSettings, mediaItemId?: string]
}>()

export interface VideoSettings {
  model: string
  numFrames: number
  steps: number
  cfg: number
  width: number
  height: number
  fps?: number
  loraStrength?: number
  imageStrength?: number
}

const models = [
  { id: 'ltx2', label: 'LTX-2', description: '19B + upscaler → 2x', icon: 'i-lucide-film', defaultSteps: 20 },
  { id: 'wan22', label: 'Wan 2.2', description: '14B I2V, 20 steps', icon: 'i-lucide-brain', defaultSteps: 20 },
]

const selectedModel = ref('ltx2')
const numFrames = ref<number[]>([81])
const steps = ref(20)
const cfg = ref(3.5)
const fps = ref(24)
const loraStrength = ref(1.0)
const imageStrength = ref(1.0)
const resolutionIndex = ref(0)
const selectedImageId = ref<string | null>(null)

const pickerRef = ref<InstanceType<typeof ImagePicker> | null>(null)

watch(() => props.open, (val) => {
  if (val) selectedImageId.value = props.mediaItemId || null
})

// ─── Model-aware presets ────────────────────────────────────────────────
const wan22Presets = [
  { label: '768×768', w: 768, h: 768 }, { label: '512×512', w: 512, h: 512 },
  { label: '768×512', w: 768, h: 512 }, { label: '512×768', w: 512, h: 768 },
]
const ltx2Presets = [
  { label: '1280×720', w: 1280, h: 720 }, { label: '1920×1088', w: 1920, h: 1088 },
  { label: '768×432', w: 768, h: 432 }, { label: '768×768', w: 768, h: 768 },
]
const activePresets = computed(() => selectedModel.value === 'ltx2' ? ltx2Presets : wan22Presets)
const currentResolution = computed(() => activePresets.value[resolutionIndex.value] ?? activePresets.value[0]!)
const isLtx2 = computed(() => selectedModel.value === 'ltx2')

const durationPresets = [
  { label: '2s', value: 49, description: '49f' }, { label: '3s', value: 81, description: '81f' },
  { label: '5s', value: 121, description: '121f' }, { label: '7s', value: 161, description: '161f' },
  { label: '10s', value: 241, description: '241f' }, { label: '15s', value: 361, description: '361f' },
  { label: '20s', value: 481, description: '481f' }, { label: '25s', value: 601, description: '601f' },
  { label: '30s', value: 721, description: '721f' },
]

const activeImageId = computed(() => selectedImageId.value || props.mediaItemId || null)

watch(selectedModel, (m) => {
  resolutionIndex.value = 0
  const model = models.find(x => x.id === m)
  if (model) steps.value = model.defaultSteps
})

function onImageSelect(payload: { mediaItemId?: string }) {
  selectedImageId.value = payload.mediaItemId || null
}

function submit() {
  const s: VideoSettings = {
    model: selectedModel.value, numFrames: numFrames.value[0] ?? 81,
    steps: steps.value, cfg: cfg.value,
    width: currentResolution.value.w, height: currentResolution.value.h,
  }
  if (isLtx2.value) { s.fps = fps.value; s.loraStrength = loraStrength.value; s.imageStrength = imageStrength.value }
  emit('generate', s, activeImageId.value || undefined)
}

function close() { if (!props.loading) emit('close') }
</script>

<template>
  <UModal :open="open" @close="close">
    <template #header>
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-cyan-50 border border-cyan-100 flex items-center justify-center">
          <UIcon name="i-lucide-film" class="w-4 h-4 text-cyan-600" />
        </div>
        <div>
          <h3 class="text-sm font-semibold">Image → Video</h3>
          <p class="text-[10px] text-gray-400">Select an image to animate</p>
        </div>
      </div>
    </template>

    <template #body>
      <div class="space-y-5">
        <ImagePicker ref="pickerRef" :show-upload="false" label="Source Image" @select="onImageSelect" />

        <!-- Model selector -->
        <section>
          <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2 block">Model</label>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="m in models" :key="m.id"
              class="rounded-xl border px-3 py-2.5 text-left transition-all text-xs"
              :class="selectedModel === m.id ? 'border-cyan-400 bg-cyan-50 ring-1 ring-cyan-200' : 'border-gray-200 hover:border-gray-300'"
              @click="selectedModel = m.id">
              <div class="font-semibold text-gray-800 flex items-center gap-1.5"><UIcon :name="m.icon" class="w-3.5 h-3.5" /> {{ m.label }}</div>
              <div class="text-[10px] text-gray-400 mt-0.5">{{ m.description }}</div>
            </button>
          </div>
        </section>

        <DurationPicker v-model="numFrames" :multi-select="false" :presets="durationPresets" />
        <StepsSlider v-model="steps" :min="10" :max="50" />

        <!-- CFG Scale — Wan 2.2 only -->
        <section v-if="!isLtx2">
          <div class="flex items-center justify-between mb-2">
            <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wider">CFG Scale</label>
            <span class="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{{ cfg }}</span>
          </div>
          <USlider v-model="cfg" :min="1" :max="10" :step="0.5" size="xs" />
        </section>

        <!-- LTX-2: Image Strength + LoRA -->
        <section v-if="isLtx2" class="space-y-3">
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Image Strength</label>
              <span class="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{{ imageStrength.toFixed(2) }}</span>
            </div>
            <USlider v-model="imageStrength" :min="0.3" :max="1" :step="0.05" size="xs" />
            <div class="flex justify-between text-[9px] text-gray-400 mt-1"><span>More creative</span><span>Exact match</span></div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wider">LoRA Strength</label>
              <span class="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{{ loraStrength.toFixed(1) }}</span>
            </div>
            <USlider v-model="loraStrength" :min="0.3" :max="1" :step="0.1" size="xs" />
          </div>
        </section>

        <ResolutionPicker v-model="resolutionIndex" :presets="activePresets" />
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3 w-full">
        <p class="text-[10px] text-gray-400">
          {{ isLtx2 ? 'LTX-2' : 'Wan 2.2' }} · {{ numFrames[0] }}f · {{ steps }}st · {{ currentResolution.w }}×{{ currentResolution.h }}
        </p>
        <div class="flex items-center gap-2">
          <UButton v-if="!loading" variant="ghost" color="neutral" size="sm" @click="close">Cancel</UButton>
          <UButton :loading="loading" :disabled="!activeImageId" size="sm" icon="i-lucide-film" @click="submit">Generate</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
