<script setup lang="ts">
const gen = useGeneration()
const shared = useCreateShared()

// ─── Image Model Options ─────────────────────────────────────────────
const IMAGE_MODELS = [
  { id: 'cyberrealistic_pony', label: 'CyberRealistic Pony', icon: 'i-lucide-palette' },
  { id: 'juggernaut', label: 'Juggernaut XL', icon: 'i-lucide-shield' },
  { id: 'wan22', label: 'Wan 2.2', icon: 'i-lucide-wand-sparkles' },
  { id: 'z_image', label: 'Z-Image', icon: 'i-lucide-zap' },
  { id: 'epicrealism', label: 'epiCRealism', icon: 'i-lucide-camera' },
  { id: 'hyperbeast', label: 'Hyper Beast XXL', icon: 'i-lucide-zap' },
  { id: 'nsfw_sdxl', label: 'NSFW SDXL', icon: 'i-lucide-flame' },
  { id: 'porn_craft', label: 'Porn Craft', icon: 'i-lucide-sparkles' },
]

const VIDEO_MODELS = [
  { id: 'wan22', label: 'Wan 2.2 I2V', icon: 'i-lucide-film' },
  { id: 'ltx2', label: 'LTX-2', icon: 'i-lucide-flask-conical' },
]

const RESOLUTIONS = [
  { w: 832, h: 480, label: '832×480 (landscape)' },
  { w: 480, h: 832, label: '480×832 (portrait)' },
  { w: 768, h: 768, label: '768×768 (square)' },
  { w: 1024, h: 576, label: '1024×576 (wide)' },
  { w: 576, h: 1024, label: '576×1024 (tall)' },
]

const DURATION_PRESETS = [
  { label: '~3s', value: 49 },
  { label: '~5s', value: 81 },
  { label: '~8s', value: 129 },
  { label: '~10s', value: 161 },
]

// ─── State ────────────────────────────────────────────────────────────
const prompt = ref('')
const videoPrompt = ref('')
const negativePrompt = ref('')
const imageModel = ref('cyberrealistic_pony')
const videoModel = ref('wan22')
const resolutionIndex = ref(0)
const steps = ref(30)
const cfg = ref(5.0)
const videoSteps = ref(20)
const videoFrames = ref(81)
const count = ref(1)
const seed = ref(-1)
const useVideoPrompt = ref(false)

// ─── Computed ─────────────────────────────────────────────────────────
const resolution = computed(() => RESOLUTIONS[resolutionIndex.value] ?? RESOLUTIONS[0]!)
const canGenerate = computed(() => prompt.value.trim().length > 0)
const totalCount = computed(() => count.value)
const effectiveVideoPrompt = computed(() => useVideoPrompt.value && videoPrompt.value.trim() ? videoPrompt.value.trim() : prompt.value.trim())

// ─── Generate ─────────────────────────────────────────────────────────
async function generate() {
  if (!canGenerate.value) return
  await gen.generatePipelineVideo({
    prompt: prompt.value.trim(),
    negativePrompt: negativePrompt.value,
    width: resolution.value.w,
    height: resolution.value.h,
    steps: steps.value,
    cfg: cfg.value,
    seed: seed.value,
    imageModel: imageModel.value,
    videoPrompt: effectiveVideoPrompt.value,
    videoModel: videoModel.value,
    videoSteps: videoSteps.value,
    videoFrames: videoFrames.value,
    count: count.value,
  })
}

// ─── Persistence ──────────────────────────────────────────────────────
onMounted(() => {
  const s = shared.restoreForm()
  if (s.pipe_prompt != null) prompt.value = s.pipe_prompt
  if (s.pipe_vidPrompt != null) videoPrompt.value = s.pipe_vidPrompt
  if (s.pipe_neg != null) negativePrompt.value = s.pipe_neg
  if (s.pipe_imgModel != null) imageModel.value = s.pipe_imgModel
  if (s.pipe_vidModel != null) videoModel.value = s.pipe_vidModel
  if (s.pipe_steps != null) steps.value = s.pipe_steps
  if (s.pipe_cfg != null) cfg.value = s.pipe_cfg
  if (s.pipe_vidSteps != null) videoSteps.value = s.pipe_vidSteps
  if (s.pipe_vidFrames != null) videoFrames.value = s.pipe_vidFrames
  if (s.pipe_resIdx != null) resolutionIndex.value = s.pipe_resIdx
  if (s.pipe_count != null) count.value = s.pipe_count
  if (s.pipe_seed != null) seed.value = s.pipe_seed
  if (s.pipe_useVidPrompt != null) useVideoPrompt.value = s.pipe_useVidPrompt
})

