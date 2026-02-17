<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Create' })

const prompt = ref('')
const negativePrompt = ref('ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts')
const imageCount = ref(1)
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const generating = ref(false)
const error = ref('')
const selectedImage = ref<MediaItemResult | null>(null)
const showAdvanced = ref(false)

interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
}

interface GenerationResult {
  generation: {
    id: string
    prompt: string
    imageCount: number
    status: string
    createdAt: string
  }
  items: MediaItemResult[]
}

const currentGeneration = ref<GenerationResult | null>(null)
const actionLoading = ref<Record<string, boolean>>({})

const countOptions = [1, 2, 4, 8, 16]
const sizeOptions = [
  { label: '512', value: 512 },
  { label: '768', value: 768 },
  { label: '1024', value: 1024 },
  { label: '1536', value: 1536 },
  { label: '2048', value: 2048 },
]

const images = computed(() =>
  currentGeneration.value?.items.filter(i => i.type === 'image') ?? []
)

const childMedia = computed(() => {
  const map: Record<string, MediaItemResult[]> = {}
  for (const item of currentGeneration.value?.items ?? []) {
    if (item.parentId) {
      if (!map[item.parentId]) map[item.parentId] = []
      map[item.parentId]!.push(item)
    }
  }
  return map
})

async function generate() {
  if (!prompt.value.trim()) return
  generating.value = true
  error.value = ''
  currentGeneration.value = null

  try {
    const result = await $fetch<GenerationResult>('/api/generate/image', {
      method: 'POST',
      body: { prompt: prompt.value, negativePrompt: negativePrompt.value, count: imageCount.value, steps: steps.value, width: imageWidth.value, height: imageHeight.value },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    currentGeneration.value = result
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Generation failed'
  } finally {
    generating.value = false
  }
}

async function makeVideo(mediaItemId: string) {
  actionLoading.value[`video-${mediaItemId}`] = true
  try {
    const result = await $fetch<{ item: MediaItemResult }>('/api/generate/video', {
      method: 'POST',
      body: { mediaItemId },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    // Add video to items list
    if (currentGeneration.value && result.item) {
      currentGeneration.value.items.push(result.item)
    }
  } catch (e: any) {
    error.value = e.data?.message || 'Video generation failed'
  } finally {
    actionLoading.value[`video-${mediaItemId}`] = false
  }
}

async function addAudio(mediaItemId: string) {
  actionLoading.value[`audio-${mediaItemId}`] = true
  try {
    const result = await $fetch<{ item: MediaItemResult }>('/api/generate/audio', {
      method: 'POST',
      body: { mediaItemId, prompt: `ambient music for: ${prompt.value}` },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (currentGeneration.value && result.item) {
      currentGeneration.value.items.push(result.item)
    }
  } catch (e: any) {
    error.value = e.data?.message || 'Audio generation failed'
  } finally {
    actionLoading.value[`audio-${mediaItemId}`] = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    generate()
  }
}

// Grid columns based on image count
const gridClass = computed(() => {
  const count = images.value.length
  if (count <= 1) return 'grid-cols-1 max-w-lg mx-auto'
  if (count <= 2) return 'grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto'
  if (count <= 4) return 'grid-cols-2 max-w-3xl mx-auto'
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
})
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <!-- Hero prompt section -->
    <div class="text-center mb-10">
      <h1 class="font-display text-3xl sm:text-4xl font-bold mb-2">
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-cyan-400">
          What do you want to create?
        </span>
      </h1>
      <p class="text-zinc-500 text-sm">Describe your vision, and AI will bring it to life</p>
    </div>

    <!-- Prompt input -->
    <div class="max-w-2xl mx-auto mb-10">
      <div class="glass-card p-4 sm:p-6">
        <textarea
          v-model="prompt"
          placeholder="A cyberpunk city at sunset, neon lights reflecting in puddles, cinematic wide angle, 8k ultra detailed..."
          class="w-full bg-transparent border-0 text-white placeholder-zinc-600 resize-none focus:outline-none focus:ring-0 text-base sm:text-lg leading-relaxed min-h-[120px]"
          :disabled="generating"
          @keydown="handleKeydown"
        />

        <!-- Negative prompt (collapsible) -->
        <div class="mt-3">
          <button
            class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
            @click="showAdvanced = !showAdvanced"
          >
            <UIcon
              :name="showAdvanced ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
              class="w-3 h-3"
            />
            Negative prompt
          </button>
          <div v-if="showAdvanced" class="mt-2">
            <textarea
              v-model="negativePrompt"
              placeholder="Things to avoid in the generation..."
              class="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/30 min-h-[60px]"
              :disabled="generating"
            />
          </div>
        </div>

        <div class="flex items-center justify-between mt-4 pt-4 border-t border-zinc-800/50">
          <!-- Image count selector -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-zinc-500 mr-1">Images:</span>
            <button
              v-for="count in countOptions"
              :key="count"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              :class="imageCount === count
                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 shadow-sm shadow-violet-500/10'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'"
              @click="imageCount = count"
            >
              {{ count }}
            </button>
          </div>

          <!-- Generate button -->
          <UButton
            :loading="generating"
            :disabled="!prompt.trim()"
            @click="generate"
            size="lg"
          >
            <template #leading>
              <UIcon name="i-heroicons-sparkles" />
            </template>
            Generate
          </UButton>
        </div>

          <!-- Steps slider -->
          <div class="flex items-center gap-3 mt-4">
            <span class="text-xs text-zinc-500 shrink-0">Steps:</span>
            <input
              v-model.number="steps"
              type="range"
              min="1"
              max="50"
              class="flex-1 accent-violet-500 h-1.5"
            />
            <span class="text-xs text-zinc-400 font-mono w-6 text-right">{{ steps }}</span>
          </div>

          <!-- Width selector -->
          <div class="flex items-center gap-2 mt-3">
            <span class="text-xs text-zinc-500 mr-1 w-10">Width:</span>
            <button
              v-for="size in sizeOptions"
              :key="size.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              :class="imageWidth === size.value
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'"
              @click="imageWidth = size.value"
            >
              {{ size.label }}
            </button>
          </div>

          <!-- Height selector -->
          <div class="flex items-center gap-2 mt-3">
            <span class="text-xs text-zinc-500 mr-1 w-10">Height:</span>
            <button
              v-for="size in sizeOptions"
              :key="size.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              :class="imageHeight === size.value
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'"
              @click="imageHeight = size.value"
            >
              {{ size.label }}
            </button>
          </div>

          <p class="text-[11px] text-zinc-600 mt-3">
            Press ⌘+Enter to generate
          </p>
        </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="max-w-2xl mx-auto mb-8">
      <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 mt-0.5 shrink-0" />
        {{ error }}
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="generating" class="mb-10">
      <div :class="['grid gap-4', gridClass]">
        <div v-for="i in imageCount" :key="i" class="aspect-square rounded-xl shimmer" />
      </div>
      <p class="text-center text-sm text-zinc-500 mt-4 animate-pulse">
        Generating {{ imageCount }} image{{ imageCount > 1 ? 's' : '' }}...
      </p>
    </div>

    <!-- Results -->
    <div v-else-if="currentGeneration && images.length > 0">
      <div :class="['grid gap-4', gridClass]">
        <div
          v-for="(item, index) in images"
          :key="item.id"
          class="group relative animate-reveal"
          :style="{ animationDelay: `${index * 100}ms` }"
        >
          <!-- Image -->
          <div
            class="relative aspect-square rounded-xl overflow-hidden border border-zinc-800 hover:border-violet-500/30 transition-all cursor-pointer"
            @click="item.url && item.status === 'complete' ? selectedImage = item : null"
          >
            <img
              v-if="item.url && item.status === 'complete'"
              :src="item.url"
              :alt="currentGeneration.generation.prompt"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <div
              v-else
              class="w-full h-full flex items-center justify-center bg-zinc-900"
            >
              <UIcon name="i-heroicons-photo" class="w-8 h-8 text-zinc-700" />
            </div>

            <!-- Hover overlay -->
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
              <div class="flex gap-2 w-full">
                <UButton
                  size="xs"
                  variant="solid"
                  color="primary"
                  :loading="actionLoading[`video-${item.id}`]"
                  @click="makeVideo(item.id)"
                  class="flex-1"
                >
                  🎬 Video
                </UButton>
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  :loading="actionLoading[`audio-${item.id}`]"
                  @click="addAudio(item.id)"
                  class="flex-1"
                >
                  🔊 Video + Audio
                </UButton>
              </div>
            </div>
          </div>

          <!-- Child media (videos/audio) -->
          <div v-if="childMedia[item.id]?.length" class="mt-2 space-y-2">
            <div
              v-for="child in childMedia[item.id]"
              :key="child.id"
              class="glass-card p-3 flex items-center gap-3"
            >
              <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                :class="child.type === 'video' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-pink-500/15 text-pink-400'"
              >
                {{ child.type === 'video' ? '🎬' : '🔊' }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium capitalize">{{ child.type }}</p>
                <p class="text-[11px] text-zinc-500 capitalize">{{ child.status }}</p>
              </div>
              <a
                v-if="child.url && child.status === 'complete'"
                :href="child.url"
                target="_blank"
                class="text-xs text-violet-400 hover:text-violet-300"
              >
                Open ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Prompt citation -->
      <div class="text-center mt-8">
        <p class="text-xs text-zinc-600 italic max-w-lg mx-auto truncate">
          "{{ currentGeneration.generation.prompt }}"
        </p>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-20">
      <div class="w-20 h-20 mx-auto rounded-2xl bg-violet-500/5 border border-violet-500/10 flex items-center justify-center mb-4">
        <UIcon name="i-heroicons-sparkles" class="w-10 h-10 text-violet-500/30" />
      </div>
      <p class="text-zinc-600 text-sm">Your creations will appear here</p>
    </div>

    <!-- Lightbox modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="selectedImage"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 sm:p-8"
          @click.self="selectedImage = null"
          @keydown.escape="selectedImage = null"
          tabindex="0"
        >
          <button
            class="absolute top-4 right-4 text-white/60 hover:text-white transition-colors z-10"
            @click="selectedImage = null"
          >
            <UIcon name="i-heroicons-x-mark" class="w-8 h-8" />
          </button>
          <img
            :src="selectedImage.url!"
            :alt="currentGeneration?.generation.prompt"
            class="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
