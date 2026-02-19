<script setup lang="ts">
import type { GenerationResult } from '~/types/gallery'

definePageMeta({ layout: false })
useSeoMeta({ title: 'Feed' })

// ─── Data ────────────────────────────────────────────────────
interface FeedVideo {
  id: string
  url: string
  prompt: string
  createdAt: string
}

const videos = ref<FeedVideo[]>([])
const loading = ref(true)

async function fetchVideos() {
  try {
    const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
      params: { limit: 200, offset: 0 },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    videos.value = result.generations
      .flatMap(g => g.items
        .filter(i => i.type === 'video' && i.url && i.status === 'complete')
        .map(i => ({
          id: i.id,
          url: i.url!,
          prompt: g.prompt,
          createdAt: g.createdAt,
        }))
      )
  } catch (e) {
    console.error('Failed to fetch videos:', e)
  } finally {
    loading.value = false
  }
}

// Auto-refresh: poll every 30s and merge new videos in
let pollTimer: ReturnType<typeof setInterval> | null = null

async function refreshVideos() {
  try {
    const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
      params: { limit: 200, offset: 0 },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    const fresh = result.generations
      .flatMap(g => g.items
        .filter(i => i.type === 'video' && i.url && i.status === 'complete')
        .map(i => ({
          id: i.id,
          url: i.url!,
          prompt: g.prompt,
          createdAt: g.createdAt,
        }))
      )

    // Merge: add any new IDs without disrupting existing list
    const existingIds = new Set(videos.value.map(v => v.id))
    const newVideos = fresh.filter(v => !existingIds.has(v.id))
    if (newVideos.length > 0) {
      videos.value = [...newVideos, ...videos.value]
      console.log(`[Feed] +${newVideos.length} new videos`)
    }
  } catch {}
}

if (import.meta.client) {
  fetchVideos()
  pollTimer = setInterval(refreshVideos, 30_000)
}

// ─── Reactive state ──────────────────────────────────────────
const currentIndex = ref(0)
const muted = ref(true)
const paused = ref(false)
const progress = ref(0)
const showPauseIndicator = ref(false)

// ─── Element refs ────────────────────────────────────────────
const containerRef = ref<HTMLElement | null>(null)
const videoElements = new Map<number, HTMLVideoElement>()

function setVideoEl(el: any, index: number) {
  if (el instanceof HTMLVideoElement) {
    videoElements.set(index, el)
  }
}

// ─── IntersectionObserver (auto-play visible, pause hidden) ──
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement
        const idx = Number(video.dataset.index)
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          currentIndex.value = idx
          paused.value = false
          video.currentTime = 0
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      }
    },
    { threshold: 0.6 }
  )

  // Observe any already-rendered videos
  for (const [, el] of videoElements) {
    observer.observe(el)
  }
})

// Watch for new videos being added (after fetch completes)
watch(videos, () => {
  nextTick(() => {
    if (!observer) return
    for (const [, el] of videoElements) {
      observer.observe(el)
    }
  })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (progressRaf) cancelAnimationFrame(progressRaf)
  if (pollTimer) clearInterval(pollTimer)
})

// After a video element mounts, observe it
function onVideoMounted(el: any, index: number) {
  setVideoEl(el, index)
  if (el instanceof HTMLVideoElement && observer) {
    observer.observe(el)
  }
}

// Videos loop automatically via the `loop` attribute on <video>.
// User swipes up to go to the next video.

// ─── Tap vs swipe detection ──────────────────────────────────
// On mobile, we need to distinguish taps (pause/play) from swipes (scroll)
let touchStartY = 0
let touchStartX = 0
let touchStartTime = 0

function onTouchStart(e: TouchEvent) {
  const touch = e.touches[0]
  touchStartY = touch.clientY
  touchStartX = touch.clientX
  touchStartTime = Date.now()
}

function onTouchEnd(e: TouchEvent, index: number) {
  const touch = e.changedTouches[0]
  const deltaY = Math.abs(touch.clientY - touchStartY)
  const deltaX = Math.abs(touch.clientX - touchStartX)
  const elapsed = Date.now() - touchStartTime

  // It's a tap if: short time, small movement
  if (elapsed < 300 && deltaY < 15 && deltaX < 15) {
    togglePlayPause(index)
  }
}

function togglePlayPause(index: number) {
  const video = videoElements.get(index)
  if (!video) return

  if (video.paused) {
    video.play().catch(() => {})
    paused.value = false
  } else {
    video.pause()
    paused.value = true
  }

  // Flash the pause/play indicator
  showPauseIndicator.value = true
  setTimeout(() => { showPauseIndicator.value = false }, 600)
}

// ─── Desktop click handler (no touch events) ─────────────────
function onVideoClick(index: number) {
  // Only handle on desktop — mobile uses touch events
  if ('ontouchstart' in window) return
  togglePlayPause(index)
}

// ─── Mute toggle ─────────────────────────────────────────────
function toggleMute(e: Event) {
  e.stopPropagation()
  muted.value = !muted.value
}

// ─── Progress bar ────────────────────────────────────────────
let progressRaf: number | null = null

function tickProgress() {
  const video = videoElements.get(currentIndex.value)
  if (video && video.duration && !isNaN(video.duration)) {
    progress.value = (video.currentTime / video.duration) * 100
  }
  progressRaf = requestAnimationFrame(tickProgress)
}

onMounted(() => {
  progressRaf = requestAnimationFrame(tickProgress)
})

