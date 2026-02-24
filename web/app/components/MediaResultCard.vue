<script setup lang="ts">
defineProps<{
  item: {
    id: string
    url: string | null
    status: string
    type: string
  }
  index: number
  actionLoading?: Record<string, boolean>
}>()

defineEmits<{
  click: []
  video: [id: string]
  audio: [id: string]
  upscale: [id: string]
}>()
</script>

<template>
  <!-- Completed image -->
  <div
    v-if="item.url && item.status === 'complete' && item.type === 'image'"
    class="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 hover:border-violet-300 transition-all cursor-pointer shadow-sm hover:shadow-md"
    @click="$emit('click')"
  >
    <NuxtImg :src="item.url" alt="Generated" width="512" class="w-full h-full object-cover" loading="lazy" />
    <div class="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
    <div class="absolute bottom-0 left-0 right-0 p-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-lucide-film"
        class="flex-1 backdrop-blur-sm"
        :loading="actionLoading?.[`video-${item.id}`]"
        @click.stop="$emit('video', item.id)"
      >
        Video
      </UButton>
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-lucide-music"
        class="flex-1 backdrop-blur-sm"
        :loading="actionLoading?.[`audio-${item.id}`]"
        @click.stop="$emit('audio', item.id)"
      >
        Audio
      </UButton>
    </div>
    <UBadge size="xs" variant="subtle" color="neutral" class="absolute top-2 left-2">
      {{ index + 1 }}
    </UBadge>
  </div>

  <!-- Completed video -->
  <div
    v-else-if="item.url && item.status === 'complete' && item.type === 'video'"
    class="group relative aspect-square rounded-xl overflow-hidden border border-cyan-200 hover:border-cyan-400 transition-all cursor-pointer shadow-sm hover:shadow-md bg-slate-900"
    @click="$emit('click')"
  >
    <video
      :src="item.url + '#t=0.1'"
      class="w-full h-full object-cover"
      muted loop playsinline
      preload="none"
      @mouseenter="($event.target as HTMLVideoElement).play()"
      @mouseleave="($event.target as HTMLVideoElement).pause()"
    />
    <div class="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
    <div class="absolute bottom-0 left-0 right-0 p-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-sparkles" class="flex-1 backdrop-blur-sm"
        :loading="actionLoading?.[`upscale-${item.id}`]" @click.stop="$emit('upscale', item.id)">Enhance</UButton>
    </div>
    <div class="absolute top-2 left-2 flex items-center gap-1.5">
      <UBadge size="xs" variant="subtle" color="neutral">{{ index + 1 }}</UBadge>
      <UBadge size="xs" variant="soft" color="info" icon="i-lucide-film">Video</UBadge>
    </div>
  </div>

  <!-- Failed -->
  <div v-else-if="item.status === 'failed'" class="aspect-square rounded-xl border border-red-200 bg-red-50/50 flex flex-col items-center justify-center gap-2">
    <UIcon name="i-lucide-circle-x" class="w-6 h-6 text-red-300" />
    <p class="text-[10px] text-red-400 font-medium">Failed</p>
  </div>

  <!-- Loading -->
  <div v-else class="aspect-square rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2">
    <div class="w-6 h-6 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
    <p class="text-[10px] text-slate-400">{{ item.type === 'video' ? 'Generating video…' : 'Generating…' }}</p>
  </div>
</template>
