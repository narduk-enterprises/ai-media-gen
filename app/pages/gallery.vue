<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Gallery' })

interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
}

interface GenerationResult {
  id: string
  prompt: string
  imageCount: number
  status: string
  createdAt: string
  items: MediaItemResult[]
}

const { data, pending, error, refresh } = await useFetch<{ generations: GenerationResult[] }>('/api/generations', {
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
  default: () => ({ generations: [] }),
})

const generations = computed(() => data.value?.generations ?? [])

function thumbnails(gen: GenerationResult): MediaItemResult[] {
  return gen.items
    .filter(i => i.type === 'image' && i.url)
    .slice(0, 4)
}

function formatDate(dateStr: string): string {
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

// Expanded generation
const expandedId = ref<string | null>(null)

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <div class="flex items-center justify-between mb-8">
      <h1 class="font-display text-2xl sm:text-3xl font-bold">Your Gallery</h1>
      <UButton
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-path"
        :loading="pending"
        @click="refresh()"
      />
    </div>

    <!-- Loading -->
    <div v-if="pending && !generations.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div v-for="i in 6" :key="i" class="glass-card p-4">
        <div class="shimmer w-full aspect-video rounded-lg mb-3" />
        <div class="shimmer h-4 w-3/4 rounded mb-2" />
        <div class="shimmer h-3 w-1/4 rounded" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
      Failed to load gallery. <button class="underline" @click="refresh()">Retry</button>
    </div>

    <!-- Empty state -->
    <div v-else-if="!generations.length" class="text-center py-20">
      <div class="w-20 h-20 mx-auto rounded-2xl bg-violet-500/5 border border-violet-500/10 flex items-center justify-center mb-4">
        <UIcon name="i-heroicons-photo" class="w-10 h-10 text-violet-500/30" />
      </div>
      <p class="text-zinc-500 mb-4">No creations yet</p>
      <UButton to="/create">
        <template #leading>
          <UIcon name="i-heroicons-sparkles" />
        </template>
        Create your first image
      </UButton>
    </div>

    <!-- Gallery grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="gen in generations"
        :key="gen.id"
        class="glass-card overflow-hidden hover:border-violet-500/20 transition-all cursor-pointer"
        @click="toggleExpand(gen.id)"
      >
        <!-- Thumbnail grid -->
        <div class="relative">
          <div class="grid grid-cols-2 gap-0.5">
            <div
              v-for="(thumb, i) in thumbnails(gen)"
              :key="thumb.id"
              class="aspect-square"
              :class="{ 'col-span-2': thumbnails(gen).length === 1, 'row-span-2': thumbnails(gen).length === 1 }"
            >
              <img
                :src="thumb.url!"
                :alt="gen.prompt"
                class="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <!-- Fill empty slots -->
            <div
              v-for="i in Math.max(0, (thumbnails(gen).length === 1 ? 0 : 4 - thumbnails(gen).length))"
              :key="`empty-${i}`"
              class="aspect-square bg-zinc-900"
            />
          </div>

          <!-- Count badge -->
          <div v-if="gen.imageCount > 4" class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 text-[11px] font-medium text-zinc-300 backdrop-blur-sm">
            +{{ gen.imageCount - 4 }} more
          </div>

          <!-- Status badge -->
          <div v-if="gen.status !== 'complete'" class="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-medium backdrop-blur-sm"
            :class="{
              'bg-yellow-500/20 text-yellow-400': gen.status === 'processing',
              'bg-red-500/20 text-red-400': gen.status === 'failed',
            }"
          >
            {{ gen.status }}
          </div>
        </div>

        <!-- Info -->
        <div class="p-4">
          <p class="text-sm text-zinc-300 line-clamp-2 mb-2">{{ gen.prompt }}</p>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-zinc-600">{{ formatDate(gen.createdAt) }}</span>
            <span class="text-[11px] text-zinc-500">{{ gen.imageCount }} image{{ gen.imageCount !== 1 ? 's' : '' }}</span>
          </div>
        </div>

        <!-- Expanded view -->
        <Transition name="slide-down">
          <div v-if="expandedId === gen.id" class="border-t border-zinc-800/50 p-4" @click.stop>
            <div class="grid grid-cols-3 gap-2">
              <div
                v-for="item in gen.items.filter(i => i.type === 'image' && i.url)"
                :key="item.id"
                class="aspect-square rounded-lg overflow-hidden"
              >
                <img :src="item.url!" :alt="gen.prompt" class="w-full h-full object-cover" />
              </div>
            </div>
            <!-- Videos/Audio -->
            <div v-if="gen.items.some(i => i.type !== 'image')" class="mt-3 space-y-2">
              <div
                v-for="item in gen.items.filter(i => i.type !== 'image')"
                :key="item.id"
                class="flex items-center gap-2 text-xs text-zinc-400"
              >
                <span>{{ item.type === 'video' ? '🎬' : '🔊' }}</span>
                <span class="capitalize">{{ item.type }}</span>
                <span class="text-zinc-600">— {{ item.status }}</span>
                <a
                  v-if="item.url"
                  :href="item.url"
                  target="_blank"
                  class="ml-auto text-violet-400 hover:text-violet-300"
                >
                  Open ↗
                </a>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