// ─── Share ───────────────────────────────────────────────────
function shareVideo(video: FeedVideo) {
  if (navigator.share) {
    navigator.share({
      title: 'AI Generated Video',
      text: video.prompt,
      url: video.url,
    }).catch(() => {})
  }
}

// ─── Time formatting ─────────────────────────────────────────
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
</script>

<template>
  <div class="feed-root">
    <div class="feed-container" ref="containerRef">
      <!-- Loading -->
      <div v-if="loading && !videos.length" class="feed-slide feed-center">
        <div class="flex flex-col items-center gap-4">
          <div class="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <p class="text-white/60 text-sm">Loading videos...</p>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!loading && !videos.length" class="feed-slide feed-center">
        <div class="flex flex-col items-center gap-4 px-8 text-center">
          <div class="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <p class="text-white text-lg font-semibold">No videos yet</p>
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
        @touchstart.passive="onTouchStart"
        @touchend="onTouchEnd($event, index)"
      >
        <video
          :ref="(el) => onVideoMounted(el, index)"
          :src="video.url + '#t=0.1'"
          :data-index="index"
          :muted="muted"
          loop
          playsinline
          webkit-playsinline
          preload="metadata"
          class="feed-video"
          @click="onVideoClick(index)"
        />

        <!-- Pause/Play indicator (flash on tap) -->
        <Transition name="pop">
          <div
            v-if="showPauseIndicator && currentIndex === index"
            class="feed-indicator"
          >
            <svg v-if="paused" width="40" height="40" viewBox="0 0 24 24" fill="white">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
            <svg v-else width="40" height="40" viewBox="0 0 24 24" fill="white">
              <rect x="5" y="3" width="4" height="18" rx="1" />
              <rect x="15" y="3" width="4" height="18" rx="1" />
            </svg>
          </div>
        </Transition>

        <!-- Progress bar -->
        <div v-if="currentIndex === index" class="feed-progress">
          <div class="feed-progress-bar" :style="{ width: progress + '%' }" />
        </div>

        <!-- Top bar -->
        <div class="feed-top">
          <NuxtLink to="/gallery" class="feed-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </NuxtLink>

          <button class="feed-btn" @click="toggleMute">
            <!-- Muted icon -->
            <svg v-if="muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
            <!-- Unmuted icon -->
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
        </div>

        <!-- Bottom overlay -->
        <div class="feed-bottom">
          <div class="feed-gradient-overlay">
            <p class="text-white text-sm leading-relaxed mb-2 feed-prompt">
              {{ video.prompt }}
            </p>
            <div class="flex items-center justify-between">
              <span class="text-white/40 text-xs tabular-nums">{{ index + 1 }}/{{ videos.length }}</span>
              <span class="text-white/40 text-xs">{{ formatTime(video.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Right action bar -->
        <div class="feed-actions">
          <a :href="video.url" download class="feed-btn" @click.stop>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
          <button class="feed-btn" @click.stop="shareVideo(video)">
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
  </div>
</template>

<style scoped>
/* ─── Root: lock the page ─────────────────────────────────── */
.feed-root {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 9999;
  /* Prevent iOS bounce / overscroll */
  overscroll-behavior: none;
  /* Disable text selection */
  user-select: none;
  -webkit-user-select: none;
  /* Prevent double-tap zoom */
  touch-action: manipulation;
}

/* ─── Scroll container ────────────────────────────────────── */
.feed-container {
  height: 100%;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

/* Hide scrollbar */
.feed-container::-webkit-scrollbar { display: none; }
.feed-container { -ms-overflow-style: none; scrollbar-width: none; }

/* ─── Each slide ──────────────────────────────────────────── */
.feed-slide {
  height: 100dvh;
  height: 100vh; /* fallback */
  scroll-snap-align: start;
  scroll-snap-stop: always;
  position: relative;
  overflow: hidden;
  background: #000;
}

.feed-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ─── Video ───────────────────────────────────────────────── */
.feed-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* Prevent iOS from taking over native video player */
  -webkit-appearance: none;
}

/* ─── Pause/play flash indicator ──────────────────────────── */
.feed-indicator {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 15;
}

.feed-indicator > svg {
  padding: 20px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 50%;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* ─── Progress bar ────────────────────────────────────────── */
.feed-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  z-index: 25;
}

.feed-progress-bar {
  height: 100%;
  background: #fff;
  /* No transition so it tracks smoothly with rAF */
}

/* ─── Top bar ─────────────────────────────────────────────── */
.feed-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 12px 12px;
  padding-top: max(12px, env(safe-area-inset-top, 12px));
}

/* ─── Bottom overlay ──────────────────────────────────────── */
.feed-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 16px));
}

.feed-gradient-overlay {
  padding: 80px 16px 8px 16px;
  background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 50%, transparent 100%);
}

.feed-prompt {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-shadow: 0 1px 4px rgba(0,0,0,0.5);
}

/* ─── Right action bar ────────────────────────────────────── */
.feed-actions {
  position: absolute;
  right: 10px;
  bottom: 140px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-bottom: max(0px, env(safe-area-inset-bottom, 0px));
}

/* ─── Action buttons ──────────────────────────────────────── */
.feed-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.feed-btn:active {
  transform: scale(0.9);
  transition: transform 0.1s;
}

/* ─── Transitions ─────────────────────────────────────────── */
.pop-enter-active {
  animation: pop-in 0.2s ease-out;
}
.pop-leave-active {
  animation: pop-out 0.4s ease-in;
}

@keyframes pop-in {
  0% { opacity: 0; transform: scale(0.5); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes pop-out {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.5); }
}
</style>
