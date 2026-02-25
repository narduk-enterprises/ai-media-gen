import type { GenerationResult, MediaItemResult } from '~/types/gallery'

const PAGE_SIZE = 20

/**
 * Gallery composable — fetches flat media items with generation context.
 * Paginated by media items (not generations) for exact control.
 */

export interface GalleryMediaItem {
  id: string
  type: string
  url: string
  generationId: string
  prompt: string
  generationPrompt: string
  settings: string | null
  createdAt: string
  submittedAt?: string | null
  completedAt?: string | null
  qualityScore?: number | null
  parentId?: string | null
  sweepId?: string | null
}

interface GalleryApiResponse {
  items: GalleryMediaItem[]
  total: number
  limit: number
  offset: number
}

export function useGallery(typeFilter?: Ref<string>) {
  const mediaItems = ref<GalleryMediaItem[]>([])
  const total = ref(0)
  const pending = ref(true)
  const loadingMore = ref(false)
  const error = ref<Error | null>(null)

  const hasMore = computed(() => mediaItems.value.length < total.value)

  async function fetchItems() {
    pending.value = true
    error.value = null
    try {
      const result = await $fetch<GalleryApiResponse>('/api/generations', {
        params: { limit: PAGE_SIZE, offset: 0, type: typeFilter?.value || 'all' },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      mediaItems.value = (result.items ?? []).filter(i => i.url) as GalleryMediaItem[]
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
      const result = await $fetch<GalleryApiResponse>('/api/generations', {
        params: { limit: PAGE_SIZE, offset: mediaItems.value.length, type: typeFilter?.value || 'all' },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      // Deduplicate in case items shifted between pages
      const existingIds = new Set(mediaItems.value.map(i => i.id))
      const newItems = (result.items ?? []).filter(i => i.url && !existingIds.has(i.id)) as GalleryMediaItem[]
      mediaItems.value = [...mediaItems.value, ...newItems]
      total.value = result.total ?? total.value
    } catch (e: any) {
      error.value = e
    } finally {
      loadingMore.value = false
    }
  }

  async function deleteItems(itemIds: string[]) {
    if (!itemIds.length) return
    try {
      await $fetch('/api/generate/delete', {
        method: 'POST',
        body: { itemIds },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      // Remove items locally
      const toDelete = new Set(itemIds)
      mediaItems.value = mediaItems.value.filter(item => !toDelete.has(item.id))
      total.value = Math.max(0, total.value - itemIds.length)
    } catch (e: any) {
      console.error('Failed to delete items:', e)
      throw e
    }
  }

  // Fetch on mount — fresh data every page visit
  if (import.meta.client) {
    onMounted(() => fetchItems())
  }

  return { mediaItems, total, pending, loadingMore, hasMore, error, refresh: fetchItems, loadMore, deleteItems }
}

/** Trigger a browser download for a media URL. */
export function downloadMedia(url: string, type: string = 'image') {
  const a = document.createElement('a')
  a.href = url
  a.download = `gallery.${type === 'video' ? 'mp4' : 'png'}`
  a.click()
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
