<script setup lang="ts">
import { IMAGE_MODELS } from '~/composables/useCreateShared'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Local State ────────────────────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref('')
const imageBase64 = ref('')
const imagePreview = ref('')
const selectedModel = ref('wan22')
const cfg = ref<number | undefined>(undefined)
const denoise = ref<number | undefined>(0.75)
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const loraStrength = ref<number | undefined>(undefined)
const sampler = ref<string | undefined>(undefined)
const scheduler = ref<string | undefined>(undefined)
const seed = ref(-1)

// ─── Model-aware params (merged with I2I overrides) ─────────────────────
const params = computed(() => shared.getI2IModelParams(selectedModel.value))

const fileInput = ref<HTMLInputElement | null>(null)

watch(selectedModel, (id) => {
  const p = shared.getI2IModelParams(id)
  steps.value = p.steps.default
  imageWidth.value = p.defaultWidth
  imageHeight.value = p.defaultHeight
  cfg.value = p.cfg?.default
  denoise.value = p.denoise?.default ?? 0.75
  loraStrength.value = p.lora?.default
  sampler.value = p.sampler?.default
  scheduler.value = p.scheduler?.default
})

// ─── File handling ──────────────────────────────────────────────────────
function readFile(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const d = reader.result as string
    imagePreview.value = d
    imageBase64.value = d.replace(/^data:image\/[^;]+;base64,/, '')
  }
  reader.readAsDataURL(file)
}

function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) readFile(file)
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file?.type.startsWith('image/')) readFile(file)
}

function clearImage() { imageBase64.value = ''; imagePreview.value = '' }

// ─── Generate ───────────────────────────────────────────────────────────
const canGenerate = computed(() => imageBase64.value.length > 0 && prompt.value.trim().length > 0)
const totalCount = computed(() => canGenerate.value ? 1 : 0)

async function generate() {
  if (!canGenerate.value) return
  await gen.generateImage2Image({
    image: imageBase64.value, prompt: prompt.value.trim(),
    negativePrompt: negativePrompt.value,
    steps: steps.value, width: imageWidth.value, height: imageHeight.value,
    cfg: cfg.value, denoise: denoise.value,
  })
}

defineExpose({ generate, canGenerate, totalCount, isVideo: false })
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Image upload -->
    <section>
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Source Image</h2>
      <div
        v-if="!imagePreview"
        class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50/30 transition-colors"
        @click="fileInput?.click()"
        @dragover.prevent
        @drop="handleDrop"
      >
        <div class="text-slate-400 mb-2"><UIcon name="i-lucide-upload" class="w-8 h-8" /></div>
        <p class="text-sm text-slate-500">Drop an image here or click to browse</p>
        <p class="text-xs text-slate-400 mt-1">PNG, JPG, WebP</p>
      </div>
      <div v-else class="relative inline-block">
        <img :src="imagePreview" class="max-h-64 rounded-xl border border-slate-200" />
        <UButton icon="i-lucide-x" color="error" variant="solid" size="xs" class="absolute top-2 right-2" @click="clearImage" />
      </div>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFileChange" />
    </section>

    <!-- Prompt -->
    <PromptInput v-model="prompt" label="New Prompt" placeholder="Describe the style or changes you want..." />

    <!-- Model + Settings -->
    <ModelSelector :models="IMAGE_MODELS" :selected="selectedModel" @update:selected="selectedModel = $event as string" />

    <ImageModelSettings
      :params="params"
      mode="i2i"
      v-model:steps="steps"
      v-model:width="imageWidth"
      v-model:height="imageHeight"
      v-model:seed="seed"
      v-model:cfg="cfg"
      v-model:lora-strength="loraStrength"
      v-model:sampler="sampler"
      v-model:scheduler="scheduler"
      v-model:denoise="denoise"
      v-model:negative-prompt="negativePrompt"
    />
  </div>
</template>
