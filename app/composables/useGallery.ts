import type { GenerationResult, MediaItemResult } from '~/types/gallery'

const PAGE_SIZE = 20

/**
 * Gallery composable — simple client-only fetch.
 *
 * Fetches images and videos as two separate requests so that images
 * always load even when the most recent 1000 generations are videos.
 * Results are merged and deduplicated by generation ID.
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
      // Fetch images and videos in parallel so both types always appear
      const [imageResult, videoResult] = await Promise.all([
        $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
          params: { limit: PAGE_SIZE, offset: 0, type: 'image' },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        }),
        $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
          params: { limit: PAGE_SIZE, offset: 0, type: 'video' },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        }),
      ])

      // Merge and deduplicate by generation ID, sort newest first
      const merged = new Map<string, GenerationResult>()
      for (const gen of [...(imageResult.generations ?? []), ...(videoResult.generations ?? [])]) {
        const existing = merged.get(gen.id)
        if (existing) {
          // Merge items from both fetches (a generation can have both images and videos)
          const existingIds = new Set(existing.items.map(i => i.id))
          const newItems = gen.items.filter(i => !existingIds.has(i.id))
          existing.items = [...existing.items, ...newItems]
        } else {
          merged.set(gen.id, { ...gen })
        }
      }

      // Sort by createdAt descending
      const sorted = Array.from(merged.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )

      generations.value = sorted
      total.value = Math.max(imageResult.total ?? 0, videoResult.total ?? 0, sorted.length)
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
      generations.value = [...generations.value, ...(result.generations ?? [])]
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
