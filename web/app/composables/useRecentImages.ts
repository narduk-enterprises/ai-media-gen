/**
 * Shared composable for fetching recent images from the gallery.
 * Supports paginated loading: initial fetch + loadMore for additional batches.
 *
 * Uses the flat media-item pagination from GET /api/generations?type=image.
 */
export function useRecentImages(pageSize = 20) {
  const images = ref<{ id: string; url: string; prompt: string }[]>([])
  const loading = ref(false)
  const hasMore = ref(true)
  let currentOffset = 0

  async function fetchPage() {
    const data = await $fetch<{
      items: { id: string; url: string | null; type: string; status: string; prompt: string | null }[]
      total: number
      limit: number
      offset: number
    }>('/api/generations', {
      params: { limit: pageSize, offset: currentOffset, type: 'image' },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    const result: { id: string; url: string; prompt: string }[] = []
    for (const item of data.items) {
      if (item.url) {
        result.push({ id: item.id, url: item.url, prompt: item.prompt || '' })
      }
    }

    currentOffset += data.items.length
    if (data.items.length < pageSize || currentOffset >= data.total) {
      hasMore.value = false
    }

    return result
  }

  async function fetch() {
    loading.value = true
    currentOffset = 0
    hasMore.value = true
    try {
      const result = await fetchPage()
      images.value = result
    } catch {}
    loading.value = false
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    loading.value = true
    try {
      const result = await fetchPage()
      images.value = [...images.value, ...result]
    } catch {}
    loading.value = false
  }

  return { images, loading, hasMore, fetch, loadMore }
}
