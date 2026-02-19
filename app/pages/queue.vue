<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

useSeoMeta({ title: 'GPU Queue' })

interface QueueItem {
  prompt_id: string
  instance: string
  status: 'running' | 'pending'
  prompt_data: {
    type?: string
    prompt?: string
    negative?: string
    steps?: number
    cfg?: number
    width?: number
    height?: number
    length?: number
  }
}

const loading = ref(false)
const clearing = ref(false)
const deleting = ref<string | null>(null)

const queue = ref<{ running: QueueItem[]; pending: QueueItem[]; total: number }>({
  running: [],
  pending: [],
  total: 0,
})

async function fetchQueue() {
  loading.value = true
  try {
    queue.value = await $fetch('/api/generate/queue', {
      headers: { 'X-Requested-With': 'fetch' },
    })
  } catch {
    queue.value = { running: [], pending: [], total: 0 }
  } finally {
    loading.value = false
  }
}

async function clearAll() {
  clearing.value = true
  try {
    await $fetch('/api/generate/clear-queue', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
    })
    await fetchQueue()
  } finally {
    clearing.value = false
  }
}

async function deleteItem(promptId: string) {
  deleting.value = promptId
  try {
    await $fetch('/api/generate/queue-delete', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      body: { prompt_id: promptId },
    })
    await fetchQueue()
  } finally {
    deleting.value = null
  }
}

function typeLabel(type?: string) {
  const labels: Record<string, string> = {
    text2image: '🖼️ Text → Image',
    text2video: '🎬 Text → Video',
    image2video: '🎬 Image → Video',
  }
  return labels[type || ''] || '🖼️ Generation'
}

function typeColor(type?: string) {
  const colors: Record<string, string> = {
    text2image: 'bg-blue-100 text-blue-700',
    text2video: 'bg-purple-100 text-purple-700',
    image2video: 'bg-amber-100 text-amber-700',
  }
  return colors[type || ''] || 'bg-slate-100 text-slate-700'
}

// Auto-refresh every 3s
let interval: ReturnType<typeof setInterval>
onMounted(() => {
  fetchQueue()
  interval = setInterval(fetchQueue, 3000)
})
onUnmounted(() => clearInterval(interval))
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-slate-800">GPU Queue</h1>
        <p class="text-sm text-slate-500 mt-1">
          {{ queue.total }} job{{ queue.total !== 1 ? 's' : '' }} in queue
          <span v-if="loading" class="ml-2 text-slate-400">refreshing…</span>
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="fetchQueue"
        >
          Refresh
        </UButton>
        <UButton
          v-if="queue.total > 0"
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-trash-2"
          :loading="clearing"
          @click="clearAll"
        >
          Clear All
        </UButton>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && queue.total === 0" class="text-center py-20">
      <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-50 flex items-center justify-center">
        <UIcon name="i-lucide-check-circle" class="w-8 h-8 text-emerald-500" />
      </div>
      <p class="text-lg font-medium text-slate-700">Queue is empty</p>
      <p class="text-sm text-slate-500 mt-1">No jobs currently running or pending</p>
    </div>

    <!-- Running jobs -->
    <div v-if="queue.running.length > 0" class="mb-6">
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Running ({{ queue.running.length }})
      </h2>
      <div class="space-y-3">
        <div
          v-for="item in queue.running"
          :key="item.prompt_id"
          class="bg-white rounded-xl border border-emerald-200 p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-2">
                <span class="relative flex h-2.5 w-2.5">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span :class="['text-xs font-medium px-2 py-0.5 rounded-full', typeColor(item.prompt_data?.type)]">
                  {{ typeLabel(item.prompt_data?.type) }}
                </span>
                <span v-if="item.prompt_data?.width" class="text-xs text-slate-400">
                  {{ item.prompt_data.width }}×{{ item.prompt_data.height }}
                  <template v-if="item.prompt_data.length"> · {{ item.prompt_data.length }}f</template>
                </span>
              </div>
              <p v-if="item.prompt_data?.prompt" class="text-sm text-slate-700 truncate">
                {{ item.prompt_data.prompt }}
              </p>
              <p class="text-xs text-slate-400 mt-1 font-mono">{{ item.prompt_id.slice(0, 12) }}…</p>
            </div>
            <UButton
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-square"
              title="Interrupt (cannot cancel running job)"
              disabled
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Pending jobs -->
    <div v-if="queue.pending.length > 0">
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Pending ({{ queue.pending.length }})
      </h2>
      <div class="space-y-3">
        <div
          v-for="item in queue.pending"
          :key="item.prompt_id"
          class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:border-slate-300 transition-colors"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-2">
                <span class="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span :class="['text-xs font-medium px-2 py-0.5 rounded-full', typeColor(item.prompt_data?.type)]">
                  {{ typeLabel(item.prompt_data?.type) }}
                </span>
                <span v-if="item.prompt_data?.width" class="text-xs text-slate-400">
                  {{ item.prompt_data.width }}×{{ item.prompt_data.height }}
                  <template v-if="item.prompt_data.length"> · {{ item.prompt_data.length }}f</template>
                </span>
              </div>
              <p v-if="item.prompt_data?.prompt" class="text-sm text-slate-700 truncate">
                {{ item.prompt_data.prompt }}
              </p>
              <p class="text-xs text-slate-400 mt-1 font-mono">{{ item.prompt_id.slice(0, 12) }}…</p>
            </div>
            <UButton
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              :loading="deleting === item.prompt_id"
              title="Remove from queue"
              @click="deleteItem(item.prompt_id)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
