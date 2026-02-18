<script setup lang="ts">
import type { GenerationResult, MediaItemResult } from '~/types/gallery'
import { formatDate } from '~/composables/useGallery'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Gallery' })

const { generations, pending, error, refresh } = useGallery()
const { runpodEndpoint } = useAppSettings()

// ─── View modes ────────────────────────────────────────────────────────
type ViewMode = 'grid' | 'grouped'
const viewMode = ref<ViewMode>('grouped')
const searchQuery = ref('')
const sortOrder = ref<'newest' | 'oldest'>('newest')

// ─── Flattened media across all generations ─────────────────────────────
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
}

const allMedia = computed<GalleryMedia[]>(() => {
  const result: GalleryMedia[] = []
  const gens = generations.value || []
  for (const gen of gens) {
    let settings: Record<string, any> | null = null
    if (gen.settings) {
      try { settings = JSON.parse(gen.settings) } catch {}
    }
    for (const item of gen.items) {
      if ((item.type === 'image' || item.type === 'video') && item.url && item.status === 'complete') {
        result.push({
          id: item.id,
          url: item.url,
          generationId: gen.id,
          prompt: gen.prompt,
          settings,
          createdAt: gen.createdAt,
          imageCount: gen.imageCount,
          type: item.type,
          status: item.status,
        })
      }
    }
  }
  return result
})

// ─── Filter & sort ─────────────────────────────────────────────────────
const filteredMedia = computed(() => {
  let items = allMedia.value
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    items = items.filter(i => i.prompt.toLowerCase().includes(q))
  }
  if (sortOrder.value === 'oldest') {
    items = [...items].reverse()
  }
  return items
})

const filteredGenerations = computed(() => {
  let gens = generations.value || []
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    gens = gens.filter(g => g.prompt.toLowerCase().includes(q))
  }
  if (sortOrder.value === 'oldest') {
    gens = [...gens].reverse()
  }
  return gens
})

// ─── Lightbox state ────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const showLightboxInfo = ref(false)

const currentItem = computed(() => filteredMedia.value[lightboxIndex.value] ?? null)

function openLightbox(index: number) {
  lightboxIndex.value = index
  lightboxOpen.value = true
  showLightboxInfo.value = false
}

function closeLightbox() {
  lightboxOpen.value = false
}

function lightboxNext() {
  if (lightboxIndex.value < filteredMedia.value.length - 1) lightboxIndex.value++
}

function lightboxPrev() {
  if (lightboxIndex.value > 0) lightboxIndex.value--
}

function handleKeydown(e: KeyboardEvent) {
  if (!lightboxOpen.value) return
  if (e.key === 'ArrowRight') lightboxNext()
  else if (e.key === 'ArrowLeft') lightboxPrev()
  else if (e.key === 'Escape') closeLightbox()
  else if (e.key === 'i' || e.key === 'I') showLightboxInfo.value = !showLightboxInfo.value
}

onMounted(() => {
  if (import.meta.client) window.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  if (import.meta.client) window.removeEventListener('keydown', handleKeydown)
})

// ─── Image actions ─────────────────────────────────────────────────────
function downloadMedia(url: string, index: number, type: string = 'image') {
  const ext = type === 'video' ? 'mp4' : 'png'
  const a = document.createElement('a')
  a.href = url
  a.download = `gallery-${index + 1}.${ext}`
  a.click()
}

function copyPrompt(text: string) {
  navigator.clipboard.writeText(text)
}

// ─── Grouped view: expand/collapse generations ─────────────────────────
// Auto-expand all generations by default
const expandedGenerations = ref<Set<string>>(new Set())
watch(() => generations.value, (gens) => {
  if (gens?.length) {
    for (const g of gens) expandedGenerations.value.add(g.id)
  }
}, { immediate: true })

function toggleGeneration(id: string) {
  if (expandedGenerations.value.has(id)) {
    expandedGenerations.value.delete(id)
  } else {
    expandedGenerations.value.add(id)
  }
}

function generationMedia(gen: GenerationResult): MediaItemResult[] {
  return gen.items.filter(i => (i.type === 'image' || i.type === 'video') && i.url && i.status === 'complete')
}

