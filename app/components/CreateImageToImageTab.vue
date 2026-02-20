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
const cfg = ref(3.5)
const denoise = ref(0.75)
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)

const params = computed(() => shared.getImageModelParams(selectedModel.value))
const sizeItems = computed(() => params.value.sizes.map(v => ({ label: `${v}`, value: v })))
const fileInput = ref<HTMLInputElement | null>(null)

watch(selectedModel, (id) => {
  const p = shared.getImageModelParams(id)
  steps.value = p.steps.default
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
    <UInput v-model="negativePrompt" size="xs" placeholder="Negative prompt (optional)" icon="i-lucide-minus" class="w-full" />

    <!-- Model + Settings -->
    <ModelSelector :models="IMAGE_MODELS" :selected="selectedModel" @update:selected="selectedModel = $event as string" />

    <UCard variant="outline">
      <div class="flex flex-wrap gap-x-6 gap-y-3">
        <SliderField v-model="cfg" label="CFG" :min="1" :max="15" :step="0.5" description="Higher = follow prompt more" />
        <SliderField v-model="denoise" label="Denoise" :min="0" :max="1" :step="0.05" description="How much to change the image" :format="v => v.toFixed(2)" />
        <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
        <UFormField label="Width" size="sm">
          <USelect v-model="imageWidth" :items="sizeItems" size="sm" class="w-24" />
        </UFormField>
        <UFormField label="Height" size="sm">
          <USelect v-model="imageHeight" :items="sizeItems" size="sm" class="w-24" />
        </UFormField>
      </div>
    </UCard>
  </div>
</template>
