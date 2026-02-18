import type { GenerationResult, MediaItemResult } from '~/types/gallery'

export function useGallery() {
  const loading = ref(true)
  const generations = ref<GenerationResult[]>([])
  const error = ref<Error | null>(null)

  async function fetchGenerations() {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ generations: GenerationResult[] }>('/api/generations', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      generations.value = result.generations ?? []
    } catch (e: any) {
      error.value = e
    } finally {
      loading.value = false
    }
  }

  if (import.meta.client) {
    fetchGenerations()
  }

  return { generations, pending: loading, error, refresh: fetchGenerations }
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
