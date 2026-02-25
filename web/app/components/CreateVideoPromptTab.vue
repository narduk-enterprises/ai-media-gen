<script setup lang="ts">
const props = defineProps<{ prefillMediaId?: string | null }>()
const gen = useGeneration()

// ─── Source file ref (for FormData upload) ──────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')
const uploadedFile = ref<File | null>(null)

watch(() => props.prefillMediaId, (id) => {
  if (id) selectedMediaId.value = id
}, { immediate: true })

function onVideoSelect(payload: { mediaItemId?: string; base64?: string; url: string; file?: File }) {
  selectedMediaId.value = payload.mediaItemId || null
  uploadedBase64.value = payload.base64 || ''
  uploadedFile.value = payload.file || null
}

function onVideoClear() {
  selectedMediaId.value = null
  uploadedBase64.value = ''
  uploadedFile.value = null
}

// ─── Settings ─────────────────────────────────────────
const customSystemPrompt = ref('')
const selectedModel = ref('Qwen2.5-VL-7B-Instruct-AWQ')
const frames = ref(16)

const hasVideo = computed(() => !!selectedMediaId.value || !!uploadedFile.value || !!uploadedBase64.value)
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
    // Build a File/Blob for the video
    let videoBlob: Blob | File | null = uploadedFile.value

    if (!videoBlob && selectedMediaId.value) {
      // Fetch video from gallery URL
      const vidEl = document.querySelector(`video[src*="${selectedMediaId.value}"]`) as HTMLVideoElement | null
      if (vidEl?.src) {
        videoBlob = await fetch(vidEl.src).then(r => r.blob())
      }
    }

    if (!videoBlob) {
      errorMsg.value = 'Failed to load video data for generation.'
      isGenerating.value = false
      return
    }

    // Use FormData to send the binary file (not base64)
    const formData = new FormData()
    formData.append('video', videoBlob, 'video.mp4')
    formData.append('frames', String(frames.value))
    if (customSystemPrompt.value.trim()) {
      formData.append('customSystemPrompt', customSystemPrompt.value.trim())
    }
    formData.append('targetModel', selectedModel.value)

    const { jobId } = await $fetch<{ jobId: string }>('/api/generate/video2prompt', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: formData,
      timeout: 60000,
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
