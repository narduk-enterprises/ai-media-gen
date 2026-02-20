<script setup lang="ts">
import type { GenerationResult, MediaItemResult } from '~/types/gallery'
import { formatDate } from '~/composables/useGallery'
import type { LightboxItem } from '~/components/AppLightbox.vue'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Gallery' })

const { generations, total, pending, loadingMore, hasMore, error, refresh, loadMore } = useGallery()
const gen = useGeneration()
const actionLoading = gen.actionLoading

// ─── Infinite scroll ──────────────────────────────────────────────────
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value && !pending.value) {
      loadMore()
    }
  }, { rootMargin: '400px' })
})

onUnmounted(() => {
  observer?.disconnect()
})

watch(sentinelRef, (el) => {
  observer?.disconnect()
  if (el) observer?.observe(el)
})

// ─── View modes ────────────────────────────────────────────────────────
type ViewMode = 'grid' | 'grouped' | 'wall'
const viewMode = ref<ViewMode>('grouped')
const searchQuery = ref('')
const sortOrder = ref<'newest' | 'oldest' | 'best'>('newest')
type TypeFilter = 'all' | 'image' | 'video'
const typeFilter = ref<TypeFilter>('all')
const hasVideoOnly = ref(false)

const sortItems = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Best quality', value: 'best' },
]

// ─── Flattened media ─────────────────────────────────────────────────
interface GalleryMedia {
  id: string
  url: string
  generationId: string
  prompt: string
  settings: Record<string, any> | null
  createdAt: string
  imageCount: number
  type: string
  status: string
  qualityScore: number | null
}

const allMedia = computed<GalleryMedia[]>(() => {
  const result: GalleryMedia[] = []
  for (const gen of generations.value || []) {
    let settings: Record<string, any> | null = null
    if (gen.settings) {
      try { settings = JSON.parse(gen.settings) } catch {}
    }
    for (const item of gen.items) {
      if ((item.type === 'image' || item.type === 'video') && item.url && item.status === 'complete') {
        result.push({ id: item.id, url: item.url, generationId: gen.id, prompt: gen.prompt, settings, createdAt: gen.createdAt, imageCount: gen.imageCount, type: item.type, status: item.status, qualityScore: item.qualityScore ?? null })
      }
    }
  }
  return result
})

const genIdsWithVideo = computed<Set<string>>(() => {
  const ids = new Set<string>()
  for (const gen of generations.value || []) {
    if (gen.items.some(i => i.type === 'video' && i.url && i.status === 'complete')) ids.add(gen.id)
  }
  return ids
})

// ─── Filter & sort ─────────────────────────────────────────────────────
const filteredMedia = computed(() => {
  let items = allMedia.value
  if (hasVideoOnly.value) items = items.filter(i => genIdsWithVideo.value.has(i.generationId))
  if (typeFilter.value !== 'all') items = items.filter(i => i.type === typeFilter.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    items = items.filter(i => i.prompt.toLowerCase().includes(q))
  }
  if (sortOrder.value === 'oldest') items = [...items].reverse()
  else if (sortOrder.value === 'best') items = [...items].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
  return items
})

const filteredGenerations = computed(() => {
  let gens = generations.value || []
  if (hasVideoOnly.value) gens = gens.filter(g => genIdsWithVideo.value.has(g.id))
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    gens = gens.filter(g => g.prompt.toLowerCase().includes(q))
  }
  if (typeFilter.value !== 'all') gens = gens.filter(g => g.items.some(i => i.type === typeFilter.value && i.url && i.status === 'complete'))
  if (sortOrder.value === 'oldest') gens = [...gens].reverse()

  // Group sweep generations into combined entries
  const sweepMap = new Map<string, typeof gens>()
  const nonSweep: typeof gens = []
  for (const g of gens) {
    let sweepId: string | null = null
    try { sweepId = JSON.parse(g.settings || '{}').sweepId } catch {}
    if (sweepId) {
      const arr = sweepMap.get(sweepId) || []
      arr.push(g)
      sweepMap.set(sweepId, arr)
    } else {
      nonSweep.push(g)
    }
  }

  // Merge each sweep group into a single combined generation
  const result = [...nonSweep]
  for (const [sweepId, sweepGens] of sweepMap) {
    // Merge all items into one combined generation
    const allItems = sweepGens.flatMap(g => {
      // Tag each item with its sweep label from settings
      let sweepLabel = ''
      try { sweepLabel = JSON.parse(g.settings || '{}').sweepLabel || '' } catch {}
      return g.items.map(item => ({ ...item, prompt: sweepLabel || item.prompt }))
    })
    const first = sweepGens[0]!
    result.push({
      ...first,
      id: `sweep-${sweepId}`,
      imageCount: allItems.length,
      items: allItems,
      // Store sweepId in settings for the grouped view to detect
      settings: JSON.stringify({ ...JSON.parse(first.settings || '{}'), sweepId, sweepVariants: sweepGens.length }),
    })
  }

  // Re-sort by createdAt
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  if (sortOrder.value === 'oldest') result.reverse()

  return result
})

