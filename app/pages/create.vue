<script setup lang="ts">
import {
  attributeLabels,
  attributeKeys,
  pickRandom,
  buildPrompt as _buildPrompt,
  buildRandomVariantPrompt as _buildRandomVariant,
  buildVariedPrompts,
  countActiveAttributes,
  createEmptyAttributes,
  randomizeAllAttributes as _randomizeAll,
  clearAllAttributes as _clearAll,
  type AttributeKey,
} from '~/utils/promptBuilder'

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
const enhancing = ref(false)
const genMode = ref<'image' | 'video'>('image')
const videoDuration = ref(81)
const videoItem = ref<MediaItemResult | null>(null)
const videoPolling = ref(false)
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const showPromptBuilder = ref(false)
const varyPerImage = ref(false)

// ─── Prompt Builder (uses extracted composable + user presets) ─────────
const { getPresets, config: presetConfig } = usePromptPresets()
const attributes = reactive(createEmptyAttributes())

// ─── In-browser LLM for prompt remix ───────────────────────────────────
const { isSupported: webGpuSupported, loadProgress, loadingModel, remixPrompt } = useWebLLM()

function randomizeAttribute(key: AttributeKey) {
  const presets = getPresets(key)
  attributes[key] = pickRandom(presets)
}

function randomizeAll() {
  for (const key of attributeKeys) {
    randomizeAttribute(key)
  }
}

function clearAttributes() {
  _clearAll(attributes)
}

const composedPrompt = computed(() => _buildPrompt(prompt.value, attributes))

const activeAttributeCount = computed(() => countActiveAttributes(attributes))

// ─── Rest of state ─────────────────────────────────────────────────────

const durationOptions = [
  { label: '3s', value: 81 },
  { label: '5s', value: 121 },
  { label: '7s', value: 161 },
]

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

const completedCount = computed(() =>
  images.value.filter(i => i.status === 'complete').length
)

