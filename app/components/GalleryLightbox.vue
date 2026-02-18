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

const images = computed(() =>
  props.generation?.items.filter(i => i.type === 'image' && i.url) ?? []
)

const nonImageItems = computed(() =>
  props.generation?.items.filter(i => i.type !== 'image') ?? []
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

        <!-- Image carousel -->
        <div v-if="images.length" class="p-4">
          <UCarousel
            v-if="images.length > 1"
            :items="images"
            arrows
            dots
            :ui="{
              item: 'basis-full',
            }"
          >
            <template #default="{ item }">
              <div class="flex items-center justify-center w-full">
                <NuxtImg
                  :src="item.url!"
                  :alt="generation.prompt"
                  class="max-h-[70vh] w-auto rounded-lg object-contain"
                />
              </div>
            </template>
          </UCarousel>

          <!-- Single image (no carousel needed) -->
          <div v-else class="flex items-center justify-center">
            <NuxtImg
              :src="images[0].url!"
              :alt="generation.prompt"
              class="max-h-[70vh] w-auto rounded-lg object-contain"
            />
          </div>
        </div>

        <!-- Video / Audio items -->
        <div v-if="nonImageItems.length" class="px-4 pb-4 space-y-2">
          <div class="text-xs text-slate-500 uppercase tracking-wider mb-1">Other media</div>
          <div
            v-for="item in nonImageItems"
            :key="item.id"
            class="flex items-center gap-2 text-sm text-slate-600 p-2 rounded-lg bg-slate-50"
          >
            <UIcon
              :name="item.type === 'video' ? 'i-heroicons-film' : 'i-heroicons-speaker-wave'"
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
