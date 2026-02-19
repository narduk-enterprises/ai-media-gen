<script setup lang="ts">
import type { GenerationResult } from '~/types/gallery'

const props = defineProps<{
  generation: GenerationResult | null
}>()

const emit = defineEmits<{
  close: []
}>()

const open = computed({
  get: () => props.generation !== null,
  set: (val: boolean) => { if (!val) emit('close') },
})

const mediaItems = computed(() =>
  props.generation?.items.filter(i => (i.type === 'image' || i.type === 'video') && i.url) ?? []
)

const otherItems = computed(() =>
  props.generation?.items.filter(i => i.type !== 'image' && i.type !== 'video') ?? []
)
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{
      content: 'max-w-4xl sm:max-w-4xl',
    }"
  >
    <template #content>
      <div v-if="generation" class="flex flex-col">
        <!-- Close button -->
        <div class="flex items-center justify-between p-4 border-b border-slate-200">
          <p class="text-sm text-slate-700 line-clamp-1 flex-1 mr-4">{{ generation.prompt }}</p>
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-heroicons-x-mark"
            size="sm"
            @click="emit('close')"
          />
        </div>

        <!-- Media carousel (images + videos) -->
        <div v-if="mediaItems.length" class="p-4">
          <UCarousel
            v-if="mediaItems.length > 1"
            :items="mediaItems"
            arrows
            dots
            :ui="{
              item: 'basis-full',
            }"
          >
            <template #default="{ item }">
              <div class="flex items-center justify-center w-full">
                <video
                  v-if="item.type === 'video'"
                  :src="item.url!"
                  controls
                  class="max-h-[70vh] w-auto rounded-lg object-contain"
                />
                <NuxtImg
                  v-else
                  :src="item.url!"
                  :alt="generation.prompt"
                  class="max-h-[70vh] w-auto rounded-lg object-contain"
                />
              </div>
            </template>
          </UCarousel>

          <!-- Single item (no carousel needed) -->
          <div v-else class="flex items-center justify-center">
            <video
              v-if="mediaItems[0]?.type === 'video'"
              :src="mediaItems[0]?.url ?? ''"
              controls
              class="max-h-[70vh] w-auto rounded-lg object-contain"
            />
            <NuxtImg
              v-else
              :src="mediaItems[0]?.url ?? ''"
              :alt="generation.prompt"
              class="max-h-[70vh] w-auto rounded-lg object-contain"
            />
          </div>
        </div>

        <!-- Audio / other items -->
        <div v-if="otherItems.length" class="px-4 pb-4 space-y-2">
          <div class="text-xs text-slate-500 uppercase tracking-wider mb-1">Other media</div>
          <div
            v-for="item in otherItems"
            :key="item.id"
            class="flex items-center gap-2 text-sm text-slate-600 p-2 rounded-lg bg-slate-50"
          >
            <UIcon
              name="i-heroicons-speaker-wave"
              class="w-4 h-4 shrink-0"
            />
            <span class="capitalize">{{ item.type }}</span>
            <UBadge
              :color="item.status === 'complete' ? 'success' : item.status === 'failed' ? 'error' : 'warning'"
              variant="subtle"
              size="xs"
            >
              {{ item.status }}
            </UBadge>
            <a
              v-if="item.url"
              :href="item.url"
              target="_blank"
              class="ml-auto text-violet-400 hover:text-violet-300 text-xs flex items-center gap-1"
            >
              Open
              <UIcon name="i-heroicons-arrow-top-right-on-square" class="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
