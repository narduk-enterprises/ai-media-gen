<script setup lang="ts">
import type { GenerationResult, MediaItemResult } from '~/types/gallery'
import { formatDate } from '~/composables/useGallery'
import type { LightboxItem } from '~/components/AppLightbox.vue'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Gallery' })

const { generations, total, pending, loadingMore, hasMore, error, refresh, loadMore } = useGallery()
const { runpodEndpoint, customEndpoint } = useAppSettings()
const effectiveEndpoint = computed(() => customEndpoint.value || runpodEndpoint.value)

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
  return gens
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
const actionLoading = ref<Record<string, boolean>>({})
const videoProcessingItems = ref<Array<{ id: string; mediaItemId: string; status: string }>>([])
const videoError = ref('')

function openVideoModal(mediaItemId: string) {
  videoModalTarget.value = mediaItemId
  videoModalOpen.value = true
}

function handleVideoGenerate(settings: { numFrames: number; steps: number; cfg: number; width: number; height: number }) {
  if (!videoModalTarget.value) return
  makeVideoFromGallery(videoModalTarget.value, settings)
  videoModalOpen.value = false
}

async function makeVideoFromGallery(mediaItemId: string, settings?: Record<string, any> | null) {
  const loadingKey = `video-${mediaItemId}`
  if (actionLoading.value[loadingKey]) return
  actionLoading.value[loadingKey] = true
  videoError.value = ''
  try {
    const result = await $fetch<{ item: { id: string; status: string } }>('/api/generate/video', {
      method: 'POST',
      body: { mediaItemId, numFrames: settings?.numFrames || 81, steps: settings?.steps || 20, cfg: settings?.cfg || 3.5, width: settings?.width || 768, height: settings?.height || 768, endpoint: effectiveEndpoint.value },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.item) {
      videoProcessingItems.value.push({ id: result.item.id, mediaItemId, status: result.item.status })
      if (result.item.status === 'processing' || result.item.status === 'queued') pollVideoStatus(result.item.id, loadingKey)
      else actionLoading.value[loadingKey] = false
    }
  } catch (e: any) {
    videoError.value = e.data?.message || 'Video generation failed'
    actionLoading.value[loadingKey] = false
  }
}

async function pollVideoStatus(itemId: string, loadingKey: string) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const result = await $fetch<{ item: { id: string; status: string } }>(`/api/generate/status/${itemId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      const idx = videoProcessingItems.value.findIndex(v => v.id === itemId)
      if (idx >= 0) videoProcessingItems.value[idx]!.status = result.item.status
      if (result.item.status === 'complete' || result.item.status === 'failed') {
        actionLoading.value[loadingKey] = false
        videoProcessingItems.value = videoProcessingItems.value.filter(v => v.id !== itemId)
        refresh()
        return
      }
    } catch { /* continue polling */ }
  }
  actionLoading.value[loadingKey] = false
  videoProcessingItems.value = videoProcessingItems.value.filter(v => v.id !== itemId)
}

const activeVideoCount = computed(() => videoProcessingItems.value.length)

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
          <div v-for="(item, index) in filteredMedia" :key="item.id"
            class="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-slate-200 hover:border-violet-300 transition-all shadow-sm hover:shadow-md"
            @click="openLightbox(index)"
          >
            <video v-if="item.type === 'video'" :src="item.url + '#t=0.1'" muted preload="metadata"
              class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              @mouseenter="($event.target as HTMLVideoElement).play()" @mouseleave="($event.target as HTMLVideoElement).pause()" />
            <NuxtImg v-else :src="item.url" :alt="item.prompt" width="400"
              class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
            <div v-if="item.type === 'video'" class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px] flex items-center gap-1 backdrop-blur-sm">
              <UIcon name="i-lucide-play" class="w-3 h-3" /> Video
            </div>
            <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div class="absolute bottom-0 left-0 right-0 p-2.5 pointer-events-none">
                <p class="text-white text-[10px] line-clamp-2 leading-relaxed">{{ item.prompt }}</p>
                <p class="text-white/50 text-[9px] mt-0.5">{{ formatDate(item.createdAt) }}</p>
              </div>
            </div>
            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-film"
                :loading="actionLoading[`video-${item.id}`]" @click.stop="openVideoModal(item.id)" />
              <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-download" @click.stop="downloadMedia(item.url, index, item.type)" />
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Grouped View ═══ -->
      <div v-else class="space-y-4">
        <div v-for="gen in filteredGenerations" :key="gen.id" class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors" @click="toggleGeneration(gen.id)">
            <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-slate-200">
              <video v-if="generationMedia(gen)[0]?.type === 'video' && generationMedia(gen)[0]?.url" :src="generationMedia(gen)[0]!.url! + '#t=0.1'" muted preload="metadata" class="w-full h-full object-cover" />
              <NuxtImg v-else-if="generationMedia(gen)[0]?.url" :src="generationMedia(gen)[0]!.url!" alt="" width="80" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full bg-slate-100" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-700 line-clamp-1">{{ gen.prompt }}</p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[10px] text-slate-400">{{ formatDate(gen.createdAt) }}</span>
                <span class="text-[10px] text-slate-300">·</span>
                <span class="text-[10px] text-slate-400">{{ generationMedia(gen).length }} item{{ generationMedia(gen).length !== 1 ? 's' : '' }}</span>
                <UBadge v-if="gen.status !== 'complete'" :color="gen.status === 'processing' || gen.status === 'queued' ? 'warning' : 'error'" variant="subtle" size="xs">{{ gen.status }}</UBadge>
              </div>
            </div>
            <UIcon :name="expandedGenerations.has(gen.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          <div v-if="expandedGenerations.has(gen.id)" class="px-4 pb-3 border-t border-slate-100">
            <div v-if="gen.settings" class="py-2 flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
              <template v-if="parseSettings(gen.settings)">
                <span>{{ parseSettings(gen.settings)?.width }}×{{ parseSettings(gen.settings)?.height }}</span>
                <span class="text-slate-200">·</span>
                <span>{{ parseSettings(gen.settings)?.steps }} steps</span>
                <template v-if="parseSettings(gen.settings)?.attributes">
                  <span class="text-slate-200">·</span>
                  <span v-for="(val, key) in parseSettings(gen.settings)?.attributes" :key="String(key)" class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{{ key }}: {{ val }}</span>
                </template>
              </template>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 mt-1">
              <div v-for="item in generationMedia(gen)" :key="item.id"
                class="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-slate-200 hover:border-violet-300 transition-all"
                @click="openLightbox(filteredMedia.findIndex(i => i.id === item.id))"
              >
                <video v-if="item.type === 'video'" :src="item.url! + '#t=0.1'" muted preload="metadata"
                  class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  @mouseenter="($event.target as HTMLVideoElement).play()" @mouseleave="($event.target as HTMLVideoElement).pause()" />
                <NuxtImg v-else :src="item.url!" alt="" width="300"
                  class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                <div v-if="item.type === 'video'" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/50 text-white text-[9px] flex items-center gap-0.5 backdrop-blur-sm">
                  <UIcon name="i-lucide-play" class="w-2.5 h-2.5" /> Video
                </div>
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                <div class="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-film"
                    :loading="actionLoading[`video-${item.id}`]" @click.stop="openVideoModal(item.id)" />
                  <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-download" @click.stop="downloadMedia(item.url!, 0, item.type)" />
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
              <UButton variant="link" size="xs" color="neutral" icon="i-lucide-clipboard-copy" @click="copyPrompt(gen.prompt)">Copy prompt</UButton>
              <UButton variant="link" size="xs" color="neutral" icon="i-lucide-refresh-cw" @click="navigateTo({ path: '/create', query: { prompt: gen.prompt } })">Recreate</UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Load More -->
      <div v-if="hasMore" class="flex justify-center mt-6">
        <UButton :loading="loadingMore" variant="soft" size="sm" icon="i-lucide-arrow-down" @click="loadMore()">
          Load more ({{ generations.length }} of {{ total }})
        </UButton>
      </div>
    </div>

    <!-- ═══ Lightbox ═══ -->
    <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
      <template #toolbar="{ item, index: idx }">
        <UButton variant="ghost" size="xs" icon="i-lucide-clipboard-copy" class="text-white/60 hover:text-white" @click="copyPrompt(currentItem?.prompt || '')">Prompt</UButton>
        <template v-if="item.type === 'image'">
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
      :loading="videoModalTarget ? actionLoading[`video-${videoModalTarget}`] : false"
      @close="videoModalOpen = false"
      @generate="handleVideoGenerate"
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
