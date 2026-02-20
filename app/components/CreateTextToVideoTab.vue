<script setup lang="ts">
import { VIDEO_MODELS } from '~/composables/useCreateShared'
import type { VideoPreset } from '~/components/VideoPromptLibrary.vue'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Local State ────────────────────────────────────────────────────────
const prompt = ref('')
const batchPrompts = ref<string[]>([])
const batchMode = ref(false)
const selectedModel = ref('wan22')
const negativePrompt = ref('')
const numFrames = ref<number[]>([81])
const count = ref(1)
const steps = ref(4)
const resolutionIndex = ref(0)
const seed = ref(-1)
const loraStrength = ref(1.0)
const audioPrompt = ref('')
const isLtx2 = computed(() => selectedModel.value === 'ltx2')
const showLibrary = ref(false)
const combinedMode = ref(false)
const combinedPrompt = ref('')

// ─── Three-prompt parsing (LTX-2) ────────────────────────────────────
function parseThreePrompt(text: string) {
  // Try JSON first: [{"Positive":"...","Negative":"...","Audio":"..."}] or {"Positive":...}
  try {
    const trimmed = text.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let obj = JSON.parse(trimmed)
      if (Array.isArray(obj)) obj = obj[0]
      if (obj && typeof obj === 'object') {
        // Case-insensitive key matching
        const keys = Object.keys(obj)
        const find = (needle: string) => keys.find(k => k.toLowerCase() === needle.toLowerCase())
        const main = obj[find('positive') || find('prompt') || ''] || ''
        const neg = obj[find('negative') || find('negativePrompt') || find('neg') || ''] || ''
        const audio = obj[find('audio') || find('audioPrompt') || find('sound') || ''] || ''
        if (main) return { main: String(main).trim(), neg: String(neg).trim(), audio: String(audio).trim() }
      }
    }
  } catch {}

  // Fallback: split on --- lines
  const parts = text.split(/\n---\n|\n---$|^---\n/)
  const main = (parts[0] ?? '').trim()
  const neg = (parts[1] ?? '').trim()
  const audio = (parts[2] ?? '').trim()
  return { main, neg, audio }
}

function applyCombined() {
  const { main, neg, audio } = parseThreePrompt(combinedPrompt.value)
  prompt.value = main
  negativePrompt.value = neg
  audioPrompt.value = audio
  combinedMode.value = false
}

function openCombined() {
  // Build combined from current fields
  let text = prompt.value
  if (negativePrompt.value || audioPrompt.value) {
    text += '\n---\n' + negativePrompt.value
  }
  if (audioPrompt.value) {
    text += '\n---\n' + audioPrompt.value
  }
  combinedPrompt.value = text
  combinedMode.value = true
}

// ─── Apply preset from library ────────────────────────────────────────
function applyPreset(preset: VideoPreset) {
  prompt.value = preset.prompt
  audioPrompt.value = preset.audioPrompt
  negativePrompt.value = preset.negativePrompt
  selectedModel.value = preset.model
  steps.value = preset.steps
  numFrames.value = [preset.frames]
  seed.value = -1
  // Find matching resolution index
  const p = shared.getVideoModelParams(preset.model)
  const idx = p.resolutions.findIndex((r: any) => r.w === preset.resolution.w && r.h === preset.resolution.h)
  if (idx >= 0) resolutionIndex.value = idx
  showLibrary.value = false
}

// ─── Model-aware params ────────────────────────────────────────────────
const params = computed(() => shared.getVideoModelParams(selectedModel.value))
const currentResolution = computed(() => params.value.resolutions[resolutionIndex.value] ?? params.value.resolutions[0]!)
const durationPresets = computed(() => params.value.durations)

// Apply model defaults when model changes
watch(selectedModel, (id) => {
  const p = shared.getVideoModelParams(id)
  steps.value = p.steps.default
  resolutionIndex.value = 0
  numFrames.value = [p.durations[1]?.value ?? p.durations[0]?.value ?? 81]
  if (p.lora) loraStrength.value = p.lora.default
})

