<script setup lang="ts">
import type { TabsItem } from '#ui/types'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Create' })

// ─── Composables ────────────────────────────────────────────────────────
const gen = useGeneration()
const shared = useCreateShared()

// ─── Machine Selection ──────────────────────────────────────────────────
interface ActivePod { id: string; name: string; url: string; activeJobs: number }
const activePods = ref<ActivePod[]>([])

async function fetchPods() {
  try {
    const data = await $fetch<{ pods: ActivePod[] }>('/api/runpod/active-pods')
    activePods.value = data.pods
  } catch {}
}

const machineOptions = computed(() => {
  const opts = [
    { label: 'Auto', value: 'auto' },
    { label: 'Any Machine', value: 'any' },
  ]
  for (const pod of activePods.value) {
    const shortId = pod.id.slice(0, 8)
    opts.push({ label: `${pod.name || shortId} (q${pod.activeJobs})`, value: pod.url })
  }
  return opts
})

onMounted(fetchPods)

// ─── Tab Management ─────────────────────────────────────────────────────
const mode = ref<string | number>('text2image')
const route = useRoute()

const modeTabs: TabsItem[] = [
  { label: 'Text → Image', icon: 'i-lucide-image', value: 'text2image', slot: 'text2image' },
  { label: 'Video', icon: 'i-lucide-clapperboard', value: 'ultimateVideo', slot: 'ultimateVideo' },
  { label: 'Sweep', icon: 'i-lucide-test-tubes', value: 'sweep', slot: 'sweep' },
  { label: 'Text → Video', icon: 'i-lucide-film', value: 'text2video', slot: 'text2video' },
  { label: 'Image → Image', icon: 'i-lucide-image-plus', value: 'img2img', slot: 'img2img' },
  { label: 'Image → Video', icon: 'i-lucide-film', value: 'img2video', slot: 'img2video' },
  { label: 'Video → Prompt', icon: 'i-lucide-file-text', value: 'video2prompt', slot: 'video2prompt' },
  { label: 'Custom', icon: 'i-lucide-code-2', value: 'custom', slot: 'custom' },
]

// ─── Tab Refs ───────────────────────────────────────────────────────────
const t2iTab = ref<{ generate: (append?: boolean) => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const ultimateVideoTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const t2vTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const i2iTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const img2videoTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const customTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const sweepTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const video2promptTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)

const activeTab = computed(() => {
  if (mode.value === 'text2image') return t2iTab.value
  if (mode.value === 'ultimateVideo') return ultimateVideoTab.value
  if (mode.value === 'sweep') return sweepTab.value
  if (mode.value === 'text2video') return t2vTab.value
  if (mode.value === 'img2img') return i2iTab.value
  if (mode.value === 'img2video') return img2videoTab.value
  if (mode.value === 'video2prompt') return video2promptTab.value
  if (mode.value === 'custom') return customTab.value
  return null
})

const canGenerate = computed(() => activeTab.value?.canGenerate ?? false)
const totalCount = computed(() => activeTab.value?.totalCount ?? 0)
const isVideoMode = computed(() => activeTab.value?.isVideo ?? false)

// ─── Generate ───────────────────────────────────────────────────────────
function handleGenerate(append = false) {
  if (mode.value === 'text2image') t2iTab.value?.generate(append)
  else activeTab.value?.generate()
}

// ─── Navigate to video tab (from gallery / lightbox) ────────────────────
const prefillMediaId = ref<string | null>(null)
function goToVideoTab(mediaItemId: string) {
  mode.value = 'ultimateVideo'
  prefillMediaId.value = mediaItemId
}
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
function openLightbox(index: number) { lightboxIndex.value = index; lightboxOpen.value = true }
const lightboxItems = computed(() => gen.completedMedia.value.map(m => ({ id: m.id, url: m.url!, type: m.type })))

// ─── Persist mode + query param routing ─────────────────────────────────
onMounted(() => {
  const qTab = route.query.tab as string | undefined
  const qMedia = route.query.mediaId as string | undefined
  if (qTab && modeTabs.some(t => t.value === qTab)) {
    mode.value = qTab
    if (qMedia) prefillMediaId.value = qMedia
  } else {
    const s = shared.restoreForm()
    if (s.mode) mode.value = s.mode
  }
})
watch(mode, () => shared.persistForm({ mode: mode.value }))

// ─── Reset ──────────────────────────────────────────────────────────────
function resetForm() {
  shared.resetShared()
  gen.clearResults()
  shared.persistForm()
}

