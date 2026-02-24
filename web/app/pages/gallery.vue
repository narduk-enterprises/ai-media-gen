<script setup lang="ts">
import { formatDate } from '~/composables/useGallery'

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
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value && !pending.value) loadMore()
  }, { rootMargin: '400px' })
})
onUnmounted(() => observer?.disconnect())

watch(sentinelRef, (el) => { observer?.disconnect(); if (el) observer?.observe(el) })
watch([pending, loadingMore], () => {
  if (!pending.value && !loadingMore.value && hasMore.value && sentinelRef.value) {
    observer?.disconnect()
    observer?.observe(sentinelRef.value)
  }
})

// ─── Filters ──────────────────────────────────────────────────────────
const searchQuery = ref('')
const sortOrder = ref<'newest' | 'oldest'>('newest')
type TypeFilter = 'all' | 'image' | 'video'
const typeFilter = ref<TypeFilter>('all')
const largeGrid = ref(true)

// ─── Flattened media ─────────────────────────────────────────────────
interface GalleryMedia {
  id: string; url: string; generationId: string; prompt: string
  settings: Record<string, any> | null; createdAt: string; type: string
}

const parsedSettingsCache = computed(() => {
  const cache = new Map<string, Record<string, any> | null>()
  for (const g of generations.value || []) {
    if (g.settings) { try { cache.set(g.id, JSON.parse(g.settings)) } catch { cache.set(g.id, null) } }
    else cache.set(g.id, null)
  }
  return cache
})

const allMedia = computed<GalleryMedia[]>(() => {
  const result: GalleryMedia[] = []
  for (const g of generations.value || []) {
    const settings = parsedSettingsCache.value.get(g.id) ?? null
    for (const item of g.items) {
      if ((item.type === 'image' || item.type === 'video') && item.url && item.status === 'complete')
        result.push({ id: item.id, url: item.url, generationId: g.id, prompt: g.prompt, settings, createdAt: g.createdAt, type: item.type })
    }
  }
  return result
})

const filteredMedia = computed(() => {
  let items = allMedia.value
  if (typeFilter.value !== 'all') items = items.filter(i => i.type === typeFilter.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    items = items.filter(i => i.prompt.toLowerCase().includes(q))
  }
  if (sortOrder.value === 'oldest') items = [...items].reverse()
  return items
})

// ─── Lightbox ─────────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const showInfo = ref(false)
const currentItem = computed(() => filteredMedia.value[lightboxIndex.value] ?? null)

function openLightbox(index: number) {
  lightboxIndex.value = index
  lightboxOpen.value = true
  showInfo.value = false
}

// ─── Actions ──────────────────────────────────────────────────────────
function copyPrompt(text: string) { navigator.clipboard.writeText(text) }
function goToVideo(id: string) { navigateTo({ path: '/create', query: { tab: 'img2video', mediaId: id } }) }
function goToReimagine(id: string) { navigateTo({ path: '/create', query: { tab: 'img2img', mediaId: id } }) }
async function upscaleImage(id: string) { await gen.upscale(id) }

