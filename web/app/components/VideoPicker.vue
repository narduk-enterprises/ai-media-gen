<script setup lang="ts">
/**
 * Reusable image picker with recent images grid + drag-and-drop upload.
 * Supports single-select (default) or multi-select mode.
 */
const props = withDefaults(defineProps<{
  showUpload?: boolean
  label?: string
  pageSize?: number
  multi?: boolean
}>(), {
  showUpload: true,
  label: 'Select a video',
  pageSize: 20,
  multi: false,
})

const emit = defineEmits<{
  select: [payload: { mediaItemId?: string; base64?: string; url: string }]
  'update:selected': [ids: string[]]
  clear: []
}>()

const { videos, loading: loadingVideos, hasMore, fetch: fetchVideos, loadMore } = useRecentVideos(props.pageSize)
const selectedId = ref<string | null>(null)
const selectedIds = ref<Set<string>>(new Set())
const uploadPreview = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const previewUrl = computed(() => {
  if (selectedId.value) return videos.value.find((i: any) => i.id === selectedId.value)?.url || ''
  return uploadPreview.value
})

const selectedCount = computed(() => selectedIds.value.size)

onMounted(() => { if (videos.value.length === 0) fetchVideos() })

function selectVideo(vid: { id: string; url: string }) {
  if (props.multi) {
    const ids = new Set<string>(selectedIds.value)
    if (ids.has(vid.id)) {
      ids.delete(vid.id)
    } else {
      ids.add(vid.id)
    }
    selectedIds.value = ids
    emit('update:selected', Array.from(ids))
  } else {
    selectedId.value = vid.id
    uploadPreview.value = ''
    emit('select', { mediaItemId: vid.id, url: vid.url })
  }
}

function selectAll() {
  const ids = new Set<string>(videos.value.map((i: any) => i.id))
  selectedIds.value = ids
  emit('update:selected', Array.from(ids))
}

function selectNone() {
  selectedIds.value = new Set()
  emit('update:selected', [])
}

function isSelected(id: string) {
  return props.multi ? selectedIds.value.has(id) : selectedId.value === id
}

function onFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file?.type.startsWith('video/')) readFile(file)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]
  if (file?.type.startsWith('video/')) readFile(file)
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
  selectedIds.value = new Set()
  uploadPreview.value = ''
  emit('clear')
  emit('update:selected', [])
}

defineExpose({ previewUrl, selectedId, selectedIds, selectedCount, clear })
</script>

<template>
  <div class="space-y-3">
    <!-- Preview of selected image (single mode only) -->
    <div v-if="!multi && previewUrl" class="flex items-center gap-3 p-2 rounded-lg bg-primary-50 border border-primary-200">
      <video :src="previewUrl + '#t=0.1'" class="w-14 h-14 rounded-lg object-cover shrink-0 border border-primary-200" muted playsinline />
      <div class="flex-1 min-w-0">
        <p class="text-[10px] text-primary-600">Selected ✓</p>
      </div>
      <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="xs" @click="clear" />
    </div>

    <!-- Multi-select count badge -->
    <div v-if="multi && selectedCount > 0" class="flex items-center gap-2 p-2 rounded-lg bg-primary-50 border border-primary-200">
      <UIcon name="i-lucide-film" class="w-4 h-4 text-primary-500" />
      <span class="text-sm font-medium text-primary-700">{{ selectedCount }} video{{ selectedCount !== 1 ? 's' : '' }} selected</span>
      <UButton size="xs" variant="ghost" color="neutral" @click="selectNone">Clear</UButton>
    </div>

    <!-- Upload area (single mode only) -->
    <div v-if="showUpload && !multi && !previewUrl"
      class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/20 transition-colors"
      @dragover.prevent @drop="onDrop" @click="fileInput?.click()">
      <UIcon name="i-lucide-film" class="w-8 h-8 text-gray-400 mx-auto mb-2" />
      <p class="text-sm text-gray-600">Drop a video or click to upload</p>
      <input ref="fileInput" type="file" accept="video/*" class="hidden" @change="onFileSelect" />
    </div>

    <!-- Recent images grid -->
    <section>
      <div class="flex items-center justify-between mb-2">
        <label class="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{{ label }}</label>
        <div class="flex items-center gap-1">
          <UButton v-if="multi" size="xs" variant="ghost" color="primary" @click="selectAll">All</UButton>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="loadingVideos" @click="fetchVideos" />
        </div>
      </div>
      <div v-if="loadingVideos && videos.length === 0" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div v-for="i in 6" :key="i" class="aspect-square rounded-lg bg-gray-100 animate-pulse" />
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button v-for="vid in videos" :key="vid.id"
          class="relative aspect-square rounded-lg overflow-hidden border-2 transition-all bg-slate-900"
          :class="isSelected(vid.id) ? 'border-primary-400 ring-2 ring-primary-200' : 'border-transparent hover:border-gray-300'"
          @click="selectVideo(vid)">
          <video :src="vid.url + '#t=0.1'" class="w-full h-full object-cover" muted playsinline preload="metadata" />
          <div v-if="isSelected(vid.id)" class="absolute inset-0 bg-primary-400/20 flex items-center justify-center">
            <UIcon name="i-lucide-check" class="w-6 h-6 text-white drop-shadow-md" />
          </div>
        </button>
      </div>
      <!-- Load More -->
      <div v-if="hasMore && videos.length > 0" class="flex justify-center mt-3">
        <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-chevrons-down" :loading="loadingVideos" @click="loadMore">
          Load More
        </UButton>
      </div>
      <p v-if="!loadingVideos && videos.length === 0" class="text-xs text-gray-400 py-2">No videos found yet.</p>
    </section>
  </div>
</template>
