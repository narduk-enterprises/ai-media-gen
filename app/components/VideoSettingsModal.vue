<script setup lang="ts">
const props = defineProps<{
  open: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
  generate: [settings: VideoSettings]
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
  { id: 'ltx2', label: 'LTX-2', description: '19B + upscaler → 2x output', icon: 'i-lucide-film', defaultSteps: 20 },
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

const wan22Presets = [
  { label: '768 × 768', w: 768, h: 768 },
  { label: '512 × 512', w: 512, h: 512 },
  { label: '768 × 512', w: 768, h: 512 },
  { label: '512 × 768', w: 512, h: 768 },
]

const ltx2Presets = [
  { label: '1280 × 720 → 2560×1440', w: 1280, h: 720 },
  { label: '1920 × 1088 → 3840×2176', w: 1920, h: 1088 },
  { label: '768 × 432 → 1536×864', w: 768, h: 432 },
  { label: '768 × 768 → 1536×1536', w: 768, h: 768 },
]

const activePresets = computed(() => selectedModel.value === 'ltx2' ? ltx2Presets : wan22Presets)
const currentResolution = computed(() => activePresets.value[resolutionIndex.value] ?? activePresets.value[0]!)
const isLtx2 = computed(() => selectedModel.value === 'ltx2')

watch(selectedModel, (m) => {
  resolutionIndex.value = 0
  const model = models.find(x => x.id === m)
  if (model) steps.value = model.defaultSteps
})

function submit() {
  const s: VideoSettings = {
    model: selectedModel.value,
    numFrames: numFrames.value[0] ?? 81,
    steps: steps.value,
    cfg: cfg.value,
    width: currentResolution.value.w,
    height: currentResolution.value.h,
  }
  if (isLtx2.value) {
    s.fps = fps.value
    s.loraStrength = loraStrength.value
    s.imageStrength = imageStrength.value
  }
  emit('generate', s)
}

function handleBackdropClick() {
  if (!props.loading) emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && !props.loading) emit('close')
}

onMounted(() => {
  if (import.meta.client) window.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  if (import.meta.client) window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-200 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="handleBackdropClick" />

        <div class="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <!-- Header -->
          <div class="px-5 pt-5 pb-3 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center">
                <UIcon name="i-lucide-film" class="w-5 h-5 text-cyan-600" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-slate-800">Image → Video</h3>
                <p class="text-[10px] text-slate-400">Animate this image into a video</p>
              </div>
            </div>
            <UButton v-if="!loading" variant="ghost" color="neutral" icon="i-lucide-x" size="sm" @click="emit('close')" />
          </div>

          <!-- Settings -->
          <div class="px-5 py-4 space-y-5">
            <!-- Model selector -->
            <section>
              <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 block">Model</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="m in models" :key="m.id"
                  class="relative rounded-xl border px-3 py-2.5 text-left transition-all text-xs"
                  :class="selectedModel === m.id
                    ? 'border-cyan-400 bg-cyan-50 ring-1 ring-cyan-200'
                    : 'border-slate-200 hover:border-slate-300'"
                  @click="selectedModel = m.id"
                >
                  <div class="font-semibold text-slate-800 flex items-center gap-1.5">
                    <UIcon :name="m.icon" class="w-3.5 h-3.5" />
                    {{ m.label }}
                  </div>
                  <div class="text-[10px] text-slate-400 mt-0.5">{{ m.description }}</div>
                </button>
              </div>
            </section>

            <DurationPicker v-model="numFrames" :multi-select="false" />
            <StepsSlider v-model="steps" :min="10" :max="50" />

            <!-- CFG Scale — only for Wan 2.2 -->
            <section v-if="!isLtx2">
              <div class="flex items-center justify-between mb-2">
                <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">CFG Scale</label>
                <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ cfg }}</span>
              </div>
              <USlider v-model="cfg" :min="1" :max="10" :step="0.5" class="w-full" size="xs" />
            </section>

            <!-- LTX-2 specific: Image Strength + LoRA -->
            <section v-if="isLtx2" class="space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Image Strength</label>
                  <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ imageStrength.toFixed(2) }}</span>
                </div>
                <USlider v-model="imageStrength" :min="0.3" :max="1" :step="0.05" class="w-full" size="xs" />
                <div class="flex justify-between text-[9px] text-slate-400 mt-1">
                  <span>More creative</span>
                  <span>Exact match</span>
                </div>
              </div>
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">LoRA Strength</label>
                  <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ loraStrength.toFixed(1) }}</span>
                </div>
                <USlider v-model="loraStrength" :min="0.3" :max="1" :step="0.1" class="w-full" size="xs" />
              </div>
            </section>

            <ResolutionPicker v-model="resolutionIndex" :presets="activePresets" />
          </div>

          <!-- Footer -->
          <div class="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            <p class="text-[10px] text-slate-400">
              {{ selectedModel === 'ltx2' ? 'LTX-2' : 'Wan 2.2' }} · {{ numFrames[0] }} frames · {{ steps }} steps · {{ currentResolution.w }}×{{ currentResolution.h }}
            </p>
            <div class="flex items-center gap-2">
              <UButton v-if="!loading" variant="ghost" color="neutral" size="sm" @click="emit('close')">Cancel</UButton>
              <UButton :loading="loading" size="sm" icon="i-lucide-film" @click="submit">Generate Video</UButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .relative,
.modal-leave-active .relative {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}
.modal-leave-to .relative {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}
</style>
