/**
 * useQueue — persistent per-user job queue composable.
 *
 * Single adaptive poller replaces all per-generation polling.
 * Uses useState for SSR-safe state, polls /api/generate/my-queue
 * at varying intervals based on queue activity.
 *
 * Poll strategy (to stay within CF free 100k req/day):
 *   - Has processing items → 5s
 *   - Only queued items    → 15s
 *   - All resolved         → stop
 */

export interface QueueItem {
  id: string
  generationId: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'cancelled'
  url: string | null
  parentId: string | null
  error: string | null
  createdAt: string
}

export interface QueueStats {
  queued: number
  processing: number
  complete: number
  failed: number
}

export function useQueue() {
  const items = useState<QueueItem[]>('queue-items', () => [])
  const stats = useState<QueueStats>('queue-stats', () => ({ queued: 0, processing: 0, complete: 0, failed: 0 }))
  const loading = useState('queue-loading', () => false)
  const error = useState<string | null>('queue-error', () => null)

  // Track polling timer
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let isPolling = false

  // ─── Computed helpers ──────────────────────────────────────────
  const hasActive = computed(() => stats.value.queued > 0 || stats.value.processing > 0)
  const totalActive = computed(() => stats.value.queued + stats.value.processing)
  const totalItems = computed(() => items.value.length)

  const queuedItems = computed(() => items.value.filter(i => i.status === 'queued'))
  const processingItems = computed(() => items.value.filter(i => i.status === 'processing'))
  const completedItems = computed(() => items.value.filter(i => i.status === 'complete'))
  const failedItems = computed(() => items.value.filter(i => i.status === 'failed' || i.status === 'cancelled'))

  // ─── Fetch queue ───────────────────────────────────────────────
  async function refresh() {
    if (import.meta.server) return

    try {
      error.value = null
      const data = await $fetch<{ items: QueueItem[]; stats: QueueStats }>('/api/generate/my-queue', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = data.items
      stats.value = data.stats
    } catch (e: any) {
      // Don't show auth errors (user not logged in)
      if (e?.statusCode !== 401) {
        error.value = e?.message || 'Failed to load queue'
      }
    }
  }

  // ─── Adaptive polling ─────────────────────────────────────────
  function getInterval(): number {
    if (stats.value.processing > 0) return 5_000   // active work — check often
    if (stats.value.queued > 0) return 15_000       // waiting for cron — check rarely
    return 0                                         // nothing active — stop
  }

  function scheduleNext() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }

    const interval = getInterval()
    if (interval === 0) {
      isPolling = false
      return
    }

    pollTimer = setTimeout(async () => {
      await refresh()
      scheduleNext()
    }, interval)
  }

  function startPolling() {
    if (isPolling) return
    isPolling = true
    scheduleNext()
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    isPolling = false
  }

  // Watch stats to auto-start/stop polling
  if (import.meta.client) {
    watch(stats, () => {
      if (hasActive.value && !isPolling) {
        startPolling()
      } else if (hasActive.value && isPolling) {
        // Interval may have changed — reschedule
        scheduleNext()
      }
    }, { deep: true })
  }

  // ─── Actions ──────────────────────────────────────────────────
  async function cancel(itemId: string) {
    try {
      await $fetch('/api/generate/cancel', {
        method: 'POST',
        body: { itemId },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      // Optimistic update
      const idx = items.value.findIndex(i => i.id === itemId)
      if (idx >= 0) {
        const updated = { ...items.value[idx] } as QueueItem
        updated.status = 'cancelled'
        updated.error = 'Cancelled by user'
        items.value = items.value.map((item, i) => i === idx ? updated : item)
        recalcStats()
      }
    } catch (e: any) {
      console.warn('[Queue] Cancel failed:', e.message)
      await refresh() // sync with server on failure
    }
  }

  async function dismiss(itemId: string) {
    try {
      await $fetch('/api/generate/dismiss', {
        method: 'POST',
        body: { itemIds: [itemId] },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      // Optimistic update
      items.value = items.value.filter(i => i.id !== itemId)
      recalcStats()
    } catch (e: any) {
      console.warn('[Queue] Dismiss failed:', e.message)
    }
  }

  async function clearCompleted() {
    try {
      await $fetch('/api/generate/dismiss', {
        method: 'POST',
        body: { all: true },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      // Optimistic update
      items.value = items.value.filter(i => i.status === 'queued' || i.status === 'processing')
      recalcStats()
    } catch (e: any) {
      console.warn('[Queue] Clear failed:', e.message)
      await refresh()
    }
  }

  function recalcStats() {
    let queued = 0, processing = 0, complete = 0, failed = 0
    for (const item of items.value) {
      if (item.status === 'queued') queued++
      else if (item.status === 'processing') processing++
      else if (item.status === 'complete') complete++
      else if (item.status === 'failed' || item.status === 'cancelled') failed++
    }
    stats.value = { queued, processing, complete, failed }
  }

  // ─── Lifecycle ────────────────────────────────────────────────
  // Init: load queue on first client mount
  if (import.meta.client) {
    onNuxtReady(async () => {
      await refresh()
      if (hasActive.value) startPolling()
    })
  }

  return {
    // State
    items: readonly(items),
    stats: readonly(stats),
    loading: readonly(loading),
    error: readonly(error),
    // Computed
    hasActive,
    totalActive,
    totalItems,
    queuedItems,
    processingItems,
    completedItems,
    failedItems,
    // Actions
    refresh,
    cancel,
    dismiss,
    clearCompleted,
    startPolling,
    stopPolling,
  }
}
