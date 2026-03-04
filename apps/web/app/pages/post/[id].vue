<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const postId = computed(() => String(route.params.id))

// ─── Fetch post data ─────────────────────────────────────────
interface PostData {
  id: string
  url: string | null
  type: string
  status: string
  qualityScore: number | null
  prompt: string
  generationPrompt: string
  settings: string | null
  metadata: string | null
  parentId: string | null
  parentImage: { id: string; url: string | null; type: string } | null
  createdAt: string
  generationId: string
  generationCreatedAt: string
  imageCount: number
}

interface SiblingItem {
  id: string
  url: string | null
  type: string
  status: string
  qualityScore: number | null
}

const { data, pending, error } = await useFetch<{ post: PostData; siblings: SiblingItem[] }>('/api/feed/post', {
  params: { id: postId },
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
  lazy: true,
})

const post = computed(() => data.value?.post ?? null)
const siblings = computed(() => data.value?.siblings ?? [])

useSeo({
  title: post.value ? `Post · ${post.value.prompt.slice(0, 50)}` : 'Post',
  description: post.value ? post.value.prompt : 'Viewing an AI generated post.'
})
useWebPageSchema()

// ─── Parse settings ─────────────────────────────────────────
interface ParsedSettings {
  negativePrompt?: string
  steps?: number
  width?: number
  height?: number
  cfg?: number
  attributes?: Record<string, string>
  [key: string]: unknown
}

const parsedSettings = computed<ParsedSettings | null>(() => {
  if (!post.value?.settings) return null
  try { return JSON.parse(post.value.settings) } catch { return null }
})

// ─── Time formatting ────────────────────────────────────────
function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatTime(dateStr)
}

// ─── Actions ────────────────────────────────────────────────
function downloadMedia() {
  if (!post.value?.url) return
  const ext = post.value.type === 'video' ? 'mp4' : 'png'
  const a = document.createElement('a')
  a.href = post.value.url
  a.download = `post-${post.value.id}.${ext}`
  a.click()
}

function sharePost() {
  if (!post.value) return
  if (navigator.share) {
    navigator.share({
      title: 'AI Generated Media',
      text: post.value.prompt,
      url: window.location.href,
    }).catch(() => {})
  }
}

function copyPrompt() {
  if (!post.value) return
  navigator.clipboard.writeText(post.value.prompt)
}