// ─── Lightbox (using AppLightbox) ───────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const showLightboxInfo = ref(false)

const lightboxItems = computed<LightboxItem[]>(() =>
  filteredMedia.value.map(m => ({ id: m.id, url: m.url, type: m.type, prompt: m.prompt, settings: m.settings, createdAt: m.createdAt }))
)

const currentItem = computed(() => filteredMedia.value[lightboxIndex.value] ?? null)

function openLightbox(index: number) {
  lightboxIndex.value = index
  lightboxOpen.value = true
  showLightboxInfo.value = false
}

// ─── Image actions ─────────────────────────────────────────────────────
function copyPrompt(text: string) {
  navigator.clipboard.writeText(text)
}

// ─── Grouped view ──────────────────────────────────────────────────────
const expandedGenerations = ref<Set<string>>(new Set())
watch(() => generations.value, (gens) => {
  if (gens?.length) for (const g of gens) expandedGenerations.value.add(g.id)
}, { immediate: true })

function toggleGeneration(id: string) {
  if (expandedGenerations.value.has(id)) expandedGenerations.value.delete(id)
  else expandedGenerations.value.add(id)
}

function generationMedia(gen: GenerationResult): MediaItemResult[] {
  let items = gen.items.filter(i => (i.type === 'image' || i.type === 'video') && i.url && i.status === 'complete')
  if (typeFilter.value !== 'all') items = items.filter(i => i.type === typeFilter.value)
  return items
}

// ─── Stats ─────────────────────────────────────────────────────────────
const totalMedia = computed(() => allMedia.value.length)
const totalGenerations = computed(() => (generations.value || []).length)

// ─── Video modal ────────────────────────────────────────────────────────
const videoModalOpen = ref(false)
const videoModalTarget = ref<string | null>(null)
const videoError = computed(() => gen.error.value)

function openVideoModal(mediaItemId: string) {
  videoModalTarget.value = mediaItemId
  videoModalOpen.value = true
}

function handleVideoGenerate(settings: { model: string; numFrames: number; steps: number; cfg: number; width: number; height: number; fps?: number; loraStrength?: number; imageStrength?: number }, imageId?: string) {
  const target = imageId || videoModalTarget.value
  if (!target) return
  gen.makeVideo(target, settings)
  videoModalOpen.value = false
}

const activeVideoCount = computed(() => {
  const al = gen.actionLoading.value
  return Object.keys(al).filter(k => (k.startsWith('video-') || k.startsWith('upscale-') || k.startsWith('reimagine-')) && al[k]).length
})

const gridClass = computed(() => {
  if (filteredMedia.value.length <= 2) return 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto'
  if (filteredMedia.value.length <= 4) return 'grid-cols-2 lg:grid-cols-4'
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
})

function downloadMedia(url: string, index: number, type: string = 'image') {
  const ext = type === 'video' ? 'mp4' : 'png'
  const a = document.createElement('a')
  a.href = url; a.download = `gallery-${index + 1}.${ext}`; a.click()
}

function recreateFromImage(img: GalleryMedia) {
  const query: Record<string, string> = { prompt: img.prompt }
  if (img.settings) query.settings = JSON.stringify(img.settings)
  navigateTo({ path: '/create', query })
}

// ─── Reimagine (Image to Image) ─────────────────────────────────────
const reimagineModalOpen = ref(false)
const reimagineTarget = ref<GalleryMedia | null>(null)
const reimagineLoading = ref(false)

