<script setup lang="ts">
export interface LightboxItem {
  id: string
  url: string
  type: string
  prompt?: string
  settings?: Record<string, any> | null
  createdAt?: string
}

const props = defineProps<{
  items: LightboxItem[]
}>()

const open = defineModel<boolean>('open', { default: false })
const index = defineModel<number>('index', { default: 0 })

const currentItem = computed(() => props.items[index.value] ?? null)

function next() {
  if (index.value < props.items.length - 1) index.value++
}

function prev() {
  if (index.value > 0) index.value--
}

function close() {
  open.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'Escape') close()
}

onMounted(() => {
  if (import.meta.client) window.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  if (import.meta.client) window.removeEventListener('keydown', handleKeydown)
})

function download() {
  if (!currentItem.value) return
  const ext = currentItem.value.type === 'video' ? 'mp4' : 'png'
  const a = document.createElement('a')
  a.href = currentItem.value.url
  a.download = `media-${index.value + 1}.${ext}`
  a.click()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open && currentItem"
        class="fixed inset-0 z-100 flex items-center justify-center bg-black/95 backdrop-blur-md"
        @click.self="close"
      >
        <!-- Close -->
        <UButton
          variant="ghost"
          color="neutral"
          icon="i-lucide-x"
          size="lg"
          class="absolute top-4 right-4 text-white/50 hover:text-white z-10"
          @click="close"
        />

        <!-- Counter -->
        <UBadge variant="subtle" color="neutral" class="absolute top-4 left-4">
          {{ index + 1 }} / {{ items.length }}
        </UBadge>

        <!-- Prev -->
        <UButton
          v-if="index > 0"
          variant="ghost"
          color="neutral"
          icon="i-lucide-chevron-left"
          size="xl"
          class="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
          @click="prev"
        />

        <!-- Next -->
        <UButton
          v-if="index < items.length - 1"
          variant="ghost"
          color="neutral"
          icon="i-lucide-chevron-right"
          size="xl"
          class="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
          @click="next"
        />

        <!-- Media -->
        <div class="max-w-[90vw] max-h-[85vh] relative">
          <video
            v-if="currentItem.type === 'video'"
            :src="currentItem.url"
            :key="currentItem.id"
            class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            controls autoplay loop
          />
          <img
            v-else
            :src="currentItem.url"
            :key="currentItem.id"
            alt="Generated"
            class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          />
        </div>

        <!-- Bottom toolbar -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white/10 backdrop-blur-md">
          <UButton
            variant="ghost"
            size="xs"
            icon="i-lucide-download"
            class="text-white/60 hover:text-white"
            @click="download"
          >
            Download
          </UButton>
          <!-- Page-specific actions -->
          <slot name="toolbar" :item="currentItem" :index="index" />
        </div>

        <!-- Extra panels (e.g., info) -->
        <slot name="panel" :item="currentItem" :index="index" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
