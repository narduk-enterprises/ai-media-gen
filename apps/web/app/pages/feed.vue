<script setup lang="ts">

definePageMeta({ layout: false })
useSeo({
  title: 'Feed',
  description: 'Infinite scroll feed of AI generated videos.'
})
useWebPageSchema()

// ─── Data ────────────────────────────────────────────────────
interface FeedVideo {
  id: string
  url: string
  prompt: string
  createdAt: string
}

const videos = ref<FeedVideo[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(true)

const PAGE_SIZE = 10

async function loadInitial() {
  try {
    const result = await $fetch<{ videos: FeedVideo[]; hasMore: boolean }>('/api/feed/videos', {
      params: { limit: PAGE_SIZE, offset: 0 },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    videos.value = result.videos
    hasMore.value = result.hasMore
  } catch (e) {
    console.error('Failed to fetch videos:', e)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const result = await $fetch<{ videos: FeedVideo[]; hasMore: boolean }>('/api/feed/videos', {
      params: { limit: PAGE_SIZE, offset: videos.value.length },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (result.videos.length > 0) {
      videos.value = [...videos.value, ...result.videos]
    }
    hasMore.value = result.hasMore
  } catch {} finally {
    loadingMore.value = false
  }
}

// ─── Pending new videos (non-disruptive) ─────────────────────
const pendingVideos = ref<FeedVideo[]>([])
const showNewBanner = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function refreshVideos() {
  try {
    const result = await $fetch<{ videos: FeedVideo[] }>('/api/feed/videos', {
      params: { limit: PAGE_SIZE, offset: 0 },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    const existingIds = new Set(videos.value.map(v => v.id))
    const pendingIds = new Set(pendingVideos.value.map(v => v.id))
    const newVideos = result.videos.filter(v => !existingIds.has(v.id) && !pendingIds.has(v.id))
    if (newVideos.length > 0) {
      // Don't inject — queue them and show the banner
      pendingVideos.value = [...newVideos, ...pendingVideos.value]
      showNewBanner.value = true
      console.log(`[Feed] +${newVideos.length} new videos queued (${pendingVideos.value.length} pending)`)
    }
  } catch {}
}

function loadPendingVideos() {
  if (pendingVideos.value.length === 0) return
  videos.value = [...pendingVideos.value, ...videos.value]
  pendingVideos.value = []
  showNewBanner.value = false
  // Scroll to top
  nextTick(() => scrollToSlide(0))
}

if (import.meta.client) {
  loadInitial()
  pollTimer = setInterval(refreshVideos, 30_000)
}

// ─── Reactive state ──────────────────────────────────────────
const currentIndex = ref(0)
const muted = ref(true)
const paused = ref(false)
const progress = ref(0)
const showPauseIndicator = ref(false)

// Load more when user gets within 3 videos of the end
watch(currentIndex, (idx) => {
  if (idx >= videos.value.length - 3) {
    loadMore()
  }
  // Dismiss swipe hint after first scroll
  if (idx > 0) showSwipeHint.value = false
})

// ─── Video error tracking ────────────────────────────────────
const erroredVideos = reactive(new Set<number>())

function onVideoError(index: number) {
  erroredVideos.add(index)
}

function retryVideo(index: number) {
  erroredVideos.delete(index)
  const el = videoElements.get(index)
  if (el) {
    el.load()
    el.play().catch(() => {})
  }
}

// ─── Swipe-up hint (first-time) ──────────────────────────────
const showSwipeHint = ref(true)
let swipeHintTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  swipeHintTimer = setTimeout(() => { showSwipeHint.value = false }, 4000)
})

// ─── Double-tap to copy prompt ───────────────────────────────
let lastTapTime = 0
const showCopiedIndicator = ref(false)

function handleDoubleTap(video: FeedVideo) {
  const now = Date.now()
  if (now - lastTapTime < 350) {
    // Double-tap detected — copy prompt
    navigator.clipboard?.writeText(video.prompt).then(() => {
      showCopiedIndicator.value = true
      setTimeout(() => { showCopiedIndicator.value = false }, 1200)
    }).catch(() => {})
  }
  lastTapTime = now
}

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
  if (swipeHintTimer) clearTimeout(swipeHintTimer)
  window.removeEventListener('keydown', onKeyDown)
})

// After a video element mounts, observe it
function onVideoMounted(el: any, index: number) {
  setVideoEl(el, index)
  if (el instanceof HTMLVideoElement && observer) {
    observer.observe(el)
  }
}

// ─── Tap vs swipe detection ──────────────────────────────────
let touchStartY = 0
let touchStartX = 0
let touchStartTime = 0

function onTouchStart(e: TouchEvent) {
  const touch = e.touches[0]!
  touchStartY = touch.clientY
  touchStartX = touch.clientX
  touchStartTime = Date.now()
}

function onTouchEnd(e: TouchEvent, index: number, video: FeedVideo) {
  const touch = e.changedTouches[0]!
  const deltaY = Math.abs(touch.clientY - touchStartY)
  const deltaX = Math.abs(touch.clientX - touchStartX)
  const elapsed = Date.now() - touchStartTime

  // It's a tap if: short time, small movement
  if (elapsed < 300 && deltaY < 15 && deltaX < 15) {
    handleDoubleTap(video)
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
function onVideoClick(index: number, video: FeedVideo) {
  // Only handle on desktop — mobile uses touch events
  if ('ontouchstart' in window) return
  handleDoubleTap(video)
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
  if (video && video.duration && !Number.isNaN(video.duration)) {
    progress.value = (video.currentTime / video.duration) * 100
  }
  progressRaf = requestAnimationFrame(tickProgress)
}

onMounted(() => {
  progressRaf = requestAnimationFrame(tickProgress)
  window.addEventListener('keydown', onKeyDown)
})

// ─── Keyboard navigation (desktop) ──────────────────────────
function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowRight': {
      e.preventDefault()
      const nextIdx = Math.min(currentIndex.value + 1, videos.value.length - 1)
      scrollToSlide(nextIdx)
      break
    }
    case 'ArrowUp':
    case 'ArrowLeft': {
      e.preventDefault()
      const prevIdx = Math.max(currentIndex.value - 1, 0)
      scrollToSlide(prevIdx)
      break
    }
    case ' ': {
      e.preventDefault()
      togglePlayPause(currentIndex.value)
      break
    }
    case 'm':
    case 'M': {
      e.preventDefault()
      muted.value = !muted.value
      break
    }
  }
}

function scrollToSlide(index: number) {
  const container = containerRef.value
  if (!container) return
  const slides = container.querySelectorAll('.feed-slide')
  slides[index]?.scrollIntoView({ behavior: 'smooth' })
}

// ─── Share (with desktop fallback) ───────────────────────────
const showShareToast = ref(false)

function shareVideo(video: FeedVideo, e: Event) {
  e.stopPropagation()
  if (navigator.share) {
    navigator.share({
      title: 'AI Generated Video',
      text: video.prompt,
      url: video.url,
    }).catch(() => {})
  } else {
    // Desktop fallback: copy URL to clipboard
    navigator.clipboard?.writeText(video.url).then(() => {
      showShareToast.value = true
      setTimeout(() => { showShareToast.value = false }, 2000)
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
        v-for="(video, index) in videos" :key="video.id || index"
        class="feed-slide"
        @touchstart.passive="onTouchStart"
        @touchend="onTouchEnd($event, index, video)"
      >
        <video
          :ref="(el: any) => onVideoMounted(el, index)"
          :src="video.url + '#t=0.1'"
          :data-index="index"
          :muted="muted"
          loop
          playsinline
          webkit-playsinline
          preload="metadata"
          class="feed-video"
          @click="onVideoClick(index, video)"
          @error="onVideoError(index)"
        />

        <!-- Video error state -->
        <div v-if="erroredVideos.has(index)" class="feed-error-overlay">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <p class="text-white/70 text-sm mt-3">Failed to load video</p>
          <button class="feed-retry-btn" @click.stop="retryVideo(index)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Retry
          </button>
        </div>

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

        <!-- "Prompt copied" indicator -->
        <Transition name="pop">
          <div v-if="showCopiedIndicator && currentIndex === index" class="feed-copied-indicator">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Prompt copied
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

        <!-- Swipe-up hint (first video only) -->
        <Transition name="fade-up">
          <div v-if="showSwipeHint && index === 0 && currentIndex === 0" class="feed-swipe-hint">
            <div class="swipe-hint-inner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="swipe-arrow">
                <polyline points="18 15 12 9 6 15" />
              </svg>
              <span>Swipe up for more</span>
            </div>
          </div>
        </Transition>

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
          <NuxtLink :to="`/post/${video.id}`" class="feed-btn" @click.stop>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </NuxtLink>
          <a :href="video.url" download class="feed-btn" @click.stop>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
          <button class="feed-btn" @click.stop="shareVideo(video, $event)">
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

    <!-- ─── New videos banner (floating pill) ─────────────────── -->
    <Transition name="slide-down">
      <button
        v-if="showNewBanner && pendingVideos.length > 0"
        class="feed-new-pill"
        @click="loadPendingVideos"
      >
        <span class="new-pill-dot" />
        {{ pendingVideos.length }} new video{{ pendingVideos.length > 1 ? 's' : '' }}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </Transition>

    <!-- ─── "URL copied" toast ────────────────────────────────── -->
    <Transition name="slide-down">
      <div v-if="showShareToast" class="feed-share-toast">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Video URL copied
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ─── Root: lock the page ─────────────────────────────────── */
.feed-root {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 9999;
  overscroll-behavior: none;
  user-select: none;
  -webkit-user-select: none;
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
  object-fit: contain;
  -webkit-appearance: none;
}

/* ─── Video error overlay ─────────────────────────────────── */
.feed-error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  z-index: 15;
}

.feed-retry-btn {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: background 0.15s;
}

.feed-retry-btn:hover {
  background: rgba(255, 255, 255, 0.25);
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

/* ─── "Prompt copied" indicator ───────────────────────────── */
.feed-copied-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: white;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  z-index: 16;
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

/* ─── Swipe-up hint ───────────────────────────────────────── */
.feed-swipe-hint {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;
}

.swipe-hint-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-weight: 500;
}

.swipe-arrow {
  animation: swipe-bounce 1.2s ease-in-out infinite;
}

@keyframes swipe-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
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

/* ─── New videos floating pill ────────────────────────────── */
.feed-new-pill {
  position: fixed;
  top: max(16px, env(safe-area-inset-top, 16px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: white;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  box-shadow: 0 4px 24px rgba(99, 102, 241, 0.4);
  animation: pill-pulse 2s ease-in-out infinite;
}

.feed-new-pill:active {
  transform: translateX(-50%) scale(0.95);
  transition: transform 0.1s;
}

.new-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a5f3fc;
  animation: dot-ping 1.5s ease-in-out infinite;
}

@keyframes pill-pulse {
  0%, 100% { box-shadow: 0 4px 24px rgba(99, 102, 241, 0.4); }
  50% { box-shadow: 0 4px 32px rgba(99, 102, 241, 0.6); }
}

@keyframes dot-ping {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.5); }
}

/* ─── Share toast ─────────────────────────────────────────── */
.feed-share-toast {
  position: fixed;
  bottom: max(32px, env(safe-area-inset-bottom, 32px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 9999px;
  background: rgba(16, 185, 129, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: white;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
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

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}
.slide-down-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-16px);
}
.slide-down-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-16px);
}

.fade-up-enter-active,
.fade-up-leave-active {
  transition: all 0.5s ease;
}
.fade-up-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
.fade-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