// ─── Generate ───────────────────────────────────────────────────────────
const allPrompts = computed(() => {
  if (batchMode.value && batchPrompts.value.length > 0) return batchPrompts.value
  if (prompt.value.trim()) return [prompt.value.trim()]
  return []
})

const totalCount = computed(() => {
  if (batchMode.value) return allPrompts.value.length * numFrames.value.length
  return numFrames.value.length * count.value
})
const canGenerate = computed(() => allPrompts.value.length > 0)

async function generate() {
  if (!canGenerate.value) return
  if (batchMode.value) {
    await gen.generateText2Video({
      prompts: allPrompts.value, negativePrompt: negativePrompt.value,
      numFrames: numFrames.value, steps: steps.value,
      width: currentResolution.value.w, height: currentResolution.value.h,
      loraStrength: loraStrength.value, model: selectedModel.value, seed: seed.value,
    })
  } else {
    // Expand frames × count for single prompt mode
    const expandedFrames: number[] = []
    for (const nf of numFrames.value) { for (let i = 0; i < count.value; i++) expandedFrames.push(nf) }
    await gen.generateText2Video({
      prompt: prompt.value.trim(), negativePrompt: negativePrompt.value,
      numFrames: expandedFrames, steps: steps.value,
      width: currentResolution.value.w, height: currentResolution.value.h,
      loraStrength: loraStrength.value, model: selectedModel.value, seed: seed.value,
      audioPrompt: isLtx2.value ? audioPrompt.value : undefined,
    })
  }
}

// ─── Persistence ────────────────────────────────────────────────────────
onMounted(() => {
  const s = shared.restoreForm()
  if (s.t2v_prompt != null) prompt.value = s.t2v_prompt
  if (s.t2v_model != null) selectedModel.value = s.t2v_model
  if (s.t2v_neg != null) negativePrompt.value = s.t2v_neg
  if (s.t2v_steps != null) steps.value = s.t2v_steps
  if (s.t2v_seed != null) seed.value = s.t2v_seed
  if (s.t2v_resIdx != null) resolutionIndex.value = s.t2v_resIdx
  if (Array.isArray(s.t2v_numFrames)) numFrames.value = s.t2v_numFrames
  if (s.t2v_count != null) count.value = s.t2v_count
  if (s.t2v_audioPrompt != null) audioPrompt.value = s.t2v_audioPrompt
})

watch([prompt, selectedModel, negativePrompt, steps, seed, resolutionIndex, numFrames, count, audioPrompt], () => {
  shared.persistForm({
    t2v_prompt: prompt.value, t2v_model: selectedModel.value, t2v_neg: negativePrompt.value,
    t2v_steps: steps.value, t2v_seed: seed.value, t2v_resIdx: resolutionIndex.value,
    t2v_numFrames: numFrames.value, t2v_count: count.value, t2v_audioPrompt: audioPrompt.value,
  })
}, { deep: true })

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Prompt Library toggle -->
    <div class="flex items-center gap-2">
      <UButton size="xs" :variant="showLibrary ? 'soft' : 'ghost'" :color="showLibrary ? 'warning' : 'neutral'" @click="showLibrary = !showLibrary">
        <UIcon name="i-lucide-sparkles" class="w-3.5 h-3.5" /> Prompt Library
      </UButton>
      <UButton size="xs" :variant="!batchMode ? 'soft' : 'ghost'" :color="!batchMode ? 'primary' : 'neutral'" @click="batchMode = false; showLibrary = false">
        <UIcon name="i-lucide-type" class="w-3.5 h-3.5" /> Single Prompt
      </UButton>
      <UButton size="xs" :variant="batchMode ? 'soft' : 'ghost'" :color="batchMode ? 'primary' : 'neutral'" @click="batchMode = true; showLibrary = false">
        <UIcon name="i-lucide-layers" class="w-3.5 h-3.5" /> Batch JSON
      </UButton>
    </div>

    <!-- Prompt Library -->
    <VideoPromptLibrary v-if="showLibrary" @select="applyPreset" />

    <!-- Single prompt -->
    <div v-if="!batchMode && !showLibrary && !combinedMode">
      <PromptInput v-model="prompt" placeholder="Describe the video you want to generate..." :disabled="gen.generating.value" />
      <CountSelector v-model="count" label="Videos per duration" :options="[1, 2, 4]" class="mt-4" />
    </div>

    <!-- Combined three-prompt mode (LTX-2) -->
    <div v-if="combinedMode && isLtx2" class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Combined Prompt (3-part)</span>
        <div class="flex gap-2">
          <UButton size="xs" variant="soft" color="primary" icon="i-lucide-split" @click="applyCombined">Parse &amp; Apply</UButton>
          <UButton size="xs" variant="ghost" color="neutral" @click="combinedMode = false">Cancel</UButton>
        </div>
      </div>
      <UTextarea
        v-model="combinedPrompt"
        :rows="8" autoresize
        placeholder="Main video prompt...
