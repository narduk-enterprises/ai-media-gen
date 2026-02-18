<script setup lang="ts">
import type { GenerationResult, MediaItemResult } from '~/types/gallery'

definePageMeta({ layout: false })
useSeoMeta({ title: 'Feed' })

// ─── Data ────────────────────────────────────────────────────
const videos = ref<{ id: string; url: string; prompt: string; createdAt: string }[]>([])
const loading = ref(true)
const hasMore = ref(true)
const PAGE_SIZE = 20

async function fetchVideos(offset = 0) {
  try {
    const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
      params: { limit: 100, offset },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    const newVideos = result.generations
      .flatMap(g => g.items
        .filter(i => i.type === 'video' && i.url && i.status === 'complete')
        .map(i => ({
          id: i.id,
          url: i.url!,
          prompt: g.prompt,
          createdAt: g.createdAt,
        }))
      )

    videos.value = [...videos.value, ...newVideos]
    hasMore.value = result.generations.length >= 100
  } catch (e) {
    console.error('Failed to fetch videos:', e)
  } finally {
    loading.value = false
  }
}

if (import.meta.client) {
  fetchVideos()
}

// ─── Current index & scroll-snap ─────────────────────────────
const currentIndex = ref(0)
const containerRef = ref<HTMLElement | null>(null)
const videoRefs = ref<HTMLVideoElement[]>([])

function setVideoRef(el: any, index: number) {
  if (el) videoRefs.value[index] = el
}

// ─── IntersectionObserver for auto-play ──────────────────────
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        const video = entry.target as HTMLVideoElement
        if (entry.isIntersecting) {
          currentIndex.value = Number(video.dataset.index)
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      })
    },
    { threshold: 0.6 }
  )
})

function observeVideo(el: any) {
  if (el && observer) {
    observer.observe(el)
  }
}

onBeforeUnmount(() => {
  observer?.disconnect()
})

// ─── Auto-advance ────────────────────────────────────────────
function onVideoEnded(index: number) {
  if (index < videos.value.length - 1) {
    const nextSlide = containerRef.value?.children[index + 1] as HTMLElement
    nextSlide?.scrollIntoView({ behavior: 'smooth' })
  }
}

// ─── Tap to pause/play ──────────────────────────────────────
const paused = ref(false)
let tapTimer: ReturnType<typeof setTimeout> | null = null

function handleTap(index: number) {
  const video = videoRefs.value[index]
  if (!video) return

  if (video.paused) {
    video.play().catch(() => {})
    paused.value = false
  } else {
    video.pause()
    paused.value = true
  }
}

// ─── UI state ────────────────────────────────────────────────
const showUI = ref(true)
const uiTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

function toggleUI() {
  showUI.value = !showUI.value
}

// ─── Mute toggle ─────────────────────────────────────────────
const muted = ref(true)

function toggleMute() {
  muted.value = !muted.value
}

// ─── Progress bar ────────────────────────────────────────────
const progress = ref(0)
let progressRaf: number | null = null

function updateProgress() {
  const video = videoRefs.value[currentIndex.value]
  if (video && video.duration) {
    progress.value = (video.currentTime / video.duration) * 100
  }
  progressRaf = requestAnimationFrame(updateProgress)
}

onMounted(() => {
  progressRaf = requestAnimationFrame(updateProgress)
})

onBeforeUnmount(() => {
  if (progressRaf) cancelAnimationFrame(progressRaf)
})
</script>

<template>
  <div class="feed-container" ref="containerRef">
    <!-- Loading state -->
    <div v-if="loading && !videos.length" class="feed-slide flex items-center justify-center bg-black">
      <div class="flex flex-col items-center gap-4">
        <div class="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        <p class="text-white/60 text-sm">Loading videos...</p>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!loading && !videos.length" class="feed-slide flex items-center justify-center bg-black">
      <div class="flex flex-col items-center gap-4 px-8 text-center">
        <div class="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
        <p class="text-white text-lg font-medium">No videos yet</p>
        <p class="text-white/50 text-sm">Generate some videos to see them here</p>
        <NuxtLink to="/create" class="mt-2 px-6 py-2.5 bg-white text-black text-sm font-semibold rounded-full">
          Create Video
        </NuxtLink>
      </div>
    </div>

    <!-- Video slides -->
    <div
      v-for="(video, index) in videos"
      :key="video.id"
      class="feed-slide"
    >
      <video
        :ref="(el) => { setVideoRef(el, index); observeVideo(el) }"
        :src="video.url"
        :data-index="index"
        :muted="muted"
        loop
        playsinline
        webkit-playsinline
        preload="auto"
        class="feed-video"
        @ended="onVideoEnded(index)"
        @click="handleTap(index)"
      />

      <!-- Pause indicator -->
      <Transition name="fade">
        <div
          v-if="paused && currentIndex === index"
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div class="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="none">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          </div>
        </div>
      </Transition>

      <!-- Top progress bar -->
      <div v-if="currentIndex === index" class="absolute top-0 left-0 right-0 h-0.5 bg-white/20 z-30">
        <div class="h-full bg-white transition-none" :style="{ width: progress + '%' }" />
      </div>

      <!-- Top bar: back + mute -->
      <div class="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <NuxtLink to="/gallery" class="w-10 h-10 rounded-full bg-black/30 backdrop-blur-md flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </NuxtLink>

        <button
          class="w-10 h-10 rounded-full bg-black/30 backdrop-blur-md flex items-center justify-center"
          @click.stop="toggleMute"
        >
          <svg v-if="muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
      </div>

      <!-- Bottom overlay: prompt + counter -->
      <div class="absolute bottom-0 left-0 right-0 z-20 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div class="feed-gradient px-4 pb-2 pt-24">
          <!-- Prompt text -->
          <p class="text-white text-sm leading-relaxed mb-3 line-clamp-3 drop-shadow-lg">
            {{ video.prompt }}
          </p>

          <!-- Counter + time -->
          <div class="flex items-center justify-between">
            <span class="text-white/50 text-xs">{{ index + 1 }} / {{ videos.length }}</span>
            <span class="text-white/50 text-xs">{{ formatTime(video.createdAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Right sidebar actions -->
      <div class="absolute right-3 bottom-36 z-20 flex flex-col items-center gap-5">
        <!-- Download -->
        <a
          :href="video.url"
          download
          class="feed-action-btn"
          @click.stop
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </a>

        <!-- Share -->
        <button class="feed-action-btn" @click.stop="shareVideo(video)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function shareVideo(video: { url: string; prompt: string }) {
  if (navigator.share) {
    navigator.share({
      title: 'AI Generated Video',
      text: video.prompt,
      url: video.url,
    }).catch(() => {})
  }
}
</script>

<style scoped>
.feed-container {
  height: 100dvh;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  background: #000;
}

.feed-slide {
  height: 100dvh;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  position: relative;
  overflow: hidden;
}

.feed-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.feed-gradient {
  background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 60%, transparent 100%);
}

.feed-action-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
}

.feed-action-btn:active {
  transform: scale(0.9);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Hide scrollbar */
.feed-container::-webkit-scrollbar {
  display: none;
}
.feed-container {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Safe area for notch */
@supports (padding: env(safe-area-inset-top)) {
  .feed-slide {
    padding-top: 0;
  }
}
</style>
