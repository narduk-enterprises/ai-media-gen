import type { GenerationResult, MediaItemResult } from '~/types/gallery'

const PAGE_SIZE = 50

/**
 * Gallery composable — SSR-safe.
 *
 * Uses useAsyncData with server:false so Nuxt knows to skip SSR
 * data and fetch client-side without hydration mismatches.
 */
export function useGallery() {
  const loadingMore = ref(false)
  const generationsData = useState<GenerationResult[]>('gallery-generations', () => [])
  const totalCount = useState<number>('gallery-total', () => 0)

  const { pending, error, refresh } = useAsyncData(
    'gallery-data',
    async () => {
      const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
        params: { limit: PAGE_SIZE, offset: 0 },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      generationsData.value = result.generations ?? []
      totalCount.value = result.total ?? 0
      return true
    },
    {
      server: false,
      lazy: true,
    }
  )

  const hasMore = computed(() => generationsData.value.length < totalCount.value)

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const result = await $fetch<{ generations: GenerationResult[]; total: number }>('/api/generations', {
        params: { limit: PAGE_SIZE, offset: generationsData.value.length },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      generationsData.value = [...generationsData.value, ...(result.generations ?? [])]
      totalCount.value = result.total ?? totalCount.value
    } catch (e: any) {
      // error is handled by the caller
    } finally {
      loadingMore.value = false
    }
  }

  return {
    generations: generationsData,
    total: totalCount,
    pending,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
  }
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
