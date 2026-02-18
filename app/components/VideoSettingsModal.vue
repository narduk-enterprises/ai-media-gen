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
  numFrames: number
  steps: number
  cfg: number
  width: number
  height: number
}

const durationPresets = [
  { label: '~1.7s', value: 41, description: 'Quick' },
  { label: '~3.4s', value: 81, description: 'Standard' },
  { label: '~5s', value: 121, description: 'Long' },
  { label: '~6.7s', value: 161, description: 'Extended' },
  { label: '~8.4s', value: 201, description: 'Maximum' },
]

const resolutionPresets = [
  { label: '512 × 512', w: 512, h: 512 },
  { label: '768 × 768', w: 768, h: 768 },
  { label: '512 × 768', w: 512, h: 768 },
  { label: '768 × 512', w: 768, h: 512 },
  { label: '1024 × 576', w: 1024, h: 576 },
  { label: '576 × 1024', w: 576, h: 1024 },
]

const numFrames = ref(81)
const steps = ref(20)
const cfg = ref(3.5)
const selectedResolution = ref(1)

const currentResolution = computed(() => resolutionPresets[selectedResolution.value]!)

function submit() {
  emit('generate', {
    numFrames: numFrames.value,
    steps: steps.value,
    cfg: cfg.value,
    width: currentResolution.value.w,
    height: currentResolution.value.h,
  })
}

function handleBackdropClick() {
  if (!props.loading) emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && !props.loading) {
    emit('close')
  }
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
      <div
        v-if="open"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
      >
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="handleBackdropClick" />

        <div class="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <!-- Header -->
          <div class="px-5 pt-5 pb-3 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center">
                <UIcon name="i-heroicons-film" class="w-5 h-5 text-cyan-600" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-slate-800">Generate Video</h3>
                <p class="text-[10px] text-slate-400">Configure settings before generating</p>
              </div>
            </div>
            <button
              v-if="!loading"
              class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              @click="emit('close')"
            >
              <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
            </button>
          </div>

          <!-- Settings -->
          <div class="px-5 py-4 space-y-5">
            <!-- Duration -->
            <div>
              <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 block">Duration</label>
              <div class="grid grid-cols-5 gap-1.5">
                <button
                  v-for="preset in durationPresets"
                  :key="preset.value"
                  class="py-2 px-1 rounded-lg text-center transition-all border"
                  :class="numFrames === preset.value
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700 ring-1 ring-cyan-200'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'"
                  @click="numFrames = preset.value"
                >
                  <span class="block text-xs font-semibold">{{ preset.label }}</span>
                  <span class="block text-[9px] mt-0.5 opacity-60">{{ preset.description }}</span>
                </button>
              </div>
              <p class="text-[10px] text-slate-400 mt-1.5">{{ numFrames }} frames at ~24fps</p>
            </div>

            <!-- Steps -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Quality (Steps)</label>
                <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ steps }}</span>
              </div>
              <input
                v-model.number="steps"
                type="range"
                min="10"
                max="50"
                step="5"
                class="w-full accent-cyan-500 h-1.5"
              />
              <div class="flex justify-between text-[9px] text-slate-400 mt-1">
                <span>Faster</span>
                <span>Higher quality</span>
              </div>
            </div>

            <!-- CFG Scale -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">CFG Scale</label>
                <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ cfg }}</span>
              </div>
              <input
                v-model.number="cfg"
                type="range"
                min="1"
                max="10"
                step="0.5"
                class="w-full accent-cyan-500 h-1.5"
              />
              <div class="flex justify-between text-[9px] text-slate-400 mt-1">
                <span>More creative</span>
                <span>More faithful</span>
              </div>
            </div>

            <!-- Resolution -->
            <div>
              <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 block">Resolution</label>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="(preset, i) in resolutionPresets"
                  :key="i"
                  class="py-1.5 px-2 rounded-lg text-[11px] font-medium text-center transition-all border"
                  :class="selectedResolution === i
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700 ring-1 ring-cyan-200'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'"
                  @click="selectedResolution = i"
                >
                  {{ preset.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            <p class="text-[10px] text-slate-400">
              {{ numFrames }} frames · {{ steps }} steps · {{ currentResolution.w }}×{{ currentResolution.h }}
            </p>
            <div class="flex items-center gap-2">
              <button
                v-if="!loading"
                class="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors"
                @click="emit('close')"
              >
                Cancel
              </button>
              <UButton
                :loading="loading"
                size="sm"
                @click="submit"
              >
                <template #leading>
                  <UIcon name="i-heroicons-film" />
                </template>
                Generate Video
              </UButton>
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
