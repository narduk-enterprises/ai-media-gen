<script setup lang="ts">
import type { GenerationResult, MediaItemResult } from '~/types/gallery'
import { formatDate } from '~/composables/useGallery'

defineProps<{
  generations: GenerationResult[]
  expandedGenerations: Set<string>
  actionLoading: Record<string, boolean>
  filteredMedia: any[]
}>()

const emit = defineEmits<{
  toggle: [id: string]
  openLightbox: [index: number]
  openVideoModal: [id: string]
  openReimagine: [id: string]
  upscale: [id: string]
  downloadMedia: [url: string, index: number, type: string]
  copyPrompt: [text: string]
  recreate: [prompt: string]
}>()

function generationMedia(gen: GenerationResult): MediaItemResult[] {
  if (!gen?.items) return []
  return gen.items.filter((r: MediaItemResult) =>
    (r.type === 'image' || r.type === 'video') && r.url
  )
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="gen in generations" :key="gen.id" class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors" @click="emit('toggle', gen.id)">
        <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-slate-200">
          <video v-if="generationMedia(gen)[0]?.type === 'video' && generationMedia(gen)[0]?.url" :src="generationMedia(gen)[0]!.url! + '#t=0.1'" muted preload="metadata" class="w-full h-full object-cover" />
          <NuxtImg v-else-if="generationMedia(gen)[0]?.url" :src="generationMedia(gen)[0]!.url!" alt="" width="80" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full bg-slate-100" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-slate-700 line-clamp-1">{{ gen.prompt }}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[10px] text-slate-400">{{ formatDate(gen.createdAt) }}</span>
            <span class="text-[10px] text-slate-300">·</span>
            <span class="text-[10px] text-slate-400">{{ generationMedia(gen).length }} item{{ generationMedia(gen).length !== 1 ? 's' : '' }}</span>
            <UBadge v-if="gen.status !== 'complete'" :color="gen.status === 'processing' || gen.status === 'queued' ? 'warning' : 'error'" variant="subtle" size="xs">{{ gen.status }}</UBadge>
            <UBadge v-if="gen.id.startsWith('sweep-')" color="warning" variant="subtle" size="xs">
              <UIcon name="i-lucide-test-tubes" class="w-2.5 h-2.5 mr-0.5" />Sweep · {{ parseSettings(gen.settings)?.sweepVariants ?? '?' }} variants
            </UBadge>
          </div>
        </div>
        <NuxtLink v-if="gen.id.startsWith('sweep-')" :to="`/sweep/${parseSettings(gen.settings)?.sweepId}`" class="text-[10px] text-amber-600 hover:text-amber-800 flex items-center gap-0.5 shrink-0 mr-2" @click.stop>
          <UIcon name="i-lucide-sliders-horizontal" class="w-3 h-3" />Compare
        </NuxtLink>
        <UIcon :name="expandedGenerations.has(gen.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      <div v-if="expandedGenerations.has(gen.id)" class="px-4 pb-3 border-t border-slate-100">
        <div v-if="gen.settings" class="py-2 flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
          <template v-if="parseSettings(gen.settings)">
            <span>{{ parseSettings(gen.settings)?.width }}×{{ parseSettings(gen.settings)?.height }}</span>
            <span class="text-slate-200">·</span>
            <span>{{ parseSettings(gen.settings)?.steps }} steps</span>
            <template v-if="parseSettings(gen.settings)?.attributes">
              <span class="text-slate-200">·</span>
              <span v-for="(val, key) in parseSettings(gen.settings)?.attributes" :key="String(key)" class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{{ key }}: {{ val }}</span>
            </template>
          </template>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 mt-1">
          <MediaThumbnail
            v-for="item in generationMedia(gen)" :key="item.id"
            :url="item.url!" :type="item.type" :prompt="item.prompt || ''" :width="300"
            show-actions
            @click="emit('openLightbox', filteredMedia.findIndex(i => i.id === item.id))"
          >
            <template #actions>
              <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-image-plus"
                @click.stop="emit('openReimagine', item.id)" title="Reimagine" />
              <UButton v-if="item.type === 'image' || item.type === 'video'" size="xs" variant="soft" color="neutral" icon="i-lucide-sparkles"
                :loading="actionLoading[`upscale-${item.id}`]" @click.stop="emit('upscale', item.id)" title="Enhance 2x" />
              <UButton v-if="item.type === 'image'" size="xs" variant="soft" color="neutral" icon="i-lucide-film"
                :loading="actionLoading[`video-${item.id}`]" @click.stop="emit('openVideoModal', item.id)" title="Animate" />
              <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-download" @click.stop="emit('downloadMedia', item.url!, 0, item.type)" />
            </template>
          </MediaThumbnail>
        </div>

        <div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
          <UButton variant="link" size="xs" color="neutral" icon="i-lucide-clipboard-copy" @click="emit('copyPrompt', gen.prompt)">Copy prompt</UButton>
          <UButton variant="link" size="xs" color="neutral" icon="i-lucide-refresh-cw" @click="emit('recreate', gen.prompt)">Recreate</UButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
function parseSettings(settingsJson: string | null | undefined): Record<string, any> | null {
  if (!settingsJson) return null
  try { return JSON.parse(settingsJson) } catch { return null }
}
</script>