const gridClass = computed(() => {
  const c = gen.results.value.length
  if (c <= 1) return 'grid-cols-1 max-w-xl mx-auto'
  if (c <= 2) return 'grid-cols-2'
  if (c <= 4) return 'grid-cols-2 xl:grid-cols-4'
  return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
})
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-32">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="font-display text-3xl font-bold mb-1">
          <span class="text-transparent bg-clip-text bg-linear-to-r from-violet-400 to-cyan-400">Create</span>
        </h1>
        <p class="text-sm text-white/40">Generate images and videos with AI models.</p>
      </div>
      <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-rotate-ccw" @click="resetForm">Start Over</UButton>
    </div>

    <!-- Error -->
    <UAlert v-if="gen.error.value" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="gen.error.value" :close="true" class="mb-6" @update:open="gen.error.value = ''" />

    <!-- ═══ Mode Tabs ═══ -->
    <UTabs v-model="mode" :items="modeTabs" class="mb-6" variant="pill">
      <template #text2image>
        <CreateTextToImageTab ref="t2iTab" />
      </template>
      <template #ultimateVideo>
        <CreateUltimateVideoTab ref="ultimateVideoTab" :prefill-media-id="prefillMediaId" />
      </template>
      <template #sweep>
        <CreateSweepTab ref="sweepTab" />
      </template>
      <template #text2video>
        <CreateTextToVideoTab ref="t2vTab" />
      </template>
      <template #img2img>
        <CreateImageToImageTab ref="i2iTab" />
      </template>
      <template #img2video>
        <CreateImageToVideoPipelineTab ref="img2videoTab" />
      </template>
      <template #custom>
        <CreateCustomWorkflowTab ref="customTab" />
      </template>
      <template #video2prompt>
        <CreateVideoPromptTab ref="video2promptTab" />
      </template>
    </UTabs>

    <!-- ═══ Generate Button (sticky) ═══ -->
    <div v-if="mode !== 'video2prompt'" class="fixed bottom-0 left-0 right-0 bg-[var(--color-surface-1)]/95 backdrop-blur-xl border-t border-white/6 py-3 px-4 z-10">
      <div class="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="resetForm">Start Over</UButton>
          <UButton v-if="gen.results.value.length > 0" variant="ghost" color="error" size="sm" icon="i-lucide-trash-2" @click="gen.clearResults()">Clear Results</UButton>
        </div>
        <div class="flex items-center gap-4">
          <USelect v-model="shared.targetMachine.value" :items="machineOptions" size="xs" class="w-44" />
          <UButton :loading="gen.generating.value" :disabled="!canGenerate" size="lg" :icon="isVideoMode ? 'i-lucide-film' : 'i-lucide-sparkles'" @click="handleGenerate(false)">
            {{ gen.generating.value ? 'Generating…' : (canGenerate ? (isVideoMode ? `Generate ${totalCount} Video${totalCount !== 1 ? 's' : ''}` : `Generate ${totalCount} Image${totalCount !== 1 ? 's' : ''}`) : 'Configure above') }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- ═══ Results ═══ -->
    <CreateResults
      v-if="mode !== 'video2prompt'"
      :results="gen.results.value" :generating="gen.generating.value" :can-generate="canGenerate" :is-video-mode="isVideoMode"
      :total-done="gen.totalDone.value" :total-failed="gen.totalFailed.value" :total-pending="gen.totalPending.value"
      :completed-media="gen.completedMedia.value" :batch-progress="gen.batchProgress.value" :action-loading="gen.actionLoading.value"
      :grid-class="gridClass" :total-for-button="totalCount"
      @generate-more="handleGenerate(true)" @clear="gen.clearResults()" @open-lightbox="openLightbox"
      @open-video-modal="goToVideoTab" @make-audio="gen.makeAudio($event, '')" @upscale="gen.upscale($event)"
    />
  </div>

  <!-- ═══ Lightbox ═══ -->
  <ClientOnly>
    <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
      <template #toolbar="{ item }">
        <UButton variant="ghost" size="xs" icon="i-lucide-sparkles" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`upscale-${item.id}`]" @click="gen.upscale(item.id)">Enhance</UButton>
        <template v-if="item.type === 'image'">
          <UButton variant="ghost" size="xs" icon="i-lucide-film" class="text-white/60 hover:text-white" @click="goToVideoTab(item.id)">Video</UButton>
          <UButton variant="ghost" size="xs" icon="i-lucide-music" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`audio-${item.id}`]" @click="gen.makeAudio(item.id, '')">Audio</UButton>
        </template>
      </template>
    </AppLightbox>
  </ClientOnly>

</template>
