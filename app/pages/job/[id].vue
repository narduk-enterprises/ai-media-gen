<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Job Details' })

const route = useRoute()
const itemId = route.params.id as string

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

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

function prettyJson(obj: any) {
  if (!obj) return null
  return JSON.stringify(obj, null, 2)
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
    <template v-else-if="data">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 class="text-xl font-bold text-slate-800 flex items-center gap-3">
            <UIcon :name="data.item.type === 'video' ? 'i-lucide-film' : data.item.type === 'audio' ? 'i-lucide-music' : 'i-lucide-image'" class="w-5 h-5 text-slate-400" />
            {{ data.item.type.charAt(0).toUpperCase() + data.item.type.slice(1) }} Job
          </h1>
          <p class="text-xs text-slate-400 mt-1 font-mono">{{ data.item.id }}</p>
        </div>
        <UBadge :color="statusBadge(data.item.status).color" variant="subtle" size="lg">
          {{ statusBadge(data.item.status).label }}
        </UBadge>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Left: Media preview -->
        <div>
          <!-- Complete: show media -->
          <div v-if="data.item.status === 'complete' && data.item.url" class="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
            <video v-if="data.item.type === 'video'" :src="data.item.url" controls class="w-full" />
            <audio v-else-if="data.item.type === 'audio'" :src="data.item.url" controls class="w-full p-4" />
            <img v-else :src="data.item.url" :alt="data.item.prompt" class="w-full" loading="lazy" />
          </div>

          <!-- Processing: spinner -->
          <div v-else-if="data.item.status === 'processing' || data.item.status === 'queued'" class="rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center py-20">
            <UIcon name="i-lucide-loader" class="w-10 h-10 text-violet-500 animate-spin mb-3" />
            <p class="text-sm text-slate-500">{{ data.item.status === 'queued' ? 'Waiting in queue…' : 'Processing…' }}</p>
          </div>

          <!-- Failed -->
          <div v-else-if="data.item.status === 'failed'" class="rounded-xl border border-red-200 bg-red-50 p-6">
            <div class="flex items-center gap-2 mb-2">
              <UIcon name="i-lucide-x-circle" class="w-5 h-5 text-red-500" />
              <span class="text-sm font-medium text-red-700">Generation Failed</span>
            </div>
            <p class="text-sm text-red-600">{{ data.item.error || 'Unknown error' }}</p>
          </div>

          <!-- Parent source image -->
          <div v-if="data.parent" class="mt-4">
            <p class="text-xs font-medium text-slate-500 mb-2">Source {{ data.parent.type }}</p>
            <NuxtLink :to="`/job/${data.parent.id}`" class="block rounded-lg overflow-hidden border border-slate-200 hover:border-violet-300 transition-colors">
              <img v-if="data.parent.url" :src="data.parent.url" :alt="data.parent.prompt" class="w-full rounded-lg" loading="lazy" />
            </NuxtLink>
          </div>
        </div>

        <!-- Right: Details -->
        <div class="space-y-5">
          <!-- Prompt -->
          <div>
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Prompt</h3>
            <p class="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100 whitespace-pre-wrap">{{ data.item.prompt || '(none)' }}</p>
          </div>

          <!-- Timestamps -->
          <div>
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Timeline</h3>
            <div class="text-sm space-y-1">
              <div class="flex justify-between">
                <span class="text-slate-500">Created</span>
                <span class="text-slate-700">{{ formatDate(data.item.createdAt) }}</span>
              </div>
              <div v-if="data.item.submittedAt" class="flex justify-between">
                <span class="text-slate-500">Submitted to GPU</span>
                <span class="text-slate-700">{{ formatDate(data.item.submittedAt) }}</span>
              </div>
              <div v-if="data.item.dismissedAt" class="flex justify-between">
                <span class="text-slate-500">Dismissed</span>
                <span class="text-slate-700">{{ formatDate(data.item.dismissedAt) }}</span>
              </div>
            </div>
          </div>

          <!-- Quality Score -->
          <div v-if="data.item.qualityScore">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Quality Score</h3>
            <div class="flex items-center gap-2">
              <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full" :class="data.item.qualityScore >= 7 ? 'bg-emerald-500' : data.item.qualityScore >= 4 ? 'bg-amber-500' : 'bg-red-500'" :style="{ width: `${(data.item.qualityScore / 10) * 100}%` }" />
              </div>
              <span class="text-sm font-medium text-slate-700">{{ data.item.qualityScore.toFixed(1) }}</span>
            </div>
          </div>

          <!-- RunPod Info -->
          <div v-if="data.item.runpodJobId">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">RunPod Job</h3>
            <p class="text-xs font-mono text-slate-500 bg-slate-50 rounded-lg p-2 border border-slate-100 break-all">{{ data.item.runpodJobId }}</p>
          </div>

          <!-- Generation Settings -->
          <div v-if="data.generation.settings">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Settings</h3>
            <div class="text-xs bg-slate-50 rounded-lg p-3 border border-slate-100 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <template v-for="(val, key) in data.generation.settings" :key="key">
                <span class="text-slate-500 capitalize">{{ String(key).replace(/([A-Z])/g, ' $1').trim() }}</span>
                <span class="text-slate-700 font-medium truncate">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
              </template>
            </div>
          </div>

          <!-- Metadata (RunPod payload) -->
          <details v-if="data.item.metadata" class="group">
            <summary class="text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 flex items-center gap-1">
              <UIcon name="i-lucide-chevron-right" class="w-3 h-3 transition-transform group-open:rotate-90" />
              Raw Metadata
            </summary>
            <pre class="text-[10px] text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100 mt-1.5 overflow-x-auto max-h-60">{{ prettyJson(data.item.metadata) }}</pre>
          </details>
        </div>
      </div>
    </template>
  </div>
</template>
