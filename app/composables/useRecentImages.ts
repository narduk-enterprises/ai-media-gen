/**
 * Shared composable for fetching recent images from the gallery.
 * Supports paginated loading: initial fetch + loadMore for additional batches.
 */
export function useRecentImages(pageSize = 20) {
  const images = ref<{ id: string; url: string; prompt: string }[]>([])
  const loading = ref(false)
  const hasMore = ref(true)
  const seenIds = new Set<string>()

  async function fetchPage(offset: number) {
    // Fetch enough generations to hopefully fill `pageSize` images
    const data = await $fetch<{ generations: { items: { id: string; url: string | null; type: string; status: string; prompt: string | null }[] }[] }>('/api/generations', {
      params: { limit: Math.max(50, pageSize * 3), offset, type: 'image' },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    const result: { id: string; url: string; prompt: string }[] = []
    const gens = data.generations ?? []

    for (const gen of gens) {
      for (const item of gen.items) {
        if (item.type === 'image' && item.status === 'complete' && item.url && !seenIds.has(item.id)) {
          seenIds.add(item.id)
          result.push({ id: item.id, url: item.url, prompt: item.prompt || '' })
          if (result.length >= pageSize) break
        }
      }
      if (result.length >= pageSize) break
    }

    // If we got fewer than pageSize, there's no more to load
    if (result.length < pageSize || gens.length === 0) hasMore.value = false

    return result
  }

  async function fetch() {
    loading.value = true
    seenIds.clear()
    try {
      const result = await fetchPage(0)
      images.value = result
    } catch {}
    loading.value = false
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    loading.value = true
    try {
      const result = await fetchPage(images.value.length)
      images.value = [...images.value, ...result]
    } catch {}
    loading.value = false
  }

  return { images, loading, hasMore, fetch, loadMore }
}
