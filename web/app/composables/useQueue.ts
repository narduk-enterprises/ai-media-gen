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
 *
 * Polling state uses module-level variables so they survive
 * across multiple useQueue() calls from different components.
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
  submittedAt: string | null
  width: number | null
  height: number | null
}

export interface QueueStats {
  queued: number
  processing: number
  complete: number
  failed: number
}

// ── Module-level polling state (survives across all callers) ─────────
let _pollTimer: ReturnType<typeof setTimeout> | null = null
let _isPolling = false

export function useQueue() {
  const items = useState<QueueItem[]>('queue-items', () => [])
  const stats = useState<QueueStats>('queue-stats', () => ({ queued: 0, processing: 0, complete: 0, failed: 0 }))
  const loading = useState('queue-loading', () => false)
  const error = useState<string | null>('queue-error', () => null)

  // ─── Computed ─────────────────────────────────────────────────
  const hasActive = computed(() => stats.value.queued > 0 || stats.value.processing > 0)
  const totalActive = computed(() => stats.value.queued + stats.value.processing)
  const totalItems = computed(() => items.value.length)
  const queuedItems = computed(() => items.value.filter(i => i.status === 'queued'))
  const processingItems = computed(() => items.value.filter(i => i.status === 'processing'))
  const completedItems = computed(() => items.value.filter(i => i.status === 'complete'))
  const failedItems = computed(() => items.value.filter(i => i.status === 'failed' || i.status === 'cancelled'))

  // ─── Fetch ────────────────────────────────────────────────────
  async function refresh() {
    if (import.meta.server) return
    try {
      error.value = null
      const data = await $fetch<{ items: QueueItem[]; stats: QueueStats }>('/api/generate/my-queue', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = data.items
      stats.value = data.stats
      // Auto-manage polling based on fresh stats
      if (data.stats.processing > 0 || data.stats.queued > 0) {
        _ensurePolling()
      }
    } catch (e: any) {
      if (e?.statusCode !== 401) {
        error.value = e?.message || 'Failed to load queue'
      }
    }
  }

  // ─── Adaptive polling ─────────────────────────────────────────
  function _getInterval(): number {
    if (stats.value.processing > 0) return 3_000
    if (stats.value.queued > 0) return 15_000
    return 0
  }

  function _scheduleNext() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null }
    const interval = _getInterval()
    if (interval === 0) { _isPolling = false; return }
    _pollTimer = setTimeout(async () => {
      await refresh() // refresh auto-calls _ensurePolling if active
    }, interval)
  }

  function _ensurePolling() {
    if (import.meta.server) return
    if (_isPolling) { _scheduleNext(); return } // reschedule (interval may have changed)
    _isPolling = true
    _scheduleNext()
  }

  function startPolling() { _ensurePolling() }

  function stopPolling() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null }
    _isPolling = false
  }

  // ─── submitAndTrack ───────────────────────────────────────────
  /**
   * Call after submitting any job to refresh the queue and optionally
   * clear a loading flag when the item resolves.
   */
  function submitAndTrack(
    itemId: string,
    loadingRef?: Ref<Record<string, boolean>>,
    loadingKey?: string,
    onComplete?: () => void,
  ) {
    refresh() // picks up new item + starts polling

    if (import.meta.server || (!loadingRef && !onComplete)) return

    // Watch for item completion
    const unwatch = watch(() => items.value, (list) => {
      const item = list.find(i => i.id === itemId)
      if (item && (item.status === 'complete' || item.status === 'failed' || item.status === 'cancelled')) {
        if (loadingRef && loadingKey) loadingRef.value[loadingKey] = false
        onComplete?.()
        unwatch()
      }
    }, { deep: true })
  }

  // ─── Cancel / Dismiss ─────────────────────────────────────────
  async function cancel(itemId: string) {
    try {
      await $fetch('/api/generate/cancel', {
        method: 'POST',
        body: { itemId },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      const idx = items.value.findIndex(i => i.id === itemId)
      if (idx >= 0) {
        const updated = { ...items.value[idx] } as QueueItem
        updated.status = 'cancelled'
        updated.error = 'Cancelled by user'
        items.value = items.value.map((item, i) => i === idx ? updated : item)
        _recalcStats()
      }
    } catch (e: any) {
      console.warn('[Queue] Cancel failed:', e.message)
      await refresh()
    }
  }

  async function dismiss(itemId: string) {
    try {
      await $fetch('/api/generate/dismiss', {
        method: 'POST',
        body: { itemIds: [itemId] },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = items.value.filter(i => i.id !== itemId)
      _recalcStats()
    } catch (e: any) {
      console.warn('[Queue] Dismiss failed:', e.message)
    }
  }

  async function deleteItem(itemId: string) {
    try {
      await $fetch('/api/generate/delete', {
        method: 'POST',
        body: { itemIds: [itemId] },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = items.value.filter(i => i.id !== itemId)
      _recalcStats()
    } catch (e: any) {
      console.warn('[Queue] Delete failed:', e.message)
    }
  }

  async function deleteAll() {
    try {
      await $fetch('/api/generate/delete', {
        method: 'POST',
        body: { all: true },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = []
      _recalcStats()
      stopPolling()
    } catch (e: any) {
      console.warn('[Queue] Delete all failed:', e.message)
      await refresh()
    }
  }

  async function clearCompleted() {
    try {
      await $fetch('/api/generate/dismiss', {
        method: 'POST',
        body: { all: true },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = items.value.filter(i => i.status === 'queued' || i.status === 'processing')
      _recalcStats()
    } catch (e: any) {
      console.warn('[Queue] Clear failed:', e.message)
      await refresh()
    }
  }

  async function cancelAll() {
    try {
      await $fetch('/api/generate/cancel-all', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      items.value = items.value.map(item =>
        (item.status === 'queued' || item.status === 'processing')
          ? { ...item, status: 'cancelled' as const, error: 'Cancelled by user (clear all)' }
          : item
      )
      _recalcStats()
      stopPolling()
    } catch (e: any) {
      console.warn('[Queue] Cancel all failed:', e.message)
      await refresh()
    }
  }

  function _recalcStats() {
    let queued = 0, processing = 0, complete = 0, failed = 0
    for (const item of items.value) {
      if (item.status === 'queued') queued++
      else if (item.status === 'processing') processing++
      else if (item.status === 'complete') complete++
      else failed++
    }
    stats.value = { queued, processing, complete, failed }
  }

  // ─── Init (called by QueueSidebar on mount) ───────────────────
  async function init() {
    if (import.meta.server) return
    await refresh()
  }

  return {
    items: readonly(items), stats: readonly(stats), loading: readonly(loading), error: readonly(error),
    hasActive, totalActive, totalItems, queuedItems, processingItems, completedItems, failedItems,
    refresh, submitAndTrack, cancel, cancelAll, dismiss, deleteItem, deleteAll, clearCompleted, startPolling, stopPolling, init,
  }
}
