<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Gallery' })

const { generations, pending, error, refresh } = useGallery()

const selectedGenId = ref<string | null>(null)
const selectedGen = computed(() =>
  generations.value.find(g => g.id === selectedGenId.value) ?? null
)
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <!-- Header -->
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
    <GallerySkeletonGrid v-if="pending && !generations.length" />

    <!-- Error -->
    <div v-else-if="error" class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
      Failed to load gallery. <button class="underline" @click="refresh()">Retry</button>
    </div>

    <!-- Empty state -->
    <GalleryEmptyState v-else-if="!generations.length" />

    <!-- Gallery grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <GalleryCard
        v-for="gen in generations"
        :key="gen.id"
        :generation="gen"
        @select="selectedGenId = gen.id"
      />
    </div>

    <!-- Lightbox -->
    <GalleryLightbox
      :generation="selectedGen"
      @close="selectedGenId = null"
    />
  </div>
</template>
