<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeo({
  title: 'Job Details',
  description: 'View details and status of your AI generation job.'
})
useWebPageSchema()

const route = useRoute()
const itemId = route.params.id as string
const queue = useQueue()

const { data, error, pending, refresh } = await useFetch(`/api/generate/job/${itemId}`, {
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
})

// Auto-refresh while active
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
watch(() => data.value?.item?.status, (status) => {
  if (status === 'queued' || status === 'processing') {
    if (!pollTimer.value) {
      pollTimer.value = setInterval(() => refresh(), 5000)
    }
  } else if (pollTimer.value) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (pollTimer.value) clearInterval(pollTimer.value)
})

// ─── Computed helpers ────────────────────────────────────────
const item = computed(() => data.value?.item)
const generation = computed(() => data.value?.generation)
const parent = computed(() => data.value?.parent)
const meta = computed(() => {
  const m = item.value as Record<string, unknown> | undefined
  return (m?.metadata ?? {}) as Record<string, Record<string, unknown>>
})
const settings = computed(() => {
  const g = generation.value as Record<string, unknown> | undefined
  return (g?.settings ?? {}) as Record<string, unknown>
})
const runpodInput = computed(() => ((meta.value?.runpodInput || {}) as Record<string, unknown>))

// Extract dimensions from metadata
const mediaWidth = computed(() => runpodInput.value?.width || meta.value?.width || settings.value?.width || null)
const mediaHeight = computed(() => runpodInput.value?.height || meta.value?.height || settings.value?.height || null)

const workflowLabel = computed(() => {
  const action = runpodInput.value?.action
  switch (action) {
    case 'text2image': return 'Text → Image'
    case 'image2video': return 'Image → Video'
    case 'text2video': return 'Text → Video'
    case 'image2image': return 'Image → Image'
    case 'upscale': return 'Upscale'
    case 'upscale_video': return 'Video Upscale'
    default: return action || null
  }
})

const allSettings = computed(() => {
  const s: Record<string, unknown> = {}
  const input = runpodInput.value
  if (workflowLabel.value) s['Workflow'] = workflowLabel.value
  if (input.model) s['Model'] = input.model
  if (input.width) s['Width'] = input.width
  if (input.height) s['Height'] = input.height
  if (input.num_frames) s['Frames'] = input.num_frames
  if (input.steps) s['Steps'] = input.steps
  if (input.fps) s['FPS'] = input.fps
  if (input.cfg) s['CFG'] = input.cfg
  if (input.lora_strength != null) s['LoRA'] = input.lora_strength
  if (input.image_strength != null) s['Image Strength'] = input.image_strength
  if (input.seed != null && (input.seed as number) >= 0) s['Seed'] = input.seed
  if (input.negative_prompt) s['Negative Prompt'] = input.negative_prompt
  if (input.audio_prompt) s['Audio'] = input.audio_prompt
  if (input.preset) s['Preset'] = input.preset
  if (input.base_prompt) s['Base Prompt'] = input.base_prompt
  if (input.camera_lora) s['Camera LoRA'] = input.camera_lora
  // Fallback to generation settings
  const gs = settings.value
  if (!Object.keys(s).length && gs) {
    for (const [k, v] of Object.entries(gs)) { if (v != null) s[k] = v }
  }
  return s
})

// Duration estimate from frames
const durationEstimate = computed(() => {
  const frames = runpodInput.value?.num_frames
  const fps = runpodInput.value?.fps || 24
  if (!frames) return null
  return ((frames as number) / (fps as number)).toFixed(1) + 's'
})

function statusBadge(status: string) {
  switch (status) {
    case 'queued': return { label: 'Queued', color: 'warning' as const }
    case 'processing': return { label: 'Processing', color: 'info' as const }
    case 'complete': return { label: 'Complete', color: 'success' as const }
    case 'failed': return { label: 'Failed', color: 'error' as const }
    case 'cancelled': return { label: 'Cancelled', color: 'neutral' as const }
    default: return { label: status, color: 'neutral' as const }
  }
}

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function typeIcon(type: string): string {
  if (type === 'video') return 'i-lucide-film'
  if (type === 'audio') return 'i-lucide-music'
  return 'i-lucide-image'
}

