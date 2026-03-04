<script setup lang="ts">
import { DIRECTION_PRESETS, AUDIO_PRESETS, useVideoSettings, randomAudioPrompt } from '~/composables/useVideoDefaults'

const gen = useGeneration()
const queue = useQueue()
const { effectiveEndpoint } = useAppSettings()

// ─── Shared video settings ──────────────────────────────────
const vs = useVideoSettings()
const loading = ref(false)
const selectedImageIds = ref<string[]>([])

onMounted(() => { vs.audioPrompt.value = randomAudioPrompt() })

function onImagesSelected(ids: string[]) {
  selectedImageIds.value = ids
}

const canGenerate = computed(() => selectedImageIds.value.length > 0 && !loading.value)
const totalCount = computed(() => selectedImageIds.value.length)

async function generate() {
  if (!canGenerate.value) return
  loading.value = true
  gen.error.value = ''

  try {
    const endpoint = effectiveEndpoint.value
    const result = await $fetch<{
      generation: { id: string; status: string; imageCount: number }
      items: { id: string; generationId: string; type: string; prompt: string; status: string; url: null }[]
    }>('/api/generate/image2video-auto-batch', {
      method: 'POST',
      body: {
        mediaItemIds: selectedImageIds.value,
        basePrompt: vs.basePrompt.value, audioPrompt: vs.audioPrompt.value,
        negativePrompt: vs.negativePrompt.value,
        steps: vs.steps.value, numFrames: vs.numFrames.value,
        width: vs.width.value, height: vs.height.value,
        imageStrength: vs.imageStrength.value, endpoint,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result.items?.length) {
      gen.results.value = [...gen.results.value, ...result.items.map(item => ({
        ...item, parentId: null,
      }))] as typeof gen.results.value
      gen.activeGenerationId.value = result.generation.id
      // Track this generation so queue sync watcher updates statuses/URLs
      gen.trackedGenerationIds.value.add(result.generation.id)
      queue.refresh()
    }
  } catch (e) {
    const err = e as { data?: { message?: string }; message?: string }
    gen.error.value = err.data?.message || err.message || 'Auto video batch failed'
  } finally {
    loading.value = false
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <ImagePicker :multi="true" label="Select images to animate" @update:selected="onImagesSelected" />

    <!-- Direction & Audio -->
    <UCard variant="outline">
      <div class="space-y-4">
        <PromptPresetField v-model="vs.basePrompt.value" label="Direction prompt" description="Style and camera guidance for the video" placeholder="Or type your own direction..." :presets="DIRECTION_PRESETS" :disabled="loading" />
        <PromptPresetField v-model="vs.audioPrompt.value" label="Audio prompt" description="Soundtrack/ambience for the video" placeholder="Or describe the audio..." :presets="AUDIO_PRESETS" :disabled="loading" />
        <PromptPresetField v-model="vs.negativePrompt.value" label="Negative prompt" :disabled="loading" />
      </div>
    </UCard>

    <!-- Settings -->
    <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
      <CountSelector v-model="vs.numFrames.value" label="Duration" :options="[49, 81, 121, 161, 241, 361, 481, 601, 721]" />
      <ResolutionSelector v-model:width="vs.width.value" v-model:height="vs.height.value" />
      <CountSelector v-model="vs.steps.value" label="Steps" :options="[12, 20]" />
      <FidelitySelector v-model="vs.imageStrength.value" />
    </div>

    <!-- Pipeline Status -->
    <div v-if="loading" class="flex items-center gap-3 p-4 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-5 h-5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div>
        <p class="text-sm font-medium text-violet-700">Submitting {{ selectedImageIds.length }} images to auto video pipeline...</p>
        <p class="text-xs text-violet-500">Each image will be captioned → prompted → queued for video generation</p>
      </div>
    </div>
  </div>
</template>
