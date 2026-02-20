<script setup lang="ts">
/**
 * QueueSidebar — persistent collapsible panel showing the user's job queue.
 *
 * Shows queued, processing, completed, and failed items with actions
 * (cancel, dismiss, view). Auto-collapses when empty.
 */
import type { QueueItem } from '~/composables/useQueue'

const queue = useQueue()
const collapsed = ref(false)

// Auto-expand when new items appear
watch(() => queue.totalActive.value, (active) => {
  if (active > 0) collapsed.value = false
})

function statusIcon(status: QueueItem['status']) {
  switch (status) {
    case 'queued': return 'i-lucide-clock'
    case 'processing': return 'i-lucide-loader'
    case 'complete': return 'i-lucide-check-circle'
    case 'failed': return 'i-lucide-x-circle'
    case 'cancelled': return 'i-lucide-ban'
    default: return 'i-lucide-circle'
  }
}

function statusColor(status: QueueItem['status']) {
  switch (status) {
    case 'queued': return 'text-amber-500'
    case 'processing': return 'text-blue-500'
    case 'complete': return 'text-emerald-500'
    case 'failed': return 'text-red-500'
    case 'cancelled': return 'text-slate-400'
    default: return 'text-slate-400'
  }
}

function truncate(text: string, max = 50) {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function typeIcon(type: string) {
  switch (type) {
    case 'video': return 'i-lucide-film'
    case 'audio': return 'i-lucide-music'
    default: return 'i-lucide-image'
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
</script>

<template>
  <aside
    class="fixed right-0 top-16 bottom-0 z-40 flex flex-col transition-all duration-200 ease-out"
    :class="collapsed ? 'w-12' : 'w-72'"
  >
    <!-- Toggle button -->
    <button
      class="absolute -left-8 top-4 w-8 h-8 rounded-l-lg bg-white border border-r-0 border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
      @click="collapsed = !collapsed"
      :title="collapsed ? 'Show queue' : 'Hide queue'"
    >
      <div class="relative">
        <UIcon :name="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-right-open'" class="w-4 h-4" />
        <!-- Badge for active items -->
        <span
          v-if="queue.totalActive.value > 0 && collapsed"
          class="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center"
        >
          {{ queue.totalActive.value > 9 ? '9+' : queue.totalActive.value }}
        </span>
      </div>
    </button>

    <!-- Panel content -->
    <div
      v-show="!collapsed"
      class="flex-1 flex flex-col bg-white/95 backdrop-blur-sm border-l border-slate-200 overflow-hidden"
    >
      <!-- Header -->
      <div class="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-list-ordered" class="w-4 h-4 text-slate-400" />
          <span class="text-sm font-semibold text-slate-700">Queue</span>
          <span v-if="queue.totalActive.value > 0" class="text-xs text-blue-500 font-medium">
            {{ queue.totalActive.value }} active
          </span>
        </div>
        <div class="flex items-center gap-1">
          <UButton
            v-if="queue.completedItems.value.length > 0 || queue.failedItems.value.length > 0"
            variant="ghost"
            size="xs"
            color="neutral"
            icon="i-lucide-check-check"
            title="Clear completed"
            @click="queue.clearCompleted()"
          />
          <UButton
            variant="ghost"
            size="xs"
            color="neutral"
            icon="i-lucide-refresh-cw"
            title="Refresh queue"
            @click="queue.refresh()"
          />
        </div>
      </div>

      <!-- Stats bar -->
      <div v-if="queue.totalItems.value > 0" class="px-4 py-2 border-b border-slate-100 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wider shrink-0">
        <span v-if="queue.stats.value.queued" class="text-amber-500">{{ queue.stats.value.queued }} queued</span>
        <span v-if="queue.stats.value.processing" class="text-blue-500">{{ queue.stats.value.processing }} running</span>
        <span v-if="queue.stats.value.complete" class="text-emerald-500">{{ queue.stats.value.complete }} done</span>
        <span v-if="queue.stats.value.failed" class="text-red-500">{{ queue.stats.value.failed }} failed</span>
      </div>

      <!-- Items list -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="queue.totalItems.value === 0" class="flex flex-col items-center justify-center h-full text-slate-400 px-4">
          <UIcon name="i-lucide-inbox" class="w-8 h-8 mb-2 opacity-40" />
          <p class="text-xs text-center">No items in queue.<br />Generate something to get started!</p>
        </div>

        <TransitionGroup name="queue-item" tag="div" class="divide-y divide-slate-50">
          <div
            v-for="item in queue.items.value"
            :key="item.id"
            class="px-3 py-2.5 hover:bg-slate-50/80 transition-colors group"
          >
            <div class="flex items-start gap-2.5">
              <!-- Status icon -->
              <div class="mt-0.5 shrink-0">
                <UIcon
                  :name="statusIcon(item.status)"
                  class="w-4 h-4"
                  :class="[
                    statusColor(item.status),
                    item.status === 'processing' ? 'animate-spin' : '',
                  ]"
                />
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <UIcon :name="typeIcon(item.type)" class="w-3 h-3 text-slate-400 shrink-0" />
                  <span class="text-xs font-medium text-slate-700 truncate">
                    {{ truncate(item.prompt || 'Untitled', 35) }}
                  </span>
                </div>

                <!-- Thumbnail for completed items -->
                <div v-if="item.status === 'complete' && item.url && item.type === 'image'" class="mt-1.5">
                  <img
                    :src="item.url"
                    :alt="item.prompt"
                    class="w-full h-16 object-cover rounded-md border border-slate-200"
                    loading="lazy"
                  />
                </div>

                <!-- Error message for failed items -->
                <p v-if="item.error" class="text-[10px] text-red-400 mt-0.5 truncate">
                  {{ item.error }}
                </p>

                <span class="text-[10px] text-slate-400 mt-0.5 block">{{ timeAgo(item.createdAt) }}</span>
              </div>

              <!-- Actions -->
              <div class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <UButton
                  v-if="item.status === 'queued' || item.status === 'processing'"
                  variant="ghost"
                  size="xs"
                  color="error"
                  icon="i-lucide-x"
                  title="Cancel"
                  @click="queue.cancel(item.id)"
                />
                <UButton
                  v-if="item.status === 'complete' || item.status === 'failed' || item.status === 'cancelled'"
                  variant="ghost"
                  size="xs"
                  color="neutral"
                  icon="i-lucide-x"
                  title="Dismiss"
                  @click="queue.dismiss(item.id)"
                />
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.queue-item-enter-active,
.queue-item-leave-active {
  transition: all 0.2s ease;
}
.queue-item-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.queue-item-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.queue-item-move {
  transition: transform 0.2s ease;
}
</style>