// ─── Stats ─────────────────────────────────────────────────────────────
const totalMedia = computed(() => allMedia.value.length)
const totalGenerations = computed(() => (generations.value || []).length)

// ─── Navigate to create with settings ──────────────────────────────────
function recreateFromImage(img: GalleryMedia) {
  const query: Record<string, string> = { prompt: img.prompt }
  if (img.settings) {
    query.settings = JSON.stringify(img.settings)
  }
  navigateTo({ path: '/create', query })
}

// ─── Video generation from gallery ──────────────────────────────────────
const actionLoading = ref<Record<string, boolean>>({})
const videoProcessingItems = ref<Array<{ id: string; mediaItemId: string; status: string }>>([])
const videoError = ref('')

async function makeVideoFromGallery(mediaItemId: string, settings?: Record<string, any> | null) {
  const loadingKey = `video-${mediaItemId}`
  if (actionLoading.value[loadingKey]) return
  actionLoading.value[loadingKey] = true
  videoError.value = ''

  try {
    const result = await $fetch<{ item: { id: string; status: string } }>('/api/generate/video', {
      method: 'POST',
      body: {
        mediaItemId,
        numFrames: 81,
        steps: settings?.steps || 20,
        cfg: 3.5,
        width: settings?.width || 768,
        height: settings?.height || 768,
        endpoint: runpodEndpoint.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result.item) {
      videoProcessingItems.value.push({
        id: result.item.id,
        mediaItemId,
        status: result.item.status,
      })

      if (result.item.status === 'processing') {
        pollVideoStatus(result.item.id, loadingKey)
      } else {
        actionLoading.value[loadingKey] = false
      }
    }
  } catch (e: any) {
    videoError.value = e.data?.message || 'Video generation failed'
    actionLoading.value[loadingKey] = false
  }
}

async function pollVideoStatus(itemId: string, loadingKey: string) {
  const maxAttempts = 120
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const result = await $fetch<{ item: { id: string; status: string } }>(`/api/generate/status/${itemId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

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

// ─── Grid class based on image count ───────────────────────────────────
const gridClass = computed(() => {
  if (filteredMedia.value.length <= 2) return 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto'
  if (filteredMedia.value.length <= 4) return 'grid-cols-2 lg:grid-cols-4'
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
})
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
          <span><span class="font-medium text-slate-600">{{ totalGenerations }}</span> generations</span>
        </div>

        <div class="flex-1" />

        <!-- Search -->
        <div class="relative">
          <UIcon name="i-heroicons-magnifying-glass" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search prompts…"
            class="bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 w-48 lg:w-64"
          />
        </div>

        <!-- Sort -->
        <select
          v-model="sortOrder"
          class="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 focus:outline-none cursor-pointer appearance-none"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>

        <!-- View toggle -->
        <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          <button
            class="px-2.5 py-1 rounded text-xs font-medium transition-all"
            :class="viewMode === 'grid' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
            @click="viewMode = 'grid'"
          >
            <UIcon name="i-heroicons-squares-2x2" class="w-3.5 h-3.5" />
          </button>
          <button
            class="px-2.5 py-1 rounded text-xs font-medium transition-all"
            :class="viewMode === 'grouped' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
            @click="viewMode = 'grouped'"
          >
            <UIcon name="i-heroicons-list-bullet" class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Refresh -->
        <button
          class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          :class="{ 'animate-spin': pending }"
          @click="refresh()"
        >
          <UIcon name="i-heroicons-arrow-path" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- ═══ Body ═══ -->
    <div class="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <!-- Video generation progress -->
      <div v-if="activeVideoCount > 0" class="mb-4 p-3 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center gap-3">
        <div class="w-5 h-5 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
        <div class="flex-1">
          <p class="text-sm text-cyan-800 font-medium">
            Generating {{ activeVideoCount }} video{{ activeVideoCount !== 1 ? 's' : '' }}…
          </p>
          <p class="text-xs text-cyan-600">Videos will appear in the gallery when complete. This may take a few minutes.</p>
        </div>
      </div>

      <!-- Video generation error -->
      <div v-if="videoError" class="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm flex items-center gap-3">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-4 h-4 shrink-0" />
        {{ videoError }}
        <button class="ml-auto text-red-400 hover:text-red-600 text-xs" @click="videoError = ''">
          <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
        </button>
      </div>

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
            <UIcon name="i-heroicons-photo" class="w-10 h-10 text-violet-300" />
          </div>
          <p class="text-slate-500 text-sm mb-1">Your gallery is empty</p>
          <p class="text-slate-400 text-xs mb-4">Generate some images to see them here</p>
          <UButton to="/create" size="sm">Create something</UButton>
        </div>
      </div>

      <!-- No search results -->
      <div v-else-if="searchQuery && filteredMedia.length === 0" class="flex items-center justify-center min-h-[30vh]">
        <div class="text-center">
          <UIcon name="i-heroicons-magnifying-glass" class="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p class="text-slate-500 text-sm">No results match "{{ searchQuery }}"</p>
          <button class="text-violet-500 text-xs mt-1 hover:underline" @click="searchQuery = ''">Clear search</button>
        </div>
      </div>

      <!-- ═══ Grid View — Flat image grid ═══ -->
      <div v-else-if="viewMode === 'grid'">
        <div :class="['grid gap-2', gridClass]">
          <div
            v-for="(item, index) in filteredMedia"
            :key="item.id"
            class="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-slate-200 hover:border-violet-300 transition-all shadow-sm hover:shadow-md"
            @click="openLightbox(index)"
          >
            <video
              v-if="item.type === 'video'"
              :src="item.url"
              muted
              loop
              preload="metadata"
              class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              @mouseenter="($event.target as HTMLVideoElement).play()"
              @mouseleave="($event.target as HTMLVideoElement).pause()"
            />
            <NuxtImg
              v-else
              :src="item.url"
              :alt="item.prompt"
              width="400"
              class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />

            <!-- Video badge -->
            <div v-if="item.type === 'video'" class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px] flex items-center gap-1 backdrop-blur-sm">
              <UIcon name="i-heroicons-play" class="w-3 h-3" /> Video
            </div>

            <!-- Hover overlay -->
            <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div class="absolute bottom-0 left-0 right-0 p-2.5 pointer-events-none">
                <p class="text-white text-[10px] line-clamp-2 leading-relaxed">{{ item.prompt }}</p>
                <p class="text-white/50 text-[9px] mt-0.5">{{ formatDate(item.createdAt) }}</p>
              </div>
            </div>
            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                v-if="item.type === 'image'"
                class="p-1.5 rounded-lg bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-all"
                :class="{ 'opacity-50 pointer-events-none': actionLoading[`video-${item.id}`] }"
                title="Create video"
                @click.stop="makeVideoFromGallery(item.id, item.settings)"
              >
                <UIcon v-if="actionLoading[`video-${item.id}`]" name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" />
                <UIcon v-else name="i-heroicons-film" class="w-3.5 h-3.5" />
              </button>
              <button
                class="p-1.5 rounded-lg bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-all"
                title="Download"
                @click.stop="downloadMedia(item.url, index, item.type)"
              >
                <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Grouped View — By generation ═══ -->
      <div v-else class="space-y-4">
        <div v-for="gen in filteredGenerations" :key="gen.id" class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <!-- Generation header (collapsible) -->
          <button
            class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
            @click="toggleGeneration(gen.id)"
          >
            <!-- Thumbnail preview -->
            <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-slate-200">
              <video
                v-if="generationMedia(gen)[0]?.type === 'video' && generationMedia(gen)[0]?.url"
                :src="generationMedia(gen)[0]!.url!"
                muted
                preload="metadata"
                class="w-full h-full object-cover"
              />
              <NuxtImg
                v-else-if="generationMedia(gen)[0]?.url"
                :src="generationMedia(gen)[0]!.url!"
                alt=""
                width="80"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full bg-slate-100" />
            </div>

            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-700 line-clamp-1">{{ gen.prompt }}</p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[10px] text-slate-400">{{ formatDate(gen.createdAt) }}</span>
                <span class="text-[10px] text-slate-300">·</span>
                <span class="text-[10px] text-slate-400">{{ generationMedia(gen).length }} item{{ generationMedia(gen).length !== 1 ? 's' : '' }}</span>
                <UBadge
                  v-if="gen.status !== 'complete'"
                  :color="gen.status === 'processing' ? 'warning' : 'error'"
                  variant="subtle"
                  size="xs"
                >{{ gen.status }}</UBadge>
              </div>
            </div>

            <UIcon
              :name="expandedGenerations.has(gen.id) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
              class="w-4 h-4 text-slate-400 shrink-0"
            />
          </button>

          <!-- Expanded images -->
          <div v-if="expandedGenerations.has(gen.id)" class="px-4 pb-3 border-t border-slate-100">
            <!-- Settings info -->
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
              <div
                v-for="item in generationMedia(gen)"
                :key="item.id"
                class="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-slate-200 hover:border-violet-300 transition-all"
                @click="openLightbox(filteredMedia.findIndex(i => i.id === item.id))"
              >
                <video
                  v-if="item.type === 'video'"
                  :src="item.url!"
                  muted
                  loop
                  preload="metadata"
                  class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  @mouseenter="($event.target as HTMLVideoElement).play()"
                  @mouseleave="($event.target as HTMLVideoElement).pause()"
                />
                <NuxtImg
                  v-else
                  :src="item.url!"
                  alt=""
                  width="300"
                  class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                <!-- Video badge -->
                <div v-if="item.type === 'video'" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/50 text-white text-[9px] flex items-center gap-0.5 backdrop-blur-sm">
                  <UIcon name="i-heroicons-play" class="w-2.5 h-2.5" /> Video
                </div>
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                <div class="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    v-if="item.type === 'image'"
                    class="p-1 rounded bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-all"
                    :class="{ 'opacity-50 pointer-events-none': actionLoading[`video-${item.id}`] }"
                    title="Create video"
                    @click.stop="makeVideoFromGallery(item.id, parseSettings(gen.settings))"
                  >
                    <UIcon v-if="actionLoading[`video-${item.id}`]" name="i-heroicons-arrow-path" class="w-3 h-3 animate-spin" />
                    <UIcon v-else name="i-heroicons-film" class="w-3 h-3" />
                  </button>
                  <button
                    class="p-1 rounded bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-all"
                    title="Download"
                    @click.stop="downloadMedia(item.url!, 0, item.type)"
                  >
                    <UIcon name="i-heroicons-arrow-down-tray" class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Actions row -->
            <div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
              <button class="text-[10px] text-slate-400 hover:text-violet-600 transition-colors flex items-center gap-0.5" @click="copyPrompt(gen.prompt)">
                📋 Copy prompt
              </button>
              <button class="text-[10px] text-slate-400 hover:text-violet-600 transition-colors flex items-center gap-0.5" @click="navigateTo({ path: '/create', query: { prompt: gen.prompt } })">
                🔄 Recreate
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         LIGHTBOX — Full-screen with keyboard navigation
         ══════════════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="lightboxOpen && currentItem"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md"
          @click.self="closeLightbox"
        >
          <!-- Close -->
          <button
            class="absolute top-4 right-4 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all z-10"
            @click="closeLightbox"
          >
            <UIcon name="i-heroicons-x-mark" class="w-6 h-6" />
          </button>

          <!-- Counter -->
          <div class="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-xs font-mono backdrop-blur-sm">
            {{ lightboxIndex + 1 }} / {{ filteredMedia.length }}
          </div>

          <!-- Prev arrow -->
          <button
            v-if="lightboxIndex > 0"
            class="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
            @click="lightboxPrev"
          >
            <UIcon name="i-heroicons-chevron-left" class="w-8 h-8" />
          </button>

          <!-- Next arrow -->
          <button
            v-if="lightboxIndex < filteredMedia.length - 1"
            class="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
            @click="lightboxNext"
          >
            <UIcon name="i-heroicons-chevron-right" class="w-8 h-8" />
          </button>

          <!-- Media (image or video) -->
          <div class="max-w-[90vw] max-h-[85vh] relative">
            <video
              v-if="currentItem.type === 'video'"
              :src="currentItem.url"
              :key="currentItem.id"
              controls
              autoplay
              loop
              class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <img
              v-else
              :src="currentItem.url"
              :key="currentItem.id"
              alt="Generated image"
              class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
          </div>

          <!-- Bottom toolbar -->
          <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white/10 backdrop-blur-md">
            <button
              class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
              @click="downloadMedia(currentItem.url, lightboxIndex, currentItem.type)"
            >
              <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5" /> Download
            </button>
            <button
              class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
              @click="copyPrompt(currentItem.prompt)"
            >
              <UIcon name="i-heroicons-clipboard-document" class="w-3.5 h-3.5" /> Prompt
            </button>
            <template v-if="currentItem.type === 'image'">
              <button
                class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5"
                :class="actionLoading[`video-${currentItem.id}`]
                  ? 'opacity-50 pointer-events-none text-white/30'
                  : 'text-white/60 hover:text-white hover:bg-white/10'"
                @click="makeVideoFromGallery(currentItem.id, currentItem.settings)"
              >
                <UIcon v-if="actionLoading[`video-${currentItem.id}`]" name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" />
                <UIcon v-else name="i-heroicons-film" class="w-3.5 h-3.5" />
                Video
              </button>
            </template>
            <button
              class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
              @click="showLightboxInfo = !showLightboxInfo"
            >
              <UIcon name="i-heroicons-information-circle" class="w-3.5 h-3.5" /> Info
            </button>
            <button
              class="px-3 py-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
              @click="recreateFromImage(currentItem)"
            >
              <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5" /> Recreate
            </button>
          </div>

          <!-- Info panel -->
          <Transition name="fade">
            <div v-if="showLightboxInfo" class="absolute bottom-16 left-1/2 -translate-x-1/2 w-[440px] max-h-[350px] overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md p-4 text-sm text-white/80 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wider text-white/50 font-medium">Generation Info</span>
                <button class="text-white/40 hover:text-white text-xs" @click="showLightboxInfo = false">✕</button>
              </div>

              <!-- Type -->
              <div v-if="currentItem.type === 'video'" class="flex items-center gap-1.5">
                <UIcon name="i-heroicons-film" class="w-3.5 h-3.5 text-violet-400" />
                <span class="text-xs text-violet-400 font-medium">Video</span>
              </div>

              <!-- Prompt -->
              <div>
                <span class="text-[10px] text-white/40 uppercase tracking-wider">Prompt</span>
                <p class="text-xs text-white/80 mt-0.5 leading-relaxed">{{ currentItem.prompt }}</p>
              </div>

              <!-- Settings -->
              <div v-if="currentItem.settings" class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span class="text-white/40">Dimensions</span>
                <span>{{ currentItem.settings.width }} × {{ currentItem.settings.height }}</span>
                <span class="text-white/40">Steps</span>
                <span>{{ currentItem.settings.steps }}</span>
                <span class="text-white/40">Created</span>
                <span>{{ new Date(currentItem.createdAt).toLocaleString() }}</span>
                <template v-if="currentItem.settings.negativePrompt">
                  <span class="text-white/40">Neg. prompt</span>
                  <span class="text-white/60 line-clamp-2" :title="currentItem.settings.negativePrompt">{{ currentItem.settings.negativePrompt }}</span>
                </template>
              </div>

              <!-- Attributes -->
              <div v-if="currentItem.settings?.attributes && Object.keys(currentItem.settings.attributes).length > 0" class="border-t border-white/10 pt-2">
                <span class="text-[10px] text-white/40 uppercase tracking-wider">Attributes</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  <span v-for="(val, key) in currentItem.settings.attributes" :key="String(key)" class="px-2 py-0.5 rounded-full bg-white/10 text-[10px]">{{ key }}: {{ val }}</span>
                </div>
              </div>

              <!-- Keyboard shortcuts -->
              <div class="border-t border-white/10 pt-2 flex items-center gap-3 text-[10px] text-white/30">
                <span>← → Navigate</span>
                <span>I Toggle info</span>
                <span>Esc Close</span>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script lang="ts">
/** Parse generation settings JSON safely */
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
