<script setup lang="ts">
import { IMAGE_MODELS, IMAGE_MODEL_PARAMS, type ModelDef } from '~/composables/useCreateShared'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Local State ────────────────────────────────────────────────────────
const prompt = ref('')
const batchPrompts = ref<string[]>([])
const batchMode = ref(false)
const selectedModels = ref<string[]>(['wan22'])
const count = ref(1)
const steps = ref(20)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const loraStrength = ref(1.0)
const seed = ref(-1)

// ─── Model-aware params ────────────────────────────────────────────────
const primaryModel = computed(() => selectedModels.value[0] ?? 'wan22')
const params = computed(() => shared.getImageModelParams(primaryModel.value))
const compareMode = computed(() => selectedModels.value.length > 1)
const sizeItems = computed(() => params.value.sizes.map(v => ({ label: `${v}`, value: v })))

// Apply model defaults when model changes
watch(primaryModel, (id) => {
  const p = shared.getImageModelParams(id)
  steps.value = p.steps.default
  imageWidth.value = p.defaultWidth
  imageHeight.value = p.defaultHeight
  if (p.lora) loraStrength.value = p.lora.default
})

// ─── Generate ───────────────────────────────────────────────────────────
const prompts = computed(() => {
  if (batchMode.value && batchPrompts.value.length > 0) return batchPrompts.value
  if (prompt.value.trim()) {
    const out: string[] = []
    for (let i = 0; i < count.value; i++) out.push(prompt.value.trim())
    return out
  }
  return []
})

const totalCount = computed(() => prompts.value.length * selectedModels.value.length)
const canGenerate = computed(() => prompts.value.length > 0)

async function generate(append = false) {
  if (!canGenerate.value) return
  const p = prompts.value
  for (const modelId of selectedModels.value) {
    const m = IMAGE_MODELS.find(m => m.id === modelId)
    const modelSteps = compareMode.value ? (m?.defaultSteps ?? steps.value) : steps.value
    if (p.length > gen.MAX_IMAGES_PER_BATCH) {
      await gen.generate({
        prompts: p, negativePrompt: shared.negativePrompt.value,
        steps: modelSteps, width: imageWidth.value, height: imageHeight.value,
        loraStrength: loraStrength.value, model: modelId, seed: seed.value,
      })
    } else {
      await gen.generate({
        prompts: p, negativePrompt: shared.negativePrompt.value,
        steps: modelSteps, width: imageWidth.value, height: imageHeight.value,
        loraStrength: loraStrength.value, model: modelId, seed: seed.value,
        append: append || selectedModels.value.indexOf(modelId) > 0,
      })
    }
  }
}

// ─── Persistence ────────────────────────────────────────────────────────
onMounted(() => {
  const s = shared.restoreForm()
  if (s.t2i_prompt != null) prompt.value = s.t2i_prompt
  if (Array.isArray(s.t2i_selectedModels)) selectedModels.value = s.t2i_selectedModels
  if (s.t2i_steps != null) steps.value = s.t2i_steps
  if (s.t2i_width != null) imageWidth.value = s.t2i_width
  if (s.t2i_height != null) imageHeight.value = s.t2i_height
  if (s.t2i_lora != null) loraStrength.value = s.t2i_lora
  if (s.t2i_seed != null) seed.value = s.t2i_seed
  if (s.t2i_count != null) count.value = s.t2i_count
})

watch([prompt, selectedModels, steps, imageWidth, imageHeight, loraStrength, seed, count], () => {
  shared.persistForm({
    t2i_prompt: prompt.value, t2i_selectedModels: selectedModels.value,
    t2i_steps: steps.value, t2i_width: imageWidth.value, t2i_height: imageHeight.value,
    t2i_lora: loraStrength.value, t2i_seed: seed.value, t2i_count: count.value,
  })
}, { deep: true })

// ─── Expose for parent ─────────────────────────────────────────────────
defineExpose({ generate, canGenerate, totalCount, isVideo: false })
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Mode toggle: Single / Batch -->
    <div class="flex items-center gap-2">
      <UButton size="xs" :variant="!batchMode ? 'soft' : 'ghost'" :color="!batchMode ? 'primary' : 'neutral'" @click="batchMode = false">
        <UIcon name="i-lucide-type" class="w-3.5 h-3.5" /> Single Prompt
      </UButton>
      <UButton size="xs" :variant="batchMode ? 'soft' : 'ghost'" :color="batchMode ? 'primary' : 'neutral'" @click="batchMode = true">
        <UIcon name="i-lucide-layers" class="w-3.5 h-3.5" /> Batch JSON
      </UButton>
    </div>

    <!-- Single prompt -->
    <div v-if="!batchMode">
      <PromptInput v-model="prompt" :disabled="gen.generating.value" />
      <CountSelector v-model="count" label="Images" :options="[1, 2, 4, 8]" class="mt-4" />
    </div>

    <!-- Batch mode -->
    <BatchJsonInput v-if="batchMode" v-model:prompts="batchPrompts">
      <template #badges>
        <UBadge size="xs" variant="subtle" color="primary">{{ totalCount }} total image{{ totalCount !== 1 ? 's' : '' }}</UBadge>
      </template>
    </BatchJsonInput>

    <!-- Model Selector -->
    <ModelSelector :models="IMAGE_MODELS" :selected="selectedModels" :multi="true" @update:selected="selectedModels = $event as string[]" />

    <!-- Settings -->
    <UCard variant="outline">
      <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
        <UFormField label="Width" size="sm">
          <USelect v-model="imageWidth" :items="sizeItems" size="sm" class="w-24" />
        </UFormField>
        <UFormField label="Height" size="sm">
          <USelect v-model="imageHeight" :items="sizeItems" size="sm" class="w-24" />
        </UFormField>
        <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" description="Speed LoRA strength" :format="v => v.toFixed(2)" />
        <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
          <div class="flex items-center gap-2">
            <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
            <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" title="Random seed" />
          </div>
        </UFormField>
      </div>
      <!-- Negative prompt -->
      <div class="mt-3 pt-3 border-t border-slate-100">
        <UInput v-model="shared.negativePrompt.value" placeholder="Negative prompt (optional)" size="xs" icon="i-lucide-minus" class="w-full" />
      </div>
    </UCard>

    <!-- Batch progress -->
    <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div class="text-xs text-violet-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} to API. Waiting for results…</div>
    </div>
  </div>
</template>