watch([prompt, videoPrompt, negativePrompt, imageModel, videoModel, steps, cfg, videoSteps, videoFrames, resolutionIndex, count, seed, useVideoPrompt], () => {
  shared.persistForm({
    pipe_prompt: prompt.value, pipe_vidPrompt: videoPrompt.value, pipe_neg: negativePrompt.value,
    pipe_imgModel: imageModel.value, pipe_vidModel: videoModel.value,
    pipe_steps: steps.value, pipe_cfg: cfg.value,
    pipe_vidSteps: videoSteps.value, pipe_vidFrames: videoFrames.value,
    pipe_resIdx: resolutionIndex.value, pipe_count: count.value, pipe_seed: seed.value,
    pipe_useVidPrompt: useVideoPrompt.value,
  })
}, { deep: true })

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Pipeline badge -->
    <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-50 to-cyan-50 border border-violet-200/50">
      <UIcon name="i-lucide-workflow" class="w-4 h-4 text-violet-500 shrink-0" />
      <span class="text-xs text-violet-700 font-medium">Pipeline: Text → Image → Video (automated)</span>
    </div>

    <!-- Image Prompt -->
    <PromptInput v-model="prompt" placeholder="Describe the scene — this creates the image AND drives the video..." :disabled="gen.generating.value" />

    <!-- Video Prompt (optional override) -->
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <UToggle v-model="useVideoPrompt" size="sm" />
        <span class="text-xs text-slate-600">Separate video prompt (describe the motion)</span>
      </div>
      <UTextarea
        v-if="useVideoPrompt"
        v-model="videoPrompt"
        placeholder="she turns and smiles, wind in her hair, camera slowly orbits around..."
        :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm"
      />
    </div>

    <!-- Model Selectors -->
    <div class="grid grid-cols-2 gap-4">
      <UCard variant="outline">
        <div class="space-y-2">
          <div class="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Image Model</div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="m in IMAGE_MODELS" :key="m.id"
              :variant="imageModel === m.id ? 'soft' : 'ghost'"
              :color="imageModel === m.id ? 'primary' : 'neutral'"
              size="xs" :icon="m.icon"
              @click="imageModel = m.id"
            >{{ m.label }}</UButton>
          </div>
        </div>
      </UCard>
      <UCard variant="outline">
        <div class="space-y-2">
          <div class="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Video Model (I2V)</div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="m in VIDEO_MODELS" :key="m.id"
              :variant="videoModel === m.id ? 'soft' : 'ghost'"
              :color="videoModel === m.id ? 'info' : 'neutral'"
              size="xs" :icon="m.icon"
              @click="videoModel = m.id"
            >{{ m.label }}</UButton>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Settings -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Negative prompt" size="sm">
          <UTextarea v-model="negativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <!-- Image settings -->
          <div class="space-y-3">
            <div class="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Image Settings</div>
            <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
              <UFormField label="Steps" size="sm">
                <div class="flex items-center gap-2">
                  <USlider v-model="steps" :min="4" :max="50" class="w-24" size="xs" />
                  <span class="text-xs text-slate-600 font-mono w-6">{{ steps }}</span>
                </div>
              </UFormField>
              <UFormField label="CFG" size="sm">
                <div class="flex items-center gap-2">
                  <USlider v-model="cfg" :min="1" :max="15" :step="0.5" class="w-24" size="xs" />
                  <span class="text-xs text-slate-600 font-mono w-8">{{ cfg.toFixed(1) }}</span>
                </div>
              </UFormField>
            </div>
          </div>

          <!-- Video settings -->
          <div class="space-y-3">
            <div class="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Video Settings</div>
            <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
              <UFormField label="Steps" size="sm">
                <div class="flex items-center gap-2">
                  <USlider v-model="videoSteps" :min="4" :max="50" class="w-24" size="xs" />
                  <span class="text-xs text-slate-600 font-mono w-6">{{ videoSteps }}</span>
                </div>
              </UFormField>
              <UFormField label="Duration" size="sm">
                <div class="flex gap-1">
                  <UButton
                    v-for="d in DURATION_PRESETS" :key="d.value"
                    :variant="videoFrames === d.value ? 'soft' : 'ghost'"
                    :color="videoFrames === d.value ? 'info' : 'neutral'"
                    size="xs" @click="videoFrames = d.value"
                  >{{ d.label }}</UButton>
                </div>
              </UFormField>
            </div>
          </div>
        </div>

        <!-- Shared settings -->
        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <UFormField label="Resolution" size="sm">
            <div class="flex gap-1">
              <UButton
                v-for="(r, i) in RESOLUTIONS" :key="i"
                :variant="resolutionIndex === i ? 'soft' : 'ghost'"
                :color="resolutionIndex === i ? 'primary' : 'neutral'"
                size="xs" @click="resolutionIndex = i"
              >{{ r.label }}</UButton>
            </div>
          </UFormField>
          <CountSelector v-model="count" label="Variations" :options="[1, 2, 4]" />
          <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2">
              <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
              <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" title="Random seed" />
            </div>
          </UFormField>
        </div>
      </div>
    </UCard>

    <!-- Summary -->
    <UCard v-if="canGenerate" variant="subtle">
      <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Pipeline</div>
      <p class="text-xs text-slate-600">
        {{ count }} video{{ count !== 1 ? 's' : '' }} ·
        {{ IMAGE_MODELS.find(m => m.id === imageModel)?.label }} →
        {{ VIDEO_MODELS.find(m => m.id === videoModel)?.label }} ·
        {{ resolution.w }}×{{ resolution.h }} ·
        Image: {{ steps }} steps · Video: {{ videoSteps }} steps, {{ DURATION_PRESETS.find(d => d.value === videoFrames)?.label || videoFrames + 'f' }}
      </p>
    </UCard>

    <!-- Progress -->
    <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div class="text-xs text-violet-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} pipeline{{ gen.batchProgress.value.total !== 1 ? 's' : '' }}. Generating image then video…</div>
    </div>
  </div>
</template>