const allDone = computed(() =>
  images.value.length > 0 && images.value.every(i => i.status === 'complete' || i.status === 'failed')
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
  if (!prompt.value.trim() && activeAttributeCount.value === 0) return
  if (genMode.value === 'video') return generateT2V()
  generating.value = true
  error.value = ''
  currentGeneration.value = null
  stopPolling()

  // Build prompts
  const finalPrompt = composedPrompt.value || prompt.value
  let perImagePrompts: string[] | undefined

  if (varyPerImage.value && imageCount.value > 1) {
    // Generate a unique random variant for each image
    perImagePrompts = buildVariedPrompts(prompt.value, attributes, imageCount.value)
  }

  try {
    const result = await $fetch<GenerationResult>('/api/generate/image', {
      method: 'POST',
      body: {
        prompt: finalPrompt,
        prompts: perImagePrompts,
        negativePrompt: negativePrompt.value,
        count: imageCount.value,
        steps: steps.value,
        width: imageWidth.value,
        height: imageHeight.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    currentGeneration.value = result
    startPolling(result.generation.id)
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Generation failed'
    generating.value = false
  }
}

function startPolling(generationId: string) {
  stopPolling()
  pollingTimer.value = setInterval(async () => {
    try {
      const result = await $fetch<GenerationResult>('/api/generate/generation-status', {
        params: { id: generationId },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      if (currentGeneration.value) {
        currentGeneration.value.generation = result.generation
        currentGeneration.value.items = result.items
      }

      const items = result.items.filter(i => i.type === 'image')
      const done = items.every(i => i.status === 'complete' || i.status === 'failed')
      if (done) {
        stopPolling()
        generating.value = false
      }
    } catch {
      // Swallow poll errors
    }
  }, 3000)
}

function stopPolling() {
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }
}

onUnmounted(() => stopPolling())

async function generateT2V() {
  generating.value = true
  error.value = ''
  currentGeneration.value = null
  videoItem.value = null

  try {
    const result = await $fetch<{ generation: any; item: MediaItemResult }>('/api/generate/text2video', {
      method: 'POST',
      body: { prompt: prompt.value, width: 640, height: 640, numFrames: videoDuration.value, steps: 4 },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    videoItem.value = result.item
    videoPolling.value = true
    pollVideoStatus(result.item.id)
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Video generation failed'
    generating.value = false
  }
}

async function pollVideoStatus(itemId: string) {
  const maxAttempts = 120
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const result = await $fetch<{ item: MediaItemResult }>(`/api/generate/status/${itemId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      videoItem.value = result.item
      if (result.item.status === 'complete' || result.item.status === 'failed') {
        generating.value = false
        videoPolling.value = false
        return
      }
    } catch { /* continue */ }
  }
  generating.value = false
  videoPolling.value = false
  error.value = 'Video generation timed out'
}

async function enhancePrompt() {
  if (!prompt.value.trim()) return
  enhancing.value = true
  try {
    const result = await remixPrompt(prompt.value)
    prompt.value = result
  } catch (e: any) {
    error.value = e.message || 'Prompt remix failed'
  } finally {
    enhancing.value = false
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
        <!-- Saved prompts quick-select -->
        <div v-if="presetConfig.basePrompts.length > 0" class="mb-3 flex items-center gap-2">
          <label class="text-[11px] text-zinc-500 shrink-0">📝 Saved:</label>
          <select
            class="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 cursor-pointer appearance-none"
            @change="(e: Event) => { prompt = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).selectedIndex = 0 }"
          >
            <option value="" disabled selected>Choose a saved prompt...</option>
            <option v-for="bp in presetConfig.basePrompts" :key="bp" :value="bp">
              {{ bp.length > 60 ? bp.slice(0, 60) + '...' : bp }}
            </option>
          </select>
        </div>

        <textarea
          v-model="prompt"
          placeholder="A cyberpunk city at sunset, neon lights reflecting in puddles, cinematic wide angle, 8k ultra detailed..."
          class="w-full bg-transparent border-0 text-white placeholder-zinc-600 resize-none focus:outline-none focus:ring-0 text-base sm:text-lg leading-relaxed min-h-[120px]"
          :disabled="generating"
          @keydown="handleKeydown"
        />

        <!-- Composed prompt preview (when builder is active) -->
        <div v-if="showPromptBuilder && activeAttributeCount > 0" class="mt-2 mb-3 p-3 rounded-lg bg-violet-500/5 border border-violet-500/10">
          <p class="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 font-medium">Final Prompt Preview</p>
          <p class="text-xs text-zinc-300 leading-relaxed">{{ composedPrompt }}</p>
        </div>

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

        <!-- ═══ Prompt Builder Panel ═══ -->
        <div class="mt-3">
          <button
            class="text-xs transition-colors flex items-center gap-1.5"
            :class="showPromptBuilder ? 'text-violet-400' : 'text-zinc-500 hover:text-zinc-300'"
            @click="showPromptBuilder = !showPromptBuilder"
          >
            <UIcon
              :name="showPromptBuilder ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
              class="w-3 h-3"
            />
            🧩 Prompt Builder
            <span v-if="activeAttributeCount > 0" class="ml-1 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-medium">
              {{ activeAttributeCount }}
            </span>
          </button>

          <div v-if="showPromptBuilder" class="mt-3 space-y-2">
            <!-- Toolbar -->
            <div class="flex items-center gap-2 mb-3">
              <button
                class="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors flex items-center gap-1"
                @click="randomizeAll"
              >
                🎲 Randomize All
              </button>
              <button
                v-if="activeAttributeCount > 0"
                class="px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-1"
                @click="clearAttributes"
              >
                ✕ Clear
              </button>
              <div class="flex-1" />
              <label class="flex items-center gap-2 cursor-pointer group">
                <span class="text-[11px] text-zinc-500 group-hover:text-zinc-300 transition-colors">Vary per Image</span>
                <div
                  class="relative w-8 h-[18px] rounded-full transition-colors cursor-pointer"
                  :class="varyPerImage ? 'bg-violet-500' : 'bg-zinc-700'"
                  @click="varyPerImage = !varyPerImage"
                >
                  <div
                    class="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform"
                    :class="varyPerImage ? 'translate-x-[16px]' : 'translate-x-[2px]'"
                  />
                </div>
              </label>
            </div>

            <!-- Vary per Image info -->
            <div v-if="varyPerImage" class="px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10 mb-2">
              <p class="text-[11px] text-cyan-400/80">
                🎲 Each image will get random attributes from the pool below, combined with your base prompt.
              </p>
            </div>

            <!-- Attribute rows -->
            <div
              v-for="(info, key) in attributeLabels"
              :key="key"
              class="flex items-center gap-2"
            >
              <!-- Label -->
              <span class="text-[11px] text-zinc-500 w-16 shrink-0 flex items-center gap-1">
                <span>{{ info.emoji }}</span>
                <span>{{ info.label }}</span>
              </span>

              <!-- Input + Preset combo -->
              <div class="flex-1 relative">
                <input
                  v-model="attributes[key]"
                  :placeholder="`e.g. ${getPresets(key)[0]}`"
                  class="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30 pr-8"
                  :disabled="generating"
                />
              </div>

              <!-- Preset dropdown -->
              <div class="relative">
                <select
                  class="appearance-none bg-zinc-800/80 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 cursor-pointer pr-6 max-w-[140px]"
                  :value="''"
                  @change="(e: Event) => { attributes[key] = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = '' }"
                >
                  <option value="" disabled selected>Presets</option>
                  <option v-for="preset in getPresets(key)" :key="preset" :value="preset">
                    {{ preset }}
                  </option>
                </select>
              </div>

              <!-- Random button -->
              <button
                class="p-1.5 rounded-lg text-zinc-600 hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
                title="Randomize"
                @click="randomizeAttribute(key)"
              >
                <span class="text-sm">🎲</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Mode toggle -->
        <div class="flex items-center gap-2 mt-4 pt-4 border-t border-zinc-800/50">
          <span class="text-xs text-zinc-500 mr-1">Mode:</span>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            :class="genMode === 'image'
              ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 shadow-sm shadow-violet-500/10'
              : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'"
            @click="genMode = 'image'"
          >
            🖼️ Image
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            :class="genMode === 'video'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
              : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'"
            @click="genMode = 'video'"
          >
            🎬 Video
          </button>
        </div>

        <div class="flex items-center justify-between mt-3">
          <!-- Image count selector (image mode) -->
          <div v-if="genMode === 'image'" class="flex items-center gap-2">
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

          <!-- Duration selector (video mode) -->
          <div v-else class="flex items-center gap-2">
            <span class="text-xs text-zinc-500 mr-1">Duration:</span>
            <button
              v-for="dur in durationOptions"
              :key="dur.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              :class="videoDuration === dur.value
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'"
              @click="videoDuration = dur.value"
            >
              {{ dur.label }}
            </button>
          </div>

          <!-- Generate button -->
          <UButton
            :loading="generating"
            :disabled="!prompt.trim() && activeAttributeCount === 0"
            @click="generate"
            size="lg"
          >
            <template #leading>
              <UIcon :name="genMode === 'image' ? 'i-heroicons-sparkles' : 'i-heroicons-play'" />
            </template>
            {{ genMode === 'image' ? 'Generate' : 'Generate Video' }}
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

        <div class="flex items-center justify-between mt-3">
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="enhancing || loadingModel"
              :disabled="!prompt.trim() || generating || !webGpuSupported"
              @click="enhancePrompt"
            >
              <template #leading>
                <span>✨</span>
              </template>
              {{ loadingModel ? `Loading AI (${loadProgress}%)` : 'Remix Prompt' }}
            </UButton>
            <span v-if="!webGpuSupported" class="text-[10px] text-zinc-600" title="WebGPU is required for in-browser AI">
              ⚠️ WebGPU not available
            </span>
          </div>
          <p class="text-[11px] text-zinc-600">
            Press ⌘+Enter to generate
          </p>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="max-w-2xl mx-auto mb-8">
      <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 mt-0.5 shrink-0" />
        {{ error }}
      </div>
    </div>

    <!-- Video loading -->
    <div v-if="generating && genMode === 'video'" class="mb-10">
      <div class="max-w-lg mx-auto">
        <div class="aspect-video rounded-xl shimmer" />
      </div>
      <p class="text-center text-sm text-zinc-500 mt-4 animate-pulse">
        Generating video ({{ durationOptions.find(d => d.value === videoDuration)?.label || '3s' }})... This may take a few minutes
      </p>
    </div>

    <!-- Video result -->
    <div v-else-if="videoItem && videoItem.status === 'complete' && videoItem.url" class="max-w-lg mx-auto mb-10">
      <div class="glass-card p-4 rounded-xl">
        <video
          :src="videoItem.url"
          controls
          autoplay
          loop
          class="w-full rounded-lg"
        />
        <div class="flex items-center justify-between mt-3">
          <span class="text-xs text-zinc-500">🎬 Text-to-Video</span>
          <a
            :href="videoItem.url"
            download="generated_video.mp4"
            class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            Download ↓
          </a>
        </div>
      </div>
    </div>

    <!-- Video failed -->
    <div v-else-if="videoItem && videoItem.status === 'failed'" class="max-w-lg mx-auto mb-10">
      <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 mt-0.5 shrink-0" />
        Video generation failed
      </div>
    </div>

    <!-- Progressive Image Grid -->
    <div v-else-if="currentGeneration && images.length > 0">
      <!-- Progress indicator -->
      <div v-if="generating" class="text-center mb-6">
        <p class="text-sm text-zinc-400">
          <span class="text-violet-400 font-medium">{{ completedCount }}</span>
          <span class="text-zinc-600"> / </span>
          <span>{{ images.length }}</span>
          <span class="text-zinc-500 ml-1.5">images generated</span>
        </p>
        <div class="max-w-xs mx-auto mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-700 ease-out"
            :style="{ width: `${images.length > 0 ? (completedCount / images.length) * 100 : 0}%` }"
          />
        </div>
      </div>

      <div :class="['grid gap-4', gridClass]">
        <div
          v-for="(item, index) in images"
          :key="item.id"
          class="group relative"
        >
          <!-- Completed image -->
          <div
            v-if="item.url && item.status === 'complete'"
            class="relative aspect-square rounded-xl overflow-hidden border border-zinc-800 hover:border-violet-500/30 transition-all cursor-pointer animate-reveal"
            @click="selectedImage = item"
          >
            <img
              :src="item.url"
              :alt="currentGeneration.generation.prompt"
              class="w-full h-full object-cover"
              loading="lazy"
            />

            <!-- Hover overlay -->
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
              <div class="flex gap-2 w-full">
                <UButton
                  size="xs"
                  variant="solid"
                  color="primary"
                  :loading="actionLoading[`video-${item.id}`]"
                  @click.stop="makeVideo(item.id)"
                  class="flex-1"
                >
                  🎬 Video
                </UButton>
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  :loading="actionLoading[`audio-${item.id}`]"
                  @click.stop="addAudio(item.id)"
                  class="flex-1"
                >
                  🔊 Video + Audio
                </UButton>
              </div>
            </div>
          </div>

          <!-- Failed item -->
          <div
            v-else-if="item.status === 'failed'"
            class="aspect-square rounded-xl border border-red-500/20 bg-red-500/5 flex items-center justify-center"
          >
            <div class="text-center px-4">
              <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 text-red-400/60 mx-auto mb-1" />
              <p class="text-[11px] text-red-400/60">Failed</p>
            </div>
          </div>

          <!-- Still processing (shimmer) -->
          <div v-else class="aspect-square rounded-xl shimmer relative overflow-hidden">
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="text-center">
                <div class="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin mx-auto mb-2" />
                <p class="text-[11px] text-zinc-500">Generating...</p>
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
    <div v-else-if="!generating" class="text-center py-20">
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
