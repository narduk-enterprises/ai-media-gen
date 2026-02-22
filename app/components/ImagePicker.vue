<script setup lang="ts">
/**
 * Reusable image picker with recent images grid + drag-and-drop upload.
 * Emits the selected image's mediaItemId (for gallery images) or base64 (for uploads).
 */
const props = withDefaults(defineProps<{
  showUpload?: boolean
  label?: string
  pageSize?: number
}>(), {
  showUpload: true,
  label: 'Select an image',
  pageSize: 8,
})

const emit = defineEmits<{
  select: [payload: { mediaItemId?: string; base64?: string; url: string }]
  clear: []
}>()

const { images, loading: loadingImages, hasMore, fetch: fetchImages, loadMore } = useRecentImages(props.pageSize)
const selectedId = ref<string | null>(null)
const uploadPreview = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const previewUrl = computed(() => {
  if (selectedId.value) return images.value.find(i => i.id === selectedId.value)?.url || ''
  return uploadPreview.value
})

onMounted(() => { if (images.value.length === 0) fetchImages() })

function selectImage(img: { id: string; url: string }) {
  selectedId.value = img.id
  uploadPreview.value = ''
  emit('select', { mediaItemId: img.id, url: img.url })
}

function onFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file?.type.startsWith('image/')) readFile(file)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]
  if (file?.type.startsWith('image/')) readFile(file)
}

function readFile(file: File) {
  selectedId.value = null
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    uploadPreview.value = dataUrl
    const base64 = dataUrl.split(',')[1] || ''
    emit('select', { base64, url: dataUrl })
  }
  reader.readAsDataURL(file)
}

function clear() {
  selectedId.value = null
  uploadPreview.value = ''
  emit('clear')
}

defineExpose({ previewUrl, selectedId, clear })
</script>

<template>
  <div class="space-y-3">
    <!-- Preview of selected image -->
    <div v-if="previewUrl" class="flex items-center gap-3 p-2 rounded-lg bg-primary-50 border border-primary-200">
      <img :src="previewUrl" alt="" class="w-14 h-14 rounded-lg object-cover shrink-0 border border-primary-200" />
      <div class="flex-1 min-w-0">
        <p class="text-[10px] text-primary-600">Selected ✓</p>
      </div>
      <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="xs" @click="clear" />
    </div>

    <!-- Upload area -->
    <div v-if="showUpload && !previewUrl"
      class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/20 transition-colors"
      @dragover.prevent @drop="onDrop" @click="fileInput?.click()">
      <UIcon name="i-lucide-image-up" class="w-8 h-8 text-gray-400 mx-auto mb-2" />
      <p class="text-sm text-gray-600">Drop an image or click to upload</p>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelect" />
    </div>

    <!-- Recent images grid -->
    <section>
      <div class="flex items-center justify-between mb-2">
        <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{{ label }}</label>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="loadingImages" @click="fetchImages" />
      </div>
      <div v-if="loadingImages && images.length === 0" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        <div v-for="i in 8" :key="i" class="aspect-square rounded-lg bg-gray-100 animate-pulse" />
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        <button v-for="img in images" :key="img.id"
          class="relative aspect-square rounded-lg overflow-hidden border-2 transition-all"
          :class="selectedId === img.id ? 'border-primary-400 ring-2 ring-primary-200' : 'border-transparent hover:border-gray-300'"
          @click="selectImage(img)">
          <NuxtImg :src="img.url" :alt="img.prompt" width="180" class="w-full h-full object-cover" loading="lazy" />
          <div v-if="selectedId === img.id" class="absolute inset-0 bg-primary-400/20 flex items-center justify-center">
            <UIcon name="i-lucide-check" class="w-6 h-6 text-white drop-shadow-md" />
          </div>
        </button>
      </div>
      <!-- Load More -->
      <div v-if="hasMore && images.length > 0" class="flex justify-center mt-3">
        <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-chevrons-down" :loading="loadingImages" @click="loadMore">
          Load More
        </UButton>
      </div>
      <p v-if="!loadingImages && images.length === 0" class="text-xs text-gray-400 py-2">No images found yet.</p>
    </section>
  </div>
</template>
