<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Create' })

// ─── Composables ────────────────────────────────────────────────────────
const gen = useGeneration()
const shared = useCreateShared()

// ─── Tab Management ─────────────────────────────────────────────────────
const mode = ref<string | number>('text2image')

const modeTabs: TabsItem[] = [
  { label: 'Text → Image', icon: 'i-lucide-image', value: 'text2image', slot: 'text2image' },
  { label: 'Text → Video', icon: 'i-lucide-film', value: 'text2video', slot: 'text2video' },
  { label: 'Image → Image', icon: 'i-lucide-image-plus', value: 'img2img', slot: 'img2img' },
  { label: 'Image → Video', icon: 'i-lucide-clapperboard', value: 'img2video', slot: 'img2video' },
  { label: 'Auto Video', icon: 'i-lucide-wand-sparkles', value: 'autoVideo', slot: 'autoVideo' },
  { label: 'Sweep', icon: 'i-lucide-test-tubes', value: 'sweep', slot: 'sweep' },
]

// ─── Tab Refs ───────────────────────────────────────────────────────────
const t2iTab = ref<{ generate: (append?: boolean) => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const t2vTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const i2iTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const i2vTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const autoVideoTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)
const sweepTab = ref<{ generate: () => Promise<void>; canGenerate: boolean; totalCount: number; isVideo: boolean } | null>(null)

const activeTab = computed(() => {
  if (mode.value === 'text2image') return t2iTab.value
  if (mode.value === 'text2video') return t2vTab.value
  if (mode.value === 'img2img') return i2iTab.value
  if (mode.value === 'img2video') return i2vTab.value
  if (mode.value === 'autoVideo') return autoVideoTab.value
  if (mode.value === 'sweep') return sweepTab.value
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

// ─── Image-to-Video direct upload ───────────────────────────────────────
async function handleI2VGenerate(body: Record<string, any>) {
  // For direct image upload → video, we need to:
  // 1. Upload the image as a media item via image2image with identity transform
  // 2. Then make video from it
  // For now, use the video endpoint which accepts inline base64
  const { runpodEndpoint, customEndpoint } = useAppSettings()
  const endpoint = customEndpoint.value || runpodEndpoint.value
  body.endpoint = endpoint
  try {
    gen.submitting.value = true
    gen.error.value = ''
    const result = await $fetch<{ item: { id: string; type: string; url: string | null; status: string; parentId: string | null } }>('/api/generate/video-from-image', {
      method: 'POST', body,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.item) {
      gen.results.value.push(result.item)
      const queue = useQueue()
      queue.submitAndTrack(result.item.id)
    }
  } catch (e: any) {
    gen.error.value = e.data?.message || 'Image-to-video generation failed'
  } finally {
    gen.submitting.value = false
  }
}

// ─── Video modal / Lightbox ─────────────────────────────────────────────
const videoModalOpen = ref(false)
const videoModalTarget = ref<string | null>(null)
function openVideoModal(mediaItemId: string) { videoModalTarget.value = mediaItemId; videoModalOpen.value = true }
function handleVideoGenerate(settings: { numFrames: number; steps: number; cfg: number; width: number; height: number }, imageId?: string) {
  const target = imageId || videoModalTarget.value
  if (!target) return
  gen.makeVideo(target, settings)
  videoModalOpen.value = false; videoModalTarget.value = null
}

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
function openLightbox(index: number) { lightboxIndex.value = index; lightboxOpen.value = true }
const lightboxItems = computed(() => gen.completedMedia.value.map(m => ({ id: m.id, url: m.url!, type: m.type })))

// ─── Persist mode ───────────────────────────────────────────────────────
onMounted(() => {
  const s = shared.restoreForm()
  if (s.mode) mode.value = s.mode
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
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-32">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="font-display text-3xl font-bold text-slate-800 mb-1">
          <span class="text-transparent bg-clip-text bg-linear-to-r from-violet-600 to-cyan-600">Create</span>
        </h1>
        <p class="text-sm text-slate-500">Generate images and videos with AI models.</p>
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
      <template #text2video>
        <CreateTextToVideoTab ref="t2vTab" />
      </template>
      <template #img2img>
        <CreateImageToImageTab ref="i2iTab" />
      </template>
      <template #img2video>
        <CreateImageToVideoTab ref="i2vTab" @generate-i2v="handleI2VGenerate" />
      </template>
      <template #autoVideo>
        <CreateAutoVideoTab ref="autoVideoTab" />
      </template>
      <template #sweep>
        <CreateSweepTab ref="sweepTab" />
      </template>
    </UTabs>

    <!-- ═══ Generate Button (sticky) ═══ -->
    <div class="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 py-3 px-4 z-10">
      <div class="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="resetForm">Start Over</UButton>
          <UButton v-if="gen.results.value.length > 0" variant="ghost" color="error" size="sm" icon="i-lucide-trash-2" @click="gen.clearResults()">Clear Results</UButton>
        </div>
        <UButton :loading="gen.generating.value" :disabled="!canGenerate" size="lg" :icon="isVideoMode ? 'i-lucide-film' : 'i-lucide-sparkles'" @click="handleGenerate(false)">
          {{ gen.generating.value ? 'Generating…' : (canGenerate ? (isVideoMode ? `Generate ${totalCount} Video${totalCount !== 1 ? 's' : ''}` : `Generate ${totalCount} Image${totalCount !== 1 ? 's' : ''}`) : 'Configure above') }}
        </UButton>
      </div>
    </div>

    <!-- ═══ Results ═══ -->
    <CreateResults
      :results="gen.results.value" :generating="gen.generating.value" :can-generate="canGenerate" :is-video-mode="isVideoMode"
      :total-done="gen.totalDone.value" :total-failed="gen.totalFailed.value" :total-pending="gen.totalPending.value"
      :completed-media="gen.completedMedia.value" :batch-progress="gen.batchProgress.value" :action-loading="gen.actionLoading.value"
      :grid-class="gridClass" :total-for-button="totalCount"
      @generate-more="handleGenerate(true)" @clear="gen.clearResults()" @open-lightbox="openLightbox"
      @open-video-modal="openVideoModal" @make-audio="gen.makeAudio($event, '')" @upscale="gen.upscale($event)"
    />
  </div>

  <!-- ═══ Lightbox ═══ -->
  <ClientOnly>
    <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
      <template #toolbar="{ item }">
        <UButton variant="ghost" size="xs" icon="i-lucide-sparkles" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`upscale-${item.id}`]" @click="gen.upscale(item.id)">Enhance</UButton>
        <template v-if="item.type === 'image'">
          <UButton variant="ghost" size="xs" icon="i-lucide-film" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`video-${item.id}`]" @click="openVideoModal(item.id)">Video</UButton>
          <UButton variant="ghost" size="xs" icon="i-lucide-music" class="text-white/60 hover:text-white" :loading="gen.actionLoading.value[`audio-${item.id}`]" @click="gen.makeAudio(item.id, '')">Audio</UButton>
        </template>
      </template>
    </AppLightbox>
  </ClientOnly>

  <!-- Video Settings Modal -->
  <ClientOnly>
    <VideoSettingsModal :open="videoModalOpen" :media-item-id="videoModalTarget" :loading="videoModalTarget ? gen.actionLoading.value[`video-${videoModalTarget}`] : false" @close="videoModalOpen = false" @generate="handleVideoGenerate" />
  </ClientOnly>
</template>
