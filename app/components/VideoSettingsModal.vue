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

const numFrames = ref<number[]>([81])
const steps = ref(20)
const cfg = ref(3.5)
const resolutionIndex = ref(1)

const resolutionPresets = [
  { label: '512 × 512', w: 512, h: 512 },
  { label: '768 × 768', w: 768, h: 768 },
  { label: '512 × 768', w: 512, h: 768 },
  { label: '768 × 512', w: 768, h: 512 },
  { label: '1024 × 576', w: 1024, h: 576 },
  { label: '576 × 1024', w: 576, h: 1024 },
]

const currentResolution = computed(() => resolutionPresets[resolutionIndex.value]!)

function submit() {
  emit('generate', {
    numFrames: numFrames.value[0] ?? 81,
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
                <h3 class="text-sm font-semibold text-slate-800">Generate Video</h3>
                <p class="text-[10px] text-slate-400">Configure settings before generating</p>
              </div>
            </div>
            <UButton v-if="!loading" variant="ghost" color="neutral" icon="i-lucide-x" size="sm" @click="emit('close')" />
          </div>

          <!-- Settings -->
          <div class="px-5 py-4 space-y-5">
            <DurationPicker v-model="numFrames" :multi-select="false" />

            <StepsSlider v-model="steps" :min="10" :max="50" />

            <!-- CFG Scale -->
            <section>
              <div class="flex items-center justify-between mb-2">
                <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">CFG Scale</label>
                <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ cfg }}</span>
              </div>
              <USlider v-model="cfg" :min="1" :max="10" :step="0.5" class="w-full" size="xs" />
              <div class="flex justify-between text-[9px] text-slate-400 mt-1">
                <span>More creative</span>
                <span>More faithful</span>
              </div>
            </section>

            <ResolutionPicker v-model="resolutionIndex" :presets="resolutionPresets" />
          </div>

          <!-- Footer -->
          <div class="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            <p class="text-[10px] text-slate-400">
              {{ numFrames[0] }} frames · {{ steps }} steps · {{ currentResolution.w }}×{{ currentResolution.h }}
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
