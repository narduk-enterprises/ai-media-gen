import type { GenerationResult, MediaItemResult } from '~/types/gallery'

const PAGE_SIZE = 25

/**
 * Gallery composable — client-only fetch.
 *
 * Fetches all generations (with completed media) in a single request,
 * ordered newest-first. Infinite scroll loads more pages.
 */
export function useGallery() {
  const generations = ref<GenerationResult[]>([])
  const total = ref(0)
  const pending = ref(true)
  const loadingMore = ref(false)
  const error = ref<Error | null>(null)

  const hasMore = computed(() => generations.value.length < total.value)

  async function fetchGenerations() {
    pending.value = true
    error.value = null
    try {
      const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
        params: { limit: PAGE_SIZE, offset: 0 },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      generations.value = result.generations ?? []
      total.value = result.total ?? 0
    } catch (e: any) {
      error.value = e
    } finally {
      pending.value = false
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
        params: { limit: PAGE_SIZE, offset: generations.value.length },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      // Deduplicate in case items shifted between pages
      const existingIds = new Set(generations.value.map(g => g.id))
      const newGens = (result.generations ?? []).filter(g => !existingIds.has(g.id))
      generations.value = [...generations.value, ...newGens]
      total.value = result.total ?? total.value
    } catch (e: any) {
      error.value = e
    } finally {
      loadingMore.value = false
    }
  }

  // Fetch on mount — fresh data every page visit
  if (import.meta.client) {
    onMounted(() => fetchGenerations())
  }

  return { generations, total, pending, loadingMore, hasMore, error, refresh: fetchGenerations, loadMore }
}

/** Return up to 4 media thumbnails (images and videos) for a generation. */
export function thumbnails(gen: GenerationResult): MediaItemResult[] {
  return gen.items
    .filter(i => (i.type === 'image' || i.type === 'video') && i.url)
    .slice(0, 4)
}

/** Human-friendly relative date string. */
export function formatDate(dateStr: string): string {
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