---
Negative prompt (things to avoid)...
---
Audio prompt (sounds)..."
        class="w-full font-mono text-sm" size="sm"
      />
      <p class="text-[10px] text-slate-400">Separate sections with <code class="px-1 py-0.5 rounded bg-slate-100">---</code> on its own line. Order: prompt → negative → audio.</p>
    </div>

    <!-- Batch mode -->
    <BatchJsonInput v-if="batchMode" v-model:prompts="batchPrompts" label="Upload Video Prompts JSON" placeholder='["a cat walking through a garden", "ocean waves crashing"]'>
      <template #hint><br />Each prompt generates one video per selected duration.</template>
      <template #badges>
        <UBadge size="xs" variant="subtle" color="info">{{ totalCount }} total video{{ totalCount !== 1 ? 's' : '' }}</UBadge>
      </template>
    </BatchJsonInput>

    <!-- Model Selector -->
    <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="cyan" @update:selected="selectedModel = $event as string" />

    <!-- Settings -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Negative prompt" size="sm">
          <UTextarea v-model="negativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
        </UFormField>

        <UFormField v-if="isLtx2" label="Audio prompt" size="sm">
          <div class="flex items-center gap-2">
            <UTextarea v-model="audioPrompt" placeholder="birds chirping, wind blowing, footsteps on gravel..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
          </div>
          <UButton v-if="isLtx2" size="xs" variant="link" color="neutral" class="mt-1" @click="openCombined">
            <UIcon name="i-lucide-merge" class="w-3 h-3" /> Edit as combined 3-part prompt
          </UButton>
        </UFormField>

        <DurationPicker v-model="numFrames" :presets="durationPresets" />

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <StepsSlider v-model="steps" :min="params.steps.min" :max="params.steps.max" />
          <ResolutionPicker v-model="resolutionIndex" :presets="params.resolutions" />
          <UFormField v-if="params.lora" label="LoRA" size="sm">
            <div class="flex items-center gap-2">
              <USlider v-model="loraStrength" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" class="w-28" size="xs" />
              <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ loraStrength.toFixed(2) }}</span>
            </div>
          </UFormField>
          <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2">
              <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
              <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" title="Random seed" />
            </div>
          </UFormField>
        </div>
      </div>
    </UCard>

    <!-- Summary card -->
    <UCard v-if="canGenerate" variant="subtle">
      <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Video settings</div>
      <p class="text-xs text-slate-600">
        {{ totalCount }} video{{ totalCount !== 1 ? 's' : '' }} · {{ steps }} steps · {{ currentResolution.w }}×{{ currentResolution.h }}
      </p>
    </UCard>

    <!-- Batch progress -->
    <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200">
      <div class="w-4 h-4 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
      <div class="text-xs text-cyan-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} videos. Waiting…</div>
    </div>
  </div>
</template>
