<script setup lang="ts">
const gen = useGeneration()
const { customEndpoint, runpodEndpoint } = useAppSettings()

// ─── Local State ────────────────────────────────────────────────────────
const selectedMediaItemId = ref<string | null>(null)
const selectedBase64 = ref('')
const basePrompt = ref('')
const audioPrompt = ref('')
const negativePrompt = ref('worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo')
const count = ref(5)
const steps = ref(20)
const numFrames = ref(97)
const loading = ref(false)

// Pipeline results
const caption = ref('')
const generatedPrompts = ref<string[]>([])
const timing = ref<{ captionSeconds?: number; promptSeconds?: number; totalSeconds?: number }>({})

function onImageSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaItemId.value = payload.mediaItemId || null
  selectedBase64.value = payload.base64 || ''
}

function onImageClear() {
  selectedMediaItemId.value = null
  selectedBase64.value = ''
  caption.value = ''
  generatedPrompts.value = []
}

// ─── Generate ───────────────────────────────────────────────────────────
const canGenerate = computed(() => (!!selectedMediaItemId.value || !!selectedBase64.value) && !loading.value)
const totalCount = computed(() => count.value)

async function generate() {
  if (!canGenerate.value) return

  loading.value = true
  gen.error.value = ''
  caption.value = ''
  generatedPrompts.value = []

  try {
    const endpoint = customEndpoint.value || runpodEndpoint.value
    const body: Record<string, any> = {
      basePrompt: basePrompt.value, audioPrompt: audioPrompt.value,
      negativePrompt: negativePrompt.value, count: count.value,
      steps: steps.value, numFrames: numFrames.value, endpoint,
    }

    if (selectedMediaItemId.value) {
      body.mediaItemId = selectedMediaItemId.value
    } else if (selectedBase64.value) {
      body.image = selectedBase64.value
    }

    const result = await $fetch<{
      generation: { id: string; status: string }
      items: { id: string; type: string; status: string; prompt: string }[]
      caption: string
      prompts: string[]
      timing: { captionSeconds?: number; promptSeconds?: number; totalSeconds?: number }
    }>('/api/generate/image2video-auto', {
      method: 'POST', body,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    caption.value = result.caption
    generatedPrompts.value = result.prompts
    timing.value = result.timing

    if (result.items?.length) {
      gen.results.value = [...gen.results.value, ...result.items.map(item => ({
        ...item, url: null, parentId: null, generationId: result.generation.id,
      }))] as any
      gen.activeGenerationId.value = result.generation.id
    }
  } catch (e: any) {
    gen.error.value = e.data?.message || e.message || 'Auto video pipeline failed'
  } finally {
    loading.value = false
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <ImagePicker @select="onImageSelect" @clear="onImageClear" />

    <!-- Direction & Audio -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Direction prompt" size="sm" description="Optional guidance for the video style">
          <UTextarea v-model="basePrompt" placeholder="Make it feel like a summer music video..." :rows="2" autoresize :disabled="loading" class="w-full" size="sm" />
        </UFormField>
        <UFormField label="Audio prompt" size="sm" description="Describe the audio/sound for each video">
          <UTextarea v-model="audioPrompt" placeholder="upbeat music, laughter, wind blowing..." :rows="2" autoresize :disabled="loading" class="w-full" size="sm" />
        </UFormField>
        <UFormField label="Negative prompt" size="sm">
          <UTextarea v-model="negativePrompt" :rows="2" autoresize :disabled="loading" class="w-full" size="sm" />
        </UFormField>
      </div>
    </UCard>

    <!-- Settings -->
    <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
      <UFormField label="Variations" size="sm" description="How many videos to generate">
        <div class="flex gap-1">
          <UButton v-for="n in [1, 3, 5, 10]" :key="n" size="xs" :variant="count === n ? 'soft' : 'ghost'" :color="count === n ? 'primary' : 'neutral'" @click="count = n">{{ n }}</UButton>
        </div>
      </UFormField>

      <UFormField label="Duration" size="sm">
        <div class="flex flex-wrap gap-1">
          <UButton v-for="d in [{l:'2s',v:49},{l:'3s',v:81},{l:'5s',v:121},{l:'7s',v:161},{l:'10s',v:241},{l:'15s',v:361},{l:'20s',v:481},{l:'25s',v:601},{l:'30s',v:721}]" :key="d.v" size="xs" :variant="numFrames === d.v ? 'soft' : 'ghost'" :color="numFrames === d.v ? 'primary' : 'neutral'" @click="numFrames = d.v">{{ d.l }}</UButton>
        </div>
      </UFormField>

      <UFormField label="Steps" size="sm">
        <div class="flex gap-1">
          <UButton v-for="s in [12, 20]" :key="s" size="xs" :variant="steps === s ? 'soft' : 'ghost'" :color="steps === s ? 'primary' : 'neutral'" @click="steps = s">{{ s }}</UButton>
        </div>
      </UFormField>
    </div>

    <!-- Pipeline Status -->
    <div v-if="loading" class="flex items-center gap-3 p-4 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-5 h-5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div>
        <p class="text-sm font-medium text-violet-700">AI is analyzing your image...</p>
        <p class="text-xs text-violet-500">Captioning → Generating {{ count }} prompts → Queuing videos</p>
      </div>
    </div>

    <!-- Results Preview -->
    <div v-if="generatedPrompts.length > 0" class="space-y-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-amber-500" />
        <span class="text-sm font-semibold text-gray-700">Generated {{ generatedPrompts.length }} prompts</span>
        <UBadge v-if="timing.totalSeconds" size="xs" variant="subtle" color="neutral">{{ timing.captionSeconds }}s caption + {{ timing.promptSeconds }}s prompts</UBadge>
      </div>
      <div v-for="(p, i) in generatedPrompts" :key="i" class="p-3 rounded-lg bg-gray-50 border border-gray-200">
        <div class="flex items-center gap-1.5 mb-1">
          <UBadge size="xs" variant="subtle" color="primary">{{ i + 1 }}</UBadge>
          <span class="text-[10px] text-gray-400">queued for generation</span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">{{ p }}</p>
      </div>
    </div>
  </div>
</template>
