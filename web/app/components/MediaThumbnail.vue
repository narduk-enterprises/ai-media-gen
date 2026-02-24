<script setup lang="ts">
defineProps<{
  url: string
  type: string
  prompt?: string
  date?: string
  width?: string | number
  showOverlay?: boolean
  showActions?: boolean
}>()

defineEmits<{
  click: []
  reimagine: []
  video: []
  download: []
}>()
</script>

<template>
  <div
    class="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-slate-200 hover:border-violet-300 transition-all shadow-sm hover:shadow-md"
    @click="$emit('click')"
  >
    <!-- Media -->
    <video
      v-if="type === 'video'"
      :src="url + '#t=0.1'"
      muted
      preload="none"
      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
      @mouseenter="($event.target as HTMLVideoElement).play()"
      @mouseleave="($event.target as HTMLVideoElement).pause()"
    />
    <NuxtImg
      v-else
      :src="url"
      :alt="prompt"
      :width="width || 400"
      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
      loading="lazy"
    />

    <!-- Video badge -->
    <div
      v-if="type === 'video'"
      class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px] flex items-center gap-1 backdrop-blur-sm"
    >
      <UIcon name="i-lucide-play" class="w-3 h-3" /> Video
    </div>

    <!-- Hover overlay -->
    <div
      v-if="showOverlay"
      class="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"
    >
      <div class="absolute bottom-0 left-0 right-0 p-2.5 pointer-events-none">
        <p class="text-white text-[10px] line-clamp-2 leading-relaxed">{{ prompt }}</p>
        <p v-if="date" class="text-white/50 text-[9px] mt-0.5">{{ date }}</p>
      </div>
    </div>

    <!-- Action buttons -->
    <div
      v-if="showActions"
      class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