function openReimaginModal(item: GalleryMedia) {
  reimagineTarget.value = item
  reimagineModalOpen.value = true
}

function openReimaginByItemId(itemId: string) {
  const item = allMedia.value.find(m => m.id === itemId)
  if (item) openReimaginModal(item)
}

async function handleReimagine(payload: { image: string; prompt: string; cfg: number; steps: number; width: number; height: number; negativePrompt: string; denoise: number }) {
  reimagineLoading.value = true
  try {
    await gen.generateImage2Image(payload)
    reimagineModalOpen.value = false
  } catch (e: any) {
    // Error handled inside modal
  } finally {
    reimagineLoading.value = false
  }
}

// ─── Upscale (Enhance) ───────────────────────────────────────────────
async function upscaleImage(mediaItemId: string) {
  await gen.upscale(mediaItemId)
}
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-slate-50">
    <!-- ═══ Header Bar ═══ -->
    <div class="sticky top-16 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div class="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4 flex-wrap">
        <h1 class="font-display text-lg font-bold text-slate-800 shrink-0">Gallery</h1>

        <!-- Stats -->
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <span><span class="font-medium text-slate-600">{{ totalMedia }}</span> items</span>
          <span class="text-slate-300">·</span>
          <span><span class="font-medium text-slate-600">{{ totalGenerations }}</span> of {{ total }} generations</span>
        </div>

        <div class="flex-1" />

        <!-- Search -->
        <UInput v-model="searchQuery" placeholder="Search prompts…" icon="i-lucide-search" size="sm" class="w-48 lg:w-64" />

        <!-- Sort -->
        <USelect v-model="sortOrder" :items="sortItems" size="sm" class="w-36" />

        <!-- Type filter -->
        <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          <UButton size="xs" :variant="typeFilter === 'all' ? 'solid' : 'ghost'" :color="typeFilter === 'all' ? 'neutral' : 'neutral'" @click="typeFilter = 'all'">All</UButton>
          <UButton size="xs" :variant="typeFilter === 'image' ? 'solid' : 'ghost'" :color="typeFilter === 'image' ? 'neutral' : 'neutral'" icon="i-lucide-image" @click="typeFilter = 'image'">Photos</UButton>
          <UButton size="xs" :variant="typeFilter === 'video' ? 'solid' : 'ghost'" :color="typeFilter === 'video' ? 'neutral' : 'neutral'" icon="i-lucide-film" @click="typeFilter = 'video'">Videos</UButton>
        </div>

        <!-- Has Video -->
        <UButton
          size="xs"
          :variant="hasVideoOnly ? 'soft' : 'outline'"
          :color="hasVideoOnly ? 'info' : 'neutral'"
          icon="i-lucide-film"
          @click="hasVideoOnly = !hasVideoOnly"
        >
          Has Video
        </UButton>

        <!-- View toggle -->
        <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          <UButton size="xs" :variant="viewMode === 'wall' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-layout-grid" @click="viewMode = 'wall'" title="Wall" />
          <UButton size="xs" :variant="viewMode === 'grid' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-grid-2x2" @click="viewMode = 'grid'" title="Grid" />
          <UButton size="xs" :variant="viewMode === 'grouped' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-list" @click="viewMode = 'grouped'" title="Grouped" />
        </div>

        <!-- Refresh -->
        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-refresh-cw" :class="{ 'animate-spin': pending }" @click="refresh()" />
      </div>
    </div>

    <!-- ═══ Body ═══ -->
    <div class="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <!-- Video progress -->
      <UAlert v-if="activeVideoCount > 0" color="info" variant="subtle" icon="i-lucide-loader-2" class="mb-4"
        :title="`Generating ${activeVideoCount} video${activeVideoCount !== 1 ? 's' : ''}…`"
        description="Videos will appear in the gallery when complete. This may take a few minutes."
      />

      <!-- Video error -->
      <UAlert v-if="videoError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="videoError" :close="true" class="mb-4" @update:open="videoError = ''" />

      <!-- Loading -->
      <GallerySkeletonGrid v-if="pending && !generations.length" />

      <!-- Error -->
      <div v-else-if="error" class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm max-w-lg mx-auto">
        Failed to load gallery. <button class="underline" @click="refresh()">Retry</button>
      </div>

      <!-- Empty state -->
      <div v-else-if="!generations.length" class="flex items-center justify-center min-h-[50vh]">
        <div class="text-center">
          <div class="w-20 h-20 mx-auto rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-4">
            <UIcon name="i-lucide-image" class="w-10 h-10 text-violet-300" />
          </div>
          <p class="text-slate-500 text-sm mb-1">Your gallery is empty</p>
          <p class="text-slate-400 text-xs mb-4">Generate some images to see them here</p>
          <UButton to="/create" size="sm">Create something</UButton>
        </div>
      </div>

      <!-- No results -->
      <div v-else-if="searchQuery && filteredMedia.length === 0" class="flex items-center justify-center min-h-[30vh]">
        <div class="text-center">
          <UIcon name="i-lucide-search" class="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p class="text-slate-500 text-sm">No results match "{{ searchQuery }}"</p>
          <button class="text-violet-500 text-xs mt-1 hover:underline" @click="searchQuery = ''">Clear search</button>
        </div>
      </div>

      <!-- ═══ Wall View ═══ -->
      <div v-else-if="viewMode === 'wall'">
        <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-0.5">
          <div v-for="(item, index) in filteredMedia" :key="item.id" class="relative aspect-square overflow-hidden cursor-pointer" @click="openLightbox(index)">
            <video v-if="item.type === 'video'" :src="item.url + '#t=0.1'" muted preload="metadata" class="w-full h-full object-cover" />
            <NuxtImg v-else :src="item.url" :alt="item.prompt" width="300" class="w-full h-full object-cover" loading="lazy" />
            <div v-if="item.type === 'video'" class="absolute top-1 left-1 w-4 h-4 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
              <UIcon name="i-lucide-play" class="w-2.5 h-2.5 text-white" />
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Grid View ═══ -->
      <div v-else-if="viewMode === 'grid'">
        <div :class="['grid gap-2', gridClass]">
          <MediaThumbnail
            v-for="(item, index) in filteredMedia" :key="item.id"
            :url="item.url" :type="item.type" :prompt="item.prompt"
            :date="formatDate(item.createdAt)" show-overlay show-actions
            @click="openLightbox(index)"
          >
            <template #actions>
              <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-image-plus"
                @click.stop="openReimaginModal(item)" title="Reimagine" />
              <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-sparkles"
                :loading="actionLoading[`upscale-${item.id}`]" @click.stop="upscaleImage(item.id)" title="Enhance 2x" />
              <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-film"
                :loading="actionLoading[`video-${item.id}`]" @click.stop="openVideoModal(item.id)" title="Animate" />
              <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-download" @click.stop="downloadMedia(item.url, index, item.type)" />
            </template>
          </MediaThumbnail>
        </div>
      </div>

      <!-- ═══ Grouped View ═══ -->
      <div v-else>
        <GalleryGroupedView
          :generations="filteredGenerations"
          :expanded-generations="expandedGenerations"
          :action-loading="actionLoading"
          :filtered-media="filteredMedia"
          @toggle="toggleGeneration"
          @open-lightbox="openLightbox"
          @open-video-modal="openVideoModal"
          @open-reimagine="openReimaginByItemId"
          @upscale="upscaleImage"
          @download-media="downloadMedia"
          @copy-prompt="copyPrompt"
          @recreate="(prompt: string) => navigateTo({ path: '/create', query: { prompt } })"
        />
      </div>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinelRef" class="flex justify-center mt-6 py-4">
        <template v-if="loadingMore">
          <div class="flex items-center gap-2 text-sm text-slate-400">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
            Loading more…
          </div>
        </template>
        <template v-else-if="hasMore">
          <UButton variant="ghost" size="xs" color="neutral" @click="loadMore()">
            {{ generations.length }} of {{ total }} loaded
          </UButton>
        </template>
        <template v-else-if="generations.length > 0">
          <span class="text-xs text-slate-300">All {{ total }} generations loaded</span>
        </template>
      </div>
    </div>

    <!-- ═══ Lightbox ═══ -->
    <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
      <template #toolbar="{ item, index: idx }">
        <UButton variant="ghost" size="xs" icon="i-lucide-clipboard-copy" class="text-white/60 hover:text-white" @click="copyPrompt(currentItem?.prompt || '')">Prompt</UButton>
        <UButton variant="ghost" size="xs" icon="i-lucide-sparkles" class="text-white/60 hover:text-white"
            :loading="actionLoading[`upscale-${item.id}`]" @click="upscaleImage(item.id)">Enhance</UButton>
        <template v-if="item.type === 'image'">
          <UButton variant="ghost" size="xs" icon="i-lucide-image-plus" class="text-white/60 hover:text-white"
            @click="openReimaginByItemId(item.id)">Reimagine</UButton>
          <UButton variant="ghost" size="xs" icon="i-lucide-film" class="text-white/60 hover:text-white"
            :loading="actionLoading[`video-${item.id}`]" @click="openVideoModal(item.id)">Video</UButton>
        </template>
        <UButton variant="ghost" size="xs" icon="i-lucide-info" class="text-white/60 hover:text-white" @click="showLightboxInfo = !showLightboxInfo">Info</UButton>
        <UButton variant="ghost" size="xs" icon="i-lucide-refresh-cw" class="text-white/60 hover:text-white" @click="currentItem && recreateFromImage(currentItem)">Recreate</UButton>
      </template>

      <template #panel="{ item }">
        <Transition name="fade">
          <div v-if="showLightboxInfo && currentItem" class="absolute bottom-16 left-1/2 -translate-x-1/2 w-[440px] max-h-[350px] overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md p-4 text-sm text-white/80 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs uppercase tracking-wider text-white/50 font-medium">Generation Info</span>
              <button class="text-white/40 hover:text-white text-xs" @click="showLightboxInfo = false">✕</button>
            </div>
            <div v-if="currentItem.type === 'video'" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-film" class="w-3.5 h-3.5 text-violet-400" />
              <span class="text-xs text-violet-400 font-medium">Video</span>
            </div>
            <div>
              <span class="text-[10px] text-white/40 uppercase tracking-wider">Prompt</span>
              <p class="text-xs text-white/80 mt-0.5 leading-relaxed">{{ currentItem.prompt }}</p>
            </div>
            <div v-if="currentItem.settings" class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span class="text-white/40">Dimensions</span><span>{{ currentItem.settings.width }} × {{ currentItem.settings.height }}</span>
              <span class="text-white/40">Steps</span><span>{{ currentItem.settings.steps }}</span>
              <span class="text-white/40">Created</span><span>{{ formatDate(currentItem.createdAt) }}</span>
              <template v-if="currentItem.settings.negativePrompt">
                <span class="text-white/40">Neg. prompt</span>
                <span class="text-white/60 line-clamp-2" :title="currentItem.settings.negativePrompt">{{ currentItem.settings.negativePrompt }}</span>
              </template>
            </div>
            <div v-if="currentItem.settings?.attributes && Object.keys(currentItem.settings.attributes).length > 0" class="border-t border-white/10 pt-2">
              <span class="text-[10px] text-white/40 uppercase tracking-wider">Attributes</span>
              <div class="flex flex-wrap gap-1 mt-1">
                <span v-for="(val, key) in currentItem.settings.attributes" :key="String(key)" class="px-2 py-0.5 rounded-full bg-white/10 text-[10px]">{{ key }}: {{ val }}</span>
              </div>
            </div>
            <div class="border-t border-white/10 pt-2 flex items-center gap-3 text-[10px] text-white/30">
              <span>← → Navigate</span><span>Esc Close</span>
            </div>
          </div>
        </Transition>
      </template>
    </AppLightbox>

    <!-- Video Settings Modal -->
    <VideoSettingsModal
      :open="videoModalOpen"
      :media-item-id="videoModalTarget"
      :loading="videoModalTarget ? actionLoading[`video-${videoModalTarget}`] : false"
      @close="videoModalOpen = false"
      @generate="handleVideoGenerate"
    />

    <!-- Reimagine Modal -->
    <ReimagineModal
      :open="reimagineModalOpen"
      :target="reimagineTarget"
      :loading="reimagineLoading"
      @update:open="reimagineModalOpen = $event"
      @submit="handleReimagine"
    />
  </div>
</template>

<script lang="ts">
function parseSettings(settingsJson: string | null | undefined): Record<string, any> | null {
  if (!settingsJson) return null
  try { return JSON.parse(settingsJson) } catch { return null }
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