function qualityBarClass(score: number): string {
  if (score >= 7) return 'bg-emerald-500'
  if (score >= 4) return 'bg-amber-500'
  return 'bg-red-500'
}

function qualityBarWidth(score: number): string {
  return `${(score / 10) * 100}%`
}

function formatSettingDisplay(val: unknown): string {
  return typeof val === 'object' ? JSON.stringify(val) : String(val)
}

const metaJson = computed(() => JSON.stringify(meta.value, null, 2))

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

// ─── Re-run ──────────────────────────────────────────────────
const rerunning = ref(false)

async function rerun(variation = false) {
  if (rerunning.value || !item.value) return
  rerunning.value = true

  try {
    const input = { ...runpodInput.value }
    if (variation) {
      // Random seed for variation
      input.seed = -1
    }

    const result = await $fetch<{ items?: { id: string }[]; item?: { id: string } }>('/api/generate/image2video', {
      method: 'POST',
      body: {
        ...input,
        action: input.action || (item.value.type === 'video' ? 'image2video' : 'text2image'),
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result?.items?.length) {
      queue.refresh()
      navigateTo(`/job/${result.items![0]!.id}`)
    } else if (result?.item?.id) {
      queue.refresh()
      navigateTo(`/job/${result.item.id}`)
    }
  } catch (e: unknown) {
    console.error('Re-run failed:', (e as Error).message)
  } finally {
    rerunning.value = false
  }
}

// ─── Retry (re-submit failed/cancelled jobs) ────────────────
async function retry() {
  if (!item.value) return
  rerunning.value = true
  try {
    await $fetch('/api/generate/retry', {
      method: 'POST',
      body: { itemId: item.value.id },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    queue.refresh()
    await refresh()
  } catch (e: unknown) {
    console.error('Retry failed:', (e as Error).message)
  } finally {
    rerunning.value = false
  }
}

function copyError() {
  if (item.value?.error) {
    globalThis.navigator?.clipboard?.writeText(item.value.error)
  }
}

// ─── One-click Make Video (image → LTX2 auto pipeline) ──────
const makingVideo = ref(false)

async function makeVideo() {
  if (!item.value || makingVideo.value) return
  makingVideo.value = true
  try {
    const { effectiveEndpoint } = useAppSettings()
    const endpoint = effectiveEndpoint.value

    const result = await $fetch<{ items?: { id: string }[] }>('/api/generate/image2video-auto-batch', {
      method: 'POST',
      body: {
        mediaItemIds: [item.value.id],
        basePrompt: '',
        audioPrompt: 'ambient nature sounds, gentle wind, peaceful',
        negativePrompt: 'worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo',
        steps: 20, numFrames: 241,
        width: 1280, height: 720,
        imageStrength: 1.0, endpoint,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result.items?.length) {
      queue.refresh()
      navigateTo(`/job/${result.items![0]!.id}`)
    }
  } catch (e: unknown) {
    console.error('Make video failed:', (e as Error).message)
  } finally {
    makingVideo.value = false
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Back -->
    <NuxtLink to="/create" class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6">
      <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
      Back
    </NuxtLink>

    <!-- Loading -->
    <div v-if="pending && !data" class="flex items-center justify-center py-20">
      <UIcon name="i-lucide-loader" class="w-6 h-6 text-violet-500 animate-spin" />
    </div>

    <!-- Error -->
    <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error.statusMessage || 'Failed to load job'" />

    <!-- Content -->
    <template v-else-if="data && item">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 class="text-xl font-bold text-slate-800 flex items-center gap-3">
            <UIcon :name="typeIcon(item.type)" class="w-5 h-5 text-slate-400" />
            {{ typeLabel(item.type) }} Job
            <UBadge :color="statusBadge(item.status).color" variant="subtle" size="lg">
              {{ statusBadge(item.status).label }}
            </UBadge>
          </h1>
          <p class="text-xs text-slate-400 mt-1 font-mono">{{ item.id }}</p>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2 shrink-0 flex-wrap">
          <UButton v-if="item.status === 'failed' || item.status === 'cancelled'" :loading="rerunning" size="sm" color="warning" variant="soft" icon="i-lucide-rotate-cw" @click="retry">
            Retry
          </UButton>
          <UButton v-if="item.status === 'complete' && item.type === 'image'" :loading="makingVideo" size="sm" color="success" variant="soft" icon="i-lucide-film" @click="makeVideo">
            Make Video
          </UButton>
          <UButton v-if="item.status === 'complete' && runpodInput.action" :loading="rerunning" size="sm" color="primary" variant="soft" icon="i-lucide-copy" @click="rerun(false)">
            Re-run Exact
          </UButton>
          <UButton v-if="item.status === 'complete' && runpodInput.action" :loading="rerunning" size="sm" color="info" variant="soft" icon="i-lucide-sparkles" @click="rerun(true)">
            Variation
          </UButton>
          <UButton v-if="item.url" :href="item.url" download size="sm" variant="outline" color="neutral" icon="i-lucide-download">
            Download
          </UButton>
        </div>
      </div>

      <!-- Media preview — exact resolution -->
      <div class="mb-8">
        <!-- Complete: show media at exact resolution -->
        <div v-if="item.status === 'complete' && item.url" class="rounded-xl overflow-hidden border border-slate-200 bg-slate-900 inline-block max-w-full">
          <video v-if="item.type === 'video'" :src="item.url" controls class="block" :style="mediaWidth && mediaHeight ? { width: `${mediaWidth}px`, maxWidth: '100%', aspectRatio: `${mediaWidth}/${mediaHeight}` } : { maxWidth: '100%' }" />
          <audio v-else-if="item.type === 'audio'" :src="item.url" controls class="w-full p-4" />
          <img v-else :src="item.url" :alt="item.prompt" class="block" :style="mediaWidth && mediaHeight ? { width: `${mediaWidth}px`, maxWidth: '100%', aspectRatio: `${mediaWidth}/${mediaHeight}` } : { maxWidth: '100%' }" loading="lazy" />
        </div>

        <!-- Processing: spinner -->
        <div v-else-if="item.status === 'processing' || item.status === 'queued'" class="rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center py-20" :style="mediaWidth && mediaHeight ? { aspectRatio: `${mediaWidth}/${mediaHeight}`, maxHeight: '400px' } : {}">
          <UIcon name="i-lucide-loader" class="w-10 h-10 text-violet-500 animate-spin mb-3" />
          <p class="text-sm text-slate-500">{{ item.status === 'queued' ? 'Waiting in queue…' : 'Processing…' }}</p>
          <p v-if="durationEstimate" class="text-xs text-slate-400 mt-1">{{ mediaWidth }}×{{ mediaHeight }} · {{ durationEstimate }}</p>
        </div>

        <!-- Failed -->
        <div v-else-if="item.status === 'failed'" class="rounded-xl border border-red-200 bg-red-50 p-6">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-x-circle" class="w-5 h-5 text-red-500" />
              <span class="text-sm font-medium text-red-700">Generation Failed</span>
            </div>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-copy" @click="copyError" title="Copy error" />
          </div>
          <pre class="text-sm text-red-600 whitespace-pre-wrap break-all select-all bg-red-100/50 rounded-lg p-3 mt-2 font-mono">{{ item.error || 'Unknown error' }}</pre>
        </div>
      </div>

      <!-- Details grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Left: Prompt & Source -->
        <div class="space-y-5">
          <!-- Prompt -->
          <div>
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Prompt</h3>
            <p class="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100 whitespace-pre-wrap">{{ item.prompt || '(auto-generated)' }}</p>
          </div>

          <!-- Audio prompt -->
          <div v-if="runpodInput.audio_prompt">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Audio Prompt</h3>
            <p class="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100">{{ runpodInput.audio_prompt }}</p>
          </div>

          <!-- Negative prompt -->
          <div v-if="runpodInput.negative_prompt">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Negative Prompt</h3>
            <p class="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100">{{ runpodInput.negative_prompt }}</p>
          </div>

          <!-- Parent source image -->
          <div v-if="parent">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Source {{ parent.type }}</h3>
            <NuxtLink :to="`/job/${parent.id}`" class="block rounded-lg overflow-hidden border border-slate-200 hover:border-violet-300 transition-colors max-w-xs">
              <img v-if="parent.url" :src="parent.url" :alt="parent.prompt" class="w-full" loading="lazy" />
            </NuxtLink>
          </div>

          <!-- Caption (from auto-gen pipeline) -->
          <div v-if="meta.caption">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">AI Caption</h3>
            <p class="text-sm text-slate-700 bg-violet-50 rounded-lg p-3 border border-violet-100">{{ meta.caption }}</p>
          </div>
        </div>

        <!-- Right: Settings & Timeline -->
        <div class="space-y-5">
          <!-- Generation Settings -->
          <div v-if="Object.keys(allSettings).length">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Settings</h3>
            <div class="text-xs bg-slate-50 rounded-lg p-3 border border-slate-100 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <template v-for="(val, key) in allSettings" :key="key">
                <span class="text-slate-500">{{ key }}</span>
                <span class="text-slate-700 font-medium truncate">{{ formatSettingDisplay(val) }}</span>
              </template>
            </div>
          </div>

          <!-- Timestamps -->
          <div>
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Timeline</h3>
            <div class="text-sm space-y-1">
              <div class="flex justify-between">
                <span class="text-slate-500">Created</span>
                <span class="text-slate-700">{{ formatDate(item.createdAt) }}</span>
              </div>
              <div v-if="item.submittedAt" class="flex justify-between">
                <span class="text-slate-500">Submitted to GPU</span>
                <span class="text-slate-700">{{ formatDate(item.submittedAt) }}</span>
              </div>
              <div v-if="item.dismissedAt" class="flex justify-between">
                <span class="text-slate-500">Dismissed</span>
                <span class="text-slate-700">{{ formatDate(item.dismissedAt) }}</span>
              </div>
            </div>
          </div>

          <!-- Quality Score -->
          <div v-if="item.qualityScore">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Quality Score</h3>
            <div class="flex items-center gap-2">
              <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full" :class="qualityBarClass(item.qualityScore)" :style="{ width: qualityBarWidth(item.qualityScore) }" />
              </div>
              <span class="text-sm font-medium text-slate-700">{{ item.qualityScore.toFixed(1) }}</span>
            </div>
          </div>

          <!-- RunPod Info -->
          <div v-if="item.runpodJobId">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">RunPod Job</h3>
            <p class="text-xs font-mono text-slate-500 bg-slate-50 rounded-lg p-2 border border-slate-100 break-all">{{ item.runpodJobId }}</p>
          </div>

          <!-- API URL -->
          <div v-if="meta.apiUrl">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">API Endpoint</h3>
            <p class="text-xs font-mono text-slate-500 bg-slate-50 rounded-lg p-2 border border-slate-100 break-all">{{ meta.apiUrl }}</p>
          </div>

          <!-- Raw Metadata (collapsible) -->
          <details v-if="meta && Object.keys(meta).length" class="group">
            <summary class="text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 flex items-center gap-1">
              <UIcon name="i-lucide-chevron-right" class="w-3 h-3 transition-transform group-open:rotate-90" />
              Raw Metadata
            </summary>
            <pre class="text-[10px] text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100 mt-1.5 overflow-x-auto max-h-60">{{ metaJson }}</pre>
          </details>
        </div>
      </div>
    </template>
  </div>
</template>
