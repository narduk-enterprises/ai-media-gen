<script setup lang="ts">
const props = defineProps<{ prefillMediaId?: string | null }>()
const gen = useGeneration()

// ─── Source Video ───────────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')

watch(() => props.prefillMediaId, (id) => {
  if (id) selectedMediaId.value = id
}, { immediate: true })

function onVideoSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaId.value = payload.mediaItemId || null
  uploadedBase64.value = payload.base64 || ''
}

function onVideoClear() {
  selectedMediaId.value = null
  uploadedBase64.value = ''
}

// ─── Settings ─────────────────────────────────────────
const customSystemPrompt = ref('')
const selectedModel = ref('Qwen2.5-VL-7B-Instruct-AWQ')
const frames = ref(16)

const hasVideo = computed(() => !!selectedMediaId.value || !!uploadedBase64.value)
const canGenerate = computed(() => hasVideo.value)

// ─── Generate ───────────────────────────────────────────────
const isGenerating = ref(false)
const generatedText = ref('')
const errorMsg = ref('')

async function generate() {
  if (!canGenerate.value || isGenerating.value) return
  isGenerating.value = true
  errorMsg.value = ''
  generatedText.value = ''

  try {
    let videoData = uploadedBase64.value
    // If selecting an existing media id, we'd ideally fetch its base64 or pass its path.
    // However, our backend `video2prompt` currently expects `videoData` as base64.
    // If a user selects from gallery, we need to fetch the file and convert it to base64.
    if (selectedMediaId.value && !videoData) {
       // A proper implementation would fetch the video Blob and read as Base64.
       // For now, let's show an error if they try to select from gallery without fetching data.
       const vidUrl = (document.querySelector(`video[src*="${selectedMediaId.value}"]`) as HTMLVideoElement)?.src
       if (vidUrl) {
           const blob = await fetch(vidUrl).then(r => r.blob())
           const reader = new FileReader()
           videoData = await new Promise<string>((resolve) => {
              reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
              reader.readAsDataURL(blob)
           })
       }
    }

    if (!videoData) {
      errorMsg.value = 'Failed to load video data for generation.'
      isGenerating.value = false
      return
    }

    const { jobId } = await $fetch<{ jobId: string }>('/api/generate/video2prompt', {
      method: 'POST',
      body: {
        videoData,
        frames: frames.value,
        customSystemPrompt: customSystemPrompt.value.trim() || undefined,
        targetModel: selectedModel.value,
      },
      timeout: 30000,
    })
    
    // Poll the generation endpoint for completion
    let attempts = 0
    pollGeneration(jobId, attempts)
  } catch (err: any) {
    errorMsg.value = err.message || 'Generation failed'
    isGenerating.value = false
  }
}

async function pollGeneration(jobId: string, attempts: number) {
  if (attempts > 300) { // 300 * 3s = 15 minutes max
     errorMsg.value = 'Generation timed out.'
     isGenerating.value = false
     return
  }
  
  try {
     const statusReq = await $fetch<{ items?: any[] }>('/api/generations', {
       params: { id: jobId, limit: 1 },
       headers: { 'X-Requested-With': 'XMLHttpRequest' },
       timeout: 10000,
     })
     
     const genItem = statusReq.items?.[0]
     if (genItem) {
        if (genItem.status === 'complete' && genItem.resultUrl) {
           generatedText.value = genItem.resultUrl // We stored the prompt text in resultUrl!
           isGenerating.value = false
           return
        }
        if (genItem.status === 'failed') {
           errorMsg.value = 'Pod processing failed.'
           isGenerating.value = false
           return
        }
     }
  } catch (e) {
     // ignore transient errors
  }
  
  setTimeout(() => pollGeneration(jobId, attempts + 1), 3000)
}

function copyPromptText() {
  if (navigator?.clipboard) {
    navigator.clipboard.writeText(generatedText.value)
  }
}

defineExpose({ generate, canGenerate, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <VideoPicker label="Source Video" @select="onVideoSelect" @clear="onVideoClear" />

    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Custom Instructions" size="sm" description="Optional rules for the vision model (e.g., 'Describe the camera motion only')">
          <UTextarea v-model="customSystemPrompt" placeholder="Default: Analyze this video and write a detailed prompt..." :rows="3" autoresize class="w-full" size="sm" />
        </UFormField>

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <UFormField label="Frames Excerpts" size="sm" description="Number of frames to extract and analyze">
             <div class="flex items-center gap-2">
               <UInput v-model.number="frames" type="number" size="sm" class="w-28" />
             </div>
          </UFormField>
          
          <UFormField label="Vision Model" size="sm">
            <USelect v-model="selectedModel" :options="['Qwen2.5-VL-7B-Instruct-AWQ', 'Qwen2-VL-7B-Instruct-AWQ']" size="sm" />
          </UFormField>
        </div>
      </div>
    </UCard>
    
    <div class="flex justify-end gap-3 mt-4">
      <UButton size="md" color="primary" @click="generate" :loading="isGenerating" :disabled="!canGenerate">
        {{ isGenerating ? 'Analyzing Video...' : 'Generate Prompt' }}
      </UButton>
    </div>

    <UCard v-if="generatedText" variant="soft" color="primary" class="mt-4 ring-1 ring-primary-200">
       <div class="flex items-start justify-between">
          <h3 class="font-medium text-sm text-primary-800 mb-2">Generated Video Prompt</h3>
          <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="primary" @click="copyPromptText" />
       </div>
       <p class="text-sm text-primary-900 whitespace-pre-wrap">{{ generatedText }}</p>
    </UCard>
    
    <UAlert v-if="errorMsg" icon="i-lucide-alert-circle" color="error" variant="soft" title="Error" :description="errorMsg" class="mt-4" />
  </div>
</template>
