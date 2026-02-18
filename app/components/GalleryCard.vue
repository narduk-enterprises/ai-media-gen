<script setup lang="ts">
import type { GenerationResult } from '~/types/gallery'
import { thumbnails, formatDate } from '~/composables/useGallery'

const props = defineProps<{
  generation: GenerationResult
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const thumbs = computed(() => thumbnails(props.generation))
const emptySlots = computed(() =>
  Math.max(0, thumbs.value.length === 1 ? 0 : 4 - thumbs.value.length)
)
</script>

<template>
  <UCard
    variant="subtle"
    class="overflow-hidden hover:border-violet-500/20 transition-all cursor-pointer group"
    :ui="{ header: 'p-0', body: 'p-4' }"
    @click="emit('select', generation.id)"
  >
    <template #header>
      <div class="relative">
        <!-- Thumbnail grid -->
        <div class="grid grid-cols-2 gap-0.5">
          <div
            v-for="thumb in thumbs"
            :key="thumb.id"
            class="aspect-square overflow-hidden relative"
            :class="{
              'col-span-2 row-span-2': thumbs.length === 1,
            }"
          >
            <video
              v-if="thumb.type === 'video'"
              :src="thumb.url!"
              muted
              preload="metadata"
              class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <NuxtImg
              v-else
              :src="thumb.url!"
              :alt="generation.prompt"
              width="400"
              class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
            <div v-if="thumb.type === 'video'" class="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/50 text-white text-[8px] flex items-center gap-0.5 backdrop-blur-sm">
              <UIcon name="i-heroicons-play" class="w-2.5 h-2.5" />
            </div>
          </div>
          <!-- Fill empty slots -->
          <div
            v-for="i in emptySlots"
            :key="`empty-${i}`"
            class="aspect-square bg-slate-100"
          />
        </div>

        <!-- Count badge -->
        <UBadge
          v-if="generation.imageCount > 4"
          color="neutral"
          variant="subtle"
          size="xs"
          class="absolute top-2 right-2 backdrop-blur-sm"
        >
          +{{ generation.imageCount - 4 }} more
        </UBadge>

        <!-- Status badge -->
        <UBadge
          v-if="generation.status !== 'complete'"
          :color="generation.status === 'processing' ? 'warning' : 'error'"
          variant="subtle"
          size="xs"
          class="absolute bottom-2 left-2 backdrop-blur-sm"
        >
          {{ generation.status }}
        </UBadge>
      </div>
    </template>

    <!-- Info -->
    <p class="text-sm text-slate-700 line-clamp-2 mb-2">{{ generation.prompt }}</p>
    <div class="flex items-center justify-between">
      <span class="text-[11px] text-slate-500">{{ formatDate(generation.createdAt) }}</span>
      <span class="text-[11px] text-slate-500">
        {{ generation.imageCount }} item{{ generation.imageCount !== 1 ? 's' : '' }}
      </span>
    </div>
  </UCard>
</template>