function getQualityScoreClass(score: number): string {
  if (score >= 7) return 'text-emerald-400'
  if (score >= 5) return 'text-amber-400'
  return 'text-red-400'
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-white">
    <!-- Loading -->
    <div v-if="pending && !post" class="flex items-center justify-center min-h-screen">
      <div class="flex flex-col items-center gap-4">
        <div class="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p class="text-white/40 text-sm">Loading post…</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen">
      <div class="text-center px-8">
        <div class="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-red-400">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p class="text-white/70 mb-2">Post not found</p>
        <NuxtLink to="/feed" class="text-sm text-violet-400 hover:text-violet-300">← Back to feed</NuxtLink>
      </div>
    </div>

    <!-- Post content -->
    <div v-else-if="post" class="max-w-4xl mx-auto px-4 py-6">
      <!-- Nav bar -->
      <div class="flex items-center justify-between mb-6">
        <NuxtLink to="/feed" class="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Feed
        </NuxtLink>
        <span class="text-white/20 text-xs tabular-nums">{{ relativeTime(post.createdAt) }}</span>
      </div>

      <!-- Media player -->
      <div class="relative rounded-2xl overflow-hidden bg-black border border-white/5 mb-6">
        <div class="aspect-video flex items-center justify-center bg-black">
          <video
            v-if="post.type === 'video' && post.url"
            :src="post.url"
            controls
            autoplay
            loop
            playsinline
            class="w-full h-full object-contain"
          />
          <img
            v-else-if="post.url"
            :src="post.url"
            :alt="post.prompt"
            class="w-full h-full object-contain"
          />
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-2 mb-6 flex-wrap">
        <button
          class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm transition-all flex items-center gap-2 border border-white/5"
          @click="downloadMedia"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>
        <button
          class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm transition-all flex items-center gap-2 border border-white/5"
          @click="sharePost"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share
        </button>
        <button
          class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm transition-all flex items-center gap-2 border border-white/5"
          @click="copyPrompt"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy Prompt
        </button>
        <NuxtLink
          :to="{ path: '/create', query: { prompt: post.prompt } }"
          class="px-4 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 hover:text-violet-200 text-sm transition-all flex items-center gap-2 border border-violet-500/20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          Recreate
        </NuxtLink>
      </div>

      <!-- Info cards -->
      <div class="space-y-4">
        <!-- Prompt -->
        <div class="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <h3 class="text-xs uppercase tracking-wider text-white/30 font-medium mb-3">Prompt</h3>
          <p class="text-white/80 text-sm leading-relaxed">{{ post.prompt }}</p>
        </div>

        <!-- Generation Settings -->
        <div v-if="parsedSettings" class="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <h3 class="text-xs uppercase tracking-wider text-white/30 font-medium mb-3">Settings</h3>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div v-if="parsedSettings.width && parsedSettings.height">
              <span class="text-[11px] text-white/30 block mb-0.5">Resolution</span>
              <span class="text-sm text-white/70 tabular-nums">{{ parsedSettings.width }}×{{ parsedSettings.height }}</span>
            </div>
            <div v-if="parsedSettings.steps">
              <span class="text-[11px] text-white/30 block mb-0.5">Steps</span>
              <span class="text-sm text-white/70 tabular-nums">{{ parsedSettings.steps }}</span>
            </div>
            <div v-if="parsedSettings.cfg">
              <span class="text-[11px] text-white/30 block mb-0.5">CFG Scale</span>
              <span class="text-sm text-white/70 tabular-nums">{{ parsedSettings.cfg }}</span>
            </div>
            <div v-if="post.qualityScore">
              <span class="text-[11px] text-white/30 block mb-0.5">Quality Score</span>
              <span class="text-sm tabular-nums" :class="getQualityScoreClass(post.qualityScore)">
                {{ post.qualityScore.toFixed(1) }} / 10
              </span>
            </div>
          </div>

          <!-- Negative prompt -->
          <div v-if="parsedSettings.negativePrompt" class="mt-4 pt-4 border-t border-white/5">
            <span class="text-[11px] text-white/30 block mb-1">Negative Prompt</span>
            <p class="text-sm text-white/50 leading-relaxed">{{ parsedSettings.negativePrompt }}</p>
          </div>

          <!-- Attributes -->
          <div v-if="parsedSettings.attributes && Object.keys(parsedSettings.attributes).length" class="mt-4 pt-4 border-t border-white/5">
            <span class="text-[11px] text-white/30 block mb-2">Attributes</span>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="(val, key) in parsedSettings.attributes"
                :key="String(key)"
                class="px-2.5 py-1 rounded-lg bg-white/5 text-white/50 text-xs border border-white/5"
              >
                {{ key }}: <span class="text-white/70">{{ val }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Quality score (if no settings but has score) -->
        <div v-else-if="post.qualityScore" class="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <h3 class="text-xs uppercase tracking-wider text-white/30 font-medium mb-3">Quality</h3>
          <span class="text-lg tabular-nums font-medium" :class="getQualityScoreClass(post.qualityScore)">
            {{ post.qualityScore.toFixed(1) }} / 10
          </span>
        </div>

        <!-- Details -->
        <div class="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <h3 class="text-xs uppercase tracking-wider text-white/30 font-medium mb-3">Details</h3>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-[11px] text-white/30 block mb-0.5">Type</span>
              <span class="text-white/70 capitalize">{{ post.type }}</span>
            </div>
            <div>
              <span class="text-[11px] text-white/30 block mb-0.5">Created</span>
              <span class="text-white/70">{{ formatTime(post.createdAt) }}</span>
            </div>
            <div>
              <span class="text-[11px] text-white/30 block mb-0.5">ID</span>
              <span class="text-white/40 font-mono text-xs break-all">{{ post.id }}</span>
            </div>
            <div>
              <span class="text-[11px] text-white/30 block mb-0.5">Generation</span>
              <span class="text-white/40 font-mono text-xs break-all">{{ post.generationId }}</span>
            </div>
          </div>
        </div>

        <!-- Parent image -->
        <div v-if="post.parentImage && post.parentImage.url" class="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <h3 class="text-xs uppercase tracking-wider text-white/30 font-medium mb-3">Source Image</h3>
          <NuxtLink :to="`/post/${post.parentImage.id}`" class="block">
            <img
              :src="post.parentImage.url"
              alt="Source image"
              class="rounded-xl max-h-60 object-contain border border-white/5"
            />
          </NuxtLink>
        </div>

        <!-- Related media -->
        <div v-if="siblings.length > 0" class="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <h3 class="text-xs uppercase tracking-wider text-white/30 font-medium mb-3">
            From Same Generation
            <span class="text-white/20 ml-1">({{ siblings.length }})</span>
          </h3>
          <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <NuxtLink
              v-for="sib in siblings"
              :key="sib.id"
              :to="`/post/${sib.id}`"
              class="relative aspect-square rounded-lg overflow-hidden border border-white/5 hover:border-violet-500/30 transition-all group"
            >
              <video
                v-if="sib.type === 'video' && sib.url"
                :src="sib.url + '#t=0.1'"
                muted
                preload="metadata"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <img
                v-else-if="sib.url"
                :src="sib.url"
                alt=""
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              <div v-if="sib.type === 'video'" class="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21 6 3" /></svg>
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
