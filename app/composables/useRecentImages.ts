/**
 * Shared composable for fetching recent images from the gallery.
 * Used by CreateAutoVideoTab, CreateImageToVideoTab, and VideoSettingsModal.
 */
export function useRecentImages(limit = 20) {
  const images = ref<{ id: string; url: string; prompt: string }[]>([])
  const loading = ref(false)

  async function fetch() {
    loading.value = true
    try {
      const data = await $fetch<{ generations: { items: { id: string; url: string | null; type: string; status: string; prompt: string | null }[] }[] }>('/api/generations', {
        params: { limit: 50, type: 'image' },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      const result: { id: string; url: string; prompt: string }[] = []
      for (const gen of data.generations ?? []) {
        for (const item of gen.items) {
          if (item.type === 'image' && item.status === 'complete' && item.url) {
            result.push({ id: item.id, url: item.url, prompt: item.prompt || '' })
            if (result.length >= limit) break
          }
        }
        if (result.length >= limit) break
      }
      images.value = result
    } catch {}
    loading.value = false
  }

  return { images, loading, fetch }
}