function downloadMedia(url: string, type: string = 'image') {
  const a = document.createElement('a')
  a.href = url; a.download = `gallery.${type === 'video' ? 'mp4' : 'png'}`; a.click()
}
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-slate-50">
    <!-- Header -->
    <div class="sticky top-16 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div class="max-w-400 mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
        <h1 class="font-display text-lg font-bold text-slate-800 shrink-0">Gallery</h1>
        <span class="text-xs text-slate-400"><span class="font-medium text-slate-600">{{ allMedia.length }}</span> items</span>
        <div class="flex-1" />

        <UInput v-model="searchQuery" placeholder="Search…" icon="i-lucide-search" size="sm" class="w-40 lg:w-56" />

        <!-- Type filter -->
        <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          <UButton size="xs" :variant="typeFilter === 'all' ? 'solid' : 'ghost'" color="neutral" @click="typeFilter = 'all'">All</UButton>
          <UButton size="xs" :variant="typeFilter === 'image' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-image" @click="typeFilter = 'image'" />
          <UButton size="xs" :variant="typeFilter === 'video' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-film" @click="typeFilter = 'video'" />
        </div>

        <!-- Size toggle -->
        <UButton size="xs" variant="ghost" color="neutral" :icon="largeGrid ? 'i-lucide-grid-2x2' : 'i-lucide-layout-grid'" @click="largeGrid = !largeGrid" :title="largeGrid ? 'Smaller' : 'Larger'" />

        <!-- Sort -->
        <UButton size="xs" variant="ghost" color="neutral" :icon="sortOrder === 'newest' ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-narrow-wide'" @click="sortOrder = sortOrder === 'newest' ? 'oldest' : 'newest'" :title="sortOrder === 'newest' ? 'Newest first' : 'Oldest first'" />

        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-refresh-cw" :class="{ 'animate-spin': pending }" @click="refresh()" />
      </div>
    </div>

    <!-- Body -->
    <div class="max-w-400 mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <!-- Loading -->
      <GallerySkeletonGrid v-if="pending && !generations.length" />

      <!-- Error -->
      <div v-else-if="error" class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm max-w-lg mx-auto">
        Failed to load gallery. <button class="underline" @click="refresh()">Retry</button>
      </div>

      <!-- Empty -->
      <div v-else-if="!generations.length" class="flex items-center justify-center min-h-[50vh]">
        <div class="text-center">
          <div class="w-20 h-20 mx-auto rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-4">
            <UIcon name="i-lucide-image" class="w-10 h-10 text-violet-300" />
          </div>
          <p class="text-slate-500 text-sm mb-1">Your gallery is empty</p>
          <UButton to="/create" size="sm">Create something</UButton>
        </div>
      </div>

      <!-- No results -->
      <div v-else-if="filteredMedia.length === 0" class="flex items-center justify-center min-h-[30vh]">
        <div class="text-center">
          <UIcon name="i-lucide-search" class="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p class="text-slate-500 text-sm">No results</p>
          <button class="text-violet-500 text-xs mt-1 hover:underline" @click="searchQuery = ''; typeFilter = 'all'">Clear filters</button>
        </div>
      </div>

      <!-- Grid -->
      <div v-else :class="['grid gap-1.5', largeGrid ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6']">
        <div
          v-for="(item, index) in filteredMedia" :key="item.id"
          class="group relative aspect-square rounded-xl overflow-hidden cursor-pointer border border-slate-200 hover:border-violet-300 transition-all hover:shadow-lg"
          @click="openLightbox(index)"
        >
          <video v-if="item.type === 'video'" :src="item.url + '#t=0.1'" muted preload="none" class="w-full h-full object-cover" @mouseenter="($event.target as HTMLVideoElement).play()" @mouseleave="($event.target as HTMLVideoElement).pause()" />
          <NuxtImg v-else :src="item.url" :alt="item.prompt" :width="largeGrid ? 512 : 300" class="w-full h-full object-cover" loading="lazy" />

          <!-- Video badge -->
          <div v-if="item.type === 'video'" class="absolute top-2.5 left-2.5 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm text-white text-xs flex items-center gap-1">
            <UIcon name="i-lucide-play" class="w-3.5 h-3.5" /> Video
          </div>

          <!-- Hover overlay -->
          <div class="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div class="absolute bottom-0 left-0 right-0 p-3">
              <p class="text-white text-xs line-clamp-2 leading-relaxed">{{ item.prompt }}</p>
              <p class="text-white/50 text-[10px] mt-0.5">{{ formatDate(item.createdAt) }}</p>
            </div>
          </div>

          <!-- Download on hover -->
          <div class="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-download" @click.stop="downloadMedia(item.url, item.type)" />
          </div>
        </div>
      </div>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinelRef" class="flex justify-center mt-6 py-4">
        <div v-if="loadingMore" class="flex items-center gap-2 text-sm text-slate-400">
          <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" /> Loading more…
        </div>
        <UButton v-else-if="hasMore" variant="ghost" size="xs" color="neutral" @click="loadMore()">
          {{ generations.length }} of {{ total }} loaded
        </UButton>
        <span v-else-if="generations.length > 0" class="text-xs text-slate-300">All {{ total }} generations loaded</span>
      </div>
    </div>

    <!-- Lightbox -->
    <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="filteredMedia">
      <template #toolbar="{ item }">
        <UButton variant="ghost" size="sm" icon="i-lucide-sparkles" class="text-white/60 hover:text-white" :loading="actionLoading[`upscale-${item.id}`]" @click="upscaleImage(item.id)">Enhance</UButton>
        <template v-if="item.type === 'image'">
          <UButton variant="ghost" size="sm" icon="i-lucide-image-plus" class="text-white/60 hover:text-white" @click="goToReimagine(item.id)">Reimagine</UButton>
          <UButton variant="ghost" size="sm" icon="i-lucide-film" class="text-white/60 hover:text-white" @click="goToVideo(item.id)">Video</UButton>
        </template>
        <UButton variant="ghost" size="sm" icon="i-lucide-info" class="text-white/60 hover:text-white" @click="showInfo = !showInfo">Info</UButton>
      </template>

      <template #panel>
        <Transition name="fade">
          <div v-if="showInfo && currentItem" class="absolute bottom-18 left-1/2 -translate-x-1/2 w-[440px] max-h-80 overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md p-5 text-sm text-white/80 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs uppercase tracking-wider text-white/50 font-medium">Info</span>
              <button class="text-white/40 hover:text-white text-xs" @click="showInfo = false">✕</button>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] text-white/40 uppercase tracking-wider">Prompt</span>
                <button class="text-[10px] text-white/40 hover:text-white flex items-center gap-1" @click="copyPrompt(currentItem.prompt)">
                  <UIcon name="i-lucide-clipboard-copy" class="w-3 h-3" /> Copy
                </button>
              </div>
              <p class="text-xs text-white/80 leading-relaxed">{{ currentItem.prompt }}</p>
            </div>
            <div v-if="currentItem.settings" class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t border-white/10 pt-3">
              <span class="text-white/40">Dimensions</span><span>{{ currentItem.settings.width }} × {{ currentItem.settings.height }}</span>
              <span class="text-white/40">Steps</span><span>{{ currentItem.settings.steps }}</span>
              <span class="text-white/40">Created</span><span>{{ formatDate(currentItem.createdAt) }}</span>
            </div>
          </div>
        </Transition>
      </template>
    </AppLightbox>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
