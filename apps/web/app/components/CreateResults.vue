<script setup lang="ts">
const props = defineProps<{
  results: { id: string; status: string; type?: string; url?: string | null; parentId?: string | null }[]
  generating: boolean
  canGenerate: boolean
  isVideoMode: boolean
  totalDone: number
  totalFailed: number
  totalPending: number
  completedMedia: { id: string; url: string | null; type: string }[]
  batchProgress: { current: number; total: number }
  actionLoading: Record<string, boolean>
  gridClass: string
  totalForButton: number
}>()

const progressValue = computed(() => {
  if (props.results.length === 0) return 5
  return Math.max(5, (props.totalDone / props.results.length) * 100)
})

const doneCountText = computed(() => `${props.totalDone} done`)
const failedCountText = computed(() => `${props.totalFailed} failed`)
const pendingCountText = computed(() => `${props.totalPending} pending`)

function getLightboxIndex(itemId: string) {
  return props.completedMedia.findIndex(i => i.id === itemId)
}

const showGenerateMoreButton = computed(() => !props.generating && props.totalDone > 0 && props.canGenerate)
const generateMoreBtnLabel = computed(() => `Generate ${props.totalForButton} More`)

const emit = defineEmits<{
  generateMore: []
  clear: []
  openLightbox: [index: number]
  openVideoModal: [mediaItemId: string]
  makeAudio: [mediaItemId: string]
  upscale: [mediaItemId: string]
}>()

function handleOpenLightbox(itemId: string) {
  emit('openLightbox', getLightboxIndex(itemId))
}

function handleVideoAction(id: string) {
  emit('openVideoModal', id)
}

function handleAudioAction(id: string) {
  emit('makeAudio', id)
}

function handleUpscaleAction(id: string) {
  emit('upscale', id)
}
</script>

<template>
  <section v-if="results.length > 0" class="mt-8">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Results</h2>
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <span v-if="totalDone > 0" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <strong>{{ doneCountText }}</strong>
          </span>
          <span v-if="totalFailed > 0" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-red-400" />
            {{ failedCountText }}
          </span>
          <span v-if="totalPending > 0" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            {{ pendingCountText }}
          </span>
        </div>
      </div>
      <div class="flex gap-2">
        <UButton v-if="!generating && canGenerate" variant="soft" size="xs" icon="i-lucide-plus" @click="emit('generateMore')">More</UButton>
        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-x" @click="emit('clear')">Clear</UButton>
      </div>
    </div>

    <!-- Progress -->
    <UProgress
      v-if="generating && results.length > 0"
      :value="progressValue"
      class="mb-4"
      size="xs"
    />

    <!-- Grid -->
    <div :class="['grid gap-3', gridClass]">
      <MediaResultCard
        v-for="(item, index) in (results as any[])" :key="item.id"
        :item="item"
        :index="index"
        :action-loading="actionLoading"
        @click="handleOpenLightbox(item.id)"
        @video="handleVideoAction"
        @audio="handleAudioAction"
        @upscale="handleUpscaleAction"
      />
    </div>

    <div v-if="showGenerateMoreButton" class="mt-6 text-center">
      <UButton variant="soft" icon="i-lucide-plus-circle" @click="emit('generateMore')">
        {{ generateMoreBtnLabel }}
      </UButton>
    </div>
  </section>

  <!-- Empty state -->
  <div v-else-if="!generating" class="flex flex-col items-center justify-center min-h-[280px] text-center">
    <div class="w-16 h-16 rounded-2xl bg-linear-to-br from-violet-50 to-cyan-50 border border-violet-100/50 flex items-center justify-center mb-4">
      <UIcon name="i-lucide-sparkles" class="w-8 h-8 text-violet-300" />
    </div>
    <p class="text-slate-400 text-sm max-w-xs">
      <slot name="empty-text">Enter a prompt and configure settings, then Generate.</slot>
    </p>
  </div>
</template>
