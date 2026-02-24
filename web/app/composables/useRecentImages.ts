/**
 * Shared composable for fetching recent images from the gallery.
 * Supports paginated loading: initial fetch + loadMore for additional batches.
 */
export function useRecentImages(pageSize = 20) {
  const images = ref<{ id: string; url: string; prompt: string }[]>([])
  const loading = ref(false)
  const hasMore = ref(true)
  const seenIds = new Set<string>()
  // Track how many generations we've consumed (API offset is by generation, not item)
  let generationsConsumed = 0

  async function fetchPage() {
    // Fetch enough generations to hopefully fill `pageSize` images
    const fetchLimit = Math.max(50, pageSize * 3)
    const data = await $fetch<{ generations: { items: { id: string; url: string | null; type: string; status: string; prompt: string | null }[] }[]; total: number }>('/api/generations', {
      params: { limit: fetchLimit, offset: generationsConsumed, type: 'image' },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    const result: { id: string; url: string; prompt: string }[] = []
    const gens = data.generations ?? []
    generationsConsumed += gens.length

    for (const gen of gens) {
      for (const item of gen.items) {
        if (item.type === 'image' && item.url && !seenIds.has(item.id)) {
          seenIds.add(item.id)
          result.push({ id: item.id, url: item.url, prompt: item.prompt || '' })
          if (result.length >= pageSize) break
        }
      }
      if (result.length >= pageSize) break
    }

    // If we got fewer than pageSize or consumed all generations, there's no more
    if (result.length < pageSize || gens.length < fetchLimit) hasMore.value = false

    return result
  }

  async function fetch() {
    loading.value = true
    seenIds.clear()
    generationsConsumed = 0
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
