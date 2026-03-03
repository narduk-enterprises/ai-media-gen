<script setup lang="ts">
import { VIDEO_MODELS, LTX2_CAMERA_LORAS, LTX2_TEXT_ENCODERS } from '~/composables/models'
import { AUDIO_PRESETS, DEFAULT_NEGATIVE_PROMPT, LTX2_NEGATIVE_PROMPT } from '~/composables/useVideoDefaults'
import type { VideoPreset } from '~/components/VideoPromptLibrary.vue'
import type { BatchItem } from '~/components/BatchJsonInput.vue'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Local State ────────────────────────────────────────────────────────
const prompt = ref('')
const batchMode = ref(false)
const batchItems = ref<BatchItem[]>([])
const selectedModel = ref('ltx2')
const negativePrompt = ref(LTX2_NEGATIVE_PROMPT)
const numFrames = ref<number[]>([97])
const count = ref(1)
const steps = ref(35)
const resolutionIndex = ref(0)
const seed = ref(-1)
const loraStrength = ref(0.65)
const audioPrompt = ref('')
const cameraLora = ref('')
const cfg = ref(4.0)
const fps = ref(24)
const textEncoder = ref('')
const showLibrary = ref(false)
const showAdvanced = ref(false)

const isLtx2 = computed(() => selectedModel.value === 'ltx2')

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
  if (p.cfg) cfg.value = p.cfg.default
  if (p.fps) fps.value = p.fps.default
  // Set model-appropriate negative prompt
  negativePrompt.value = id === 'ltx2' ? LTX2_NEGATIVE_PROMPT : DEFAULT_NEGATIVE_PROMPT
  // Reset LTX-2 specific fields when switching away
  if (id !== 'ltx2') {
    audioPrompt.value = ''
    cameraLora.value = ''
  }
})

// ─── Apply preset from library ────────────────────────────────────────
function applyPreset(preset: VideoPreset) {
  prompt.value = preset.prompt
  audioPrompt.value = preset.audioPrompt
  negativePrompt.value = preset.negativePrompt
  selectedModel.value = preset.model
  steps.value = preset.steps
  numFrames.value = [preset.frames]
  seed.value = -1
  const p = shared.getVideoModelParams(preset.model)
  const idx = p.resolutions.findIndex((r: any) => r.w === preset.resolution.w && r.h === preset.resolution.h)
  if (idx >= 0) resolutionIndex.value = idx
  showLibrary.value = false
}

// ─── Generate ───────────────────────────────────────────────────────────
const allPrompts = computed(() => {
  if (batchMode.value && batchItems.value.length > 0) return batchItems.value.map(i => i.prompt)
  if (prompt.value.trim()) return [prompt.value.trim()]
  return []
})

const totalCount = computed(() => {
  if (batchMode.value) {
    if (batchItems.value.length === 0) return 0
    return batchItems.value.reduce((acc, item) => acc + (item.frames ? 1 : numFrames.value.length), 0)
  }
  return numFrames.value.length * count.value
})
const canGenerate = computed(() => allPrompts.value.length > 0)

async function generate() {
  if (!canGenerate.value) return
  if (batchMode.value) {
    await gen.generateText2Video({
      batchItems: batchItems.value,
      negativePrompt: negativePrompt.value,
      numFrames: numFrames.value, steps: steps.value,
      width: currentResolution.value.w, height: currentResolution.value.h,
      loraStrength: loraStrength.value, model: selectedModel.value, seed: seed.value,
      ...(isLtx2.value ? { audioPrompt: audioPrompt.value, cfg: cfg.value, fps: fps.value, cameraLora: cameraLora.value || undefined, textEncoder: textEncoder.value || undefined } : {}),
    })
  } else {
    const expandedFrames: number[] = []
    for (const nf of numFrames.value) { for (let i = 0; i < count.value; i++) expandedFrames.push(nf) }
    await gen.generateText2Video({
      prompt: prompt.value.trim(), negativePrompt: negativePrompt.value,
      numFrames: expandedFrames, steps: steps.value,
      width: currentResolution.value.w, height: currentResolution.value.h,
      loraStrength: loraStrength.value, model: selectedModel.value, seed: seed.value,
      ...(isLtx2.value ? { audioPrompt: audioPrompt.value, cfg: cfg.value, fps: fps.value, cameraLora: cameraLora.value || undefined, textEncoder: textEncoder.value || undefined } : {}),
    })
  }
}

// ─── Estimated time ─────────────────────────────────────────────────────
const estimatedTime = computed(() => {
  let totalFrames = 0
  if (batchMode.value) {
    totalFrames = batchItems.value.reduce((acc, item) => {
      const itemFrames = item.frames ? item.frames : numFrames.value.reduce((a, b) => a + b, 0)
      return acc + itemFrames
    }, 0)
  } else {
    totalFrames = numFrames.value.reduce((a, b) => a + b, 0) * count.value
  }
  // Rough estimates: Wan ~3s/frame, LTX-2 ~2s/frame at standard res
  const secsPerFrame = isLtx2.value ? 2 : 3
  const secs = totalFrames * secsPerFrame / (isLtx2.value ? 24 : 24)
  if (secs < 60) return `~${Math.ceil(secs)}s`
  return `~${Math.ceil(secs / 60)}min`
})

// ─── Persistence ────────────────────────────────────────────────────────
onMounted(() => {
  const route = useRoute()

  // Check for reuse settings from gallery (takes priority)
  if (route.query.reuse === '1') {
    try {
      const raw = sessionStorage.getItem('ai-media-gen:reuse')
      if (raw) {
        const r = JSON.parse(raw)
        sessionStorage.removeItem('ai-media-gen:reuse') // consume once

        // Set model first so the watcher applies defaults
        if (r.model && VIDEO_MODELS.some((v: any) => v.id === r.model)) {
          selectedModel.value = r.model
        }

        // After model watcher runs, apply the reuse overrides
        nextTick(() => {
          if (r.prompt) prompt.value = r.prompt
          if (r.negativePrompt) negativePrompt.value = r.negativePrompt
          if (r.steps != null) steps.value = Number(r.steps)
          if (r.numFrames != null) numFrames.value = [Number(r.numFrames)]
          if (r.cfg != null) cfg.value = Number(r.cfg)
          if (r.fps != null) fps.value = Number(r.fps)
          if (r.loraStrength != null) loraStrength.value = Number(r.loraStrength)
          if (r.audioPrompt) audioPrompt.value = r.audioPrompt
          if (r.cameraLora) cameraLora.value = r.cameraLora
          if (r.textEncoder) textEncoder.value = r.textEncoder
          if (r.seed != null && r.seed !== '') seed.value = Number(r.seed)
          // Match resolution
          if (r.width != null && r.height != null) {
            const w = Number(r.width)
            const h = Number(r.height)
            const p = shared.getVideoModelParams(selectedModel.value)
            const idx = p.resolutions.findIndex((res: any) => res.w === w && res.h === h)
            if (idx >= 0) resolutionIndex.value = idx
          }
        })
        return // skip normal restore when reusing
      }
    } catch {}
  }

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
  if (s.t2v_cameraLora != null) cameraLora.value = s.t2v_cameraLora
  if (s.t2v_cfg != null) cfg.value = s.t2v_cfg
  if (s.t2v_fps != null) fps.value = s.t2v_fps
  if (s.t2v_textEncoder != null) textEncoder.value = s.t2v_textEncoder
})

watch([prompt, selectedModel, negativePrompt, steps, seed, resolutionIndex, numFrames, count, audioPrompt, cameraLora, cfg, fps, textEncoder], () => {
  shared.persistForm({
    t2v_prompt: prompt.value, t2v_model: selectedModel.value, t2v_neg: negativePrompt.value,
    t2v_steps: steps.value, t2v_seed: seed.value, t2v_resIdx: resolutionIndex.value,
    t2v_numFrames: numFrames.value, t2v_count: count.value, t2v_audioPrompt: audioPrompt.value,
    t2v_cameraLora: cameraLora.value, t2v_cfg: cfg.value, t2v_fps: fps.value,
    t2v_textEncoder: textEncoder.value,
  })
}, { deep: true })

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-5 pt-4">
    <!-- ═══ Toolbar ═══ -->
    <div class="flex items-center gap-2">
      <UButton size="xs" :variant="showLibrary ? 'soft' : 'ghost'" :color="showLibrary ? 'warning' : 'neutral'" @click="showLibrary = !showLibrary">
        <UIcon name="i-lucide-sparkles" class="w-3.5 h-3.5" /> Prompt Library
      </UButton>
      <UButton size="xs" :variant="!batchMode ? 'soft' : 'ghost'" :color="!batchMode ? 'primary' : 'neutral'" @click="batchMode = false; showLibrary = false">
        <UIcon name="i-lucide-type" class="w-3.5 h-3.5" /> Single
      </UButton>
      <UButton size="xs" :variant="batchMode ? 'soft' : 'ghost'" :color="batchMode ? 'primary' : 'neutral'" @click="batchMode = true; showLibrary = false">
        <UIcon name="i-lucide-layers" class="w-3.5 h-3.5" /> Batch
      </UButton>
    </div>

    <!-- Prompt Library -->
    <VideoPromptLibrary v-if="showLibrary" @select="applyPreset" />

    <!-- ═══ 1. Prompt ═══ -->
    <div v-if="!showLibrary">
      <!-- Single prompt mode -->
      <div v-if="!batchMode">
        <PromptInput v-model="prompt" media-type="video" placeholder="Describe the video you want to generate..." :disabled="gen.generating.value" />
        <CountSelector v-model="count" label="Videos per duration" :options="[1, 2, 4]" class="mt-3" />
      </div>

      <!-- Batch mode — JSON array -->
      <div v-else class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Batch Prompts</span>
          <UBadge v-if="batchItems.length > 0" size="xs" variant="subtle" color="info">{{ batchItems.length }} prompt{{ batchItems.length !== 1 ? 's' : '' }} · {{ totalCount }} video{{ totalCount !== 1 ? 's' : '' }}</UBadge>
        </div>
        <BatchJsonInput
          v-model:items="batchItems"
          label="Video Batch Prompts"
          rich-mode
          placeholder='[{"prompt": "...", "negativePrompt": "...", "audioPrompt": "..."}]'
        />
      </div>
    </div>

    <!-- ═══ 2. Model ═══ -->
    <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="cyan" @update:selected="selectedModel = $event as string" />

    <!-- ═══ 2.5 Wan 2.2 Quality Toggle ═══ -->
    <div v-if="selectedModel === 'wan22'" class="flex items-center gap-3 px-4 py-3 rounded-xl bg-linear-to-r from-amber-50 to-orange-50 border border-amber-200/60">
      <UIcon name="i-lucide-gauge" class="w-4 h-4 text-amber-600 shrink-0" />
      <div class="flex gap-2">
        <UButton size="xs" :variant="steps <= 4 ? 'soft' : 'ghost'" :color="steps <= 4 ? 'warning' : 'neutral'" @click="steps = 4; cfg = 1">
          ⚡ Fast (4 steps)
        </UButton>
        <UButton size="xs" :variant="steps > 4 ? 'soft' : 'ghost'" :color="steps > 4 ? 'success' : 'neutral'" @click="steps = 25; cfg = 4.0">
          💎 Quality (25 steps)
        </UButton>
      </div>
      <span class="text-[10px] text-amber-600 ml-auto">{{ steps <= 4 ? 'Distilled LoRA — fast but lower quality' : 'Base model — slower but much better quality' }}</span>
    </div>

    <!-- ═══ 3. Video Settings ═══ -->
    <UCard variant="outline">
      <div class="space-y-4">
        <DurationPicker v-model="numFrames" :presets="durationPresets" />

        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <StepsSlider v-model="steps" :min="params.steps.min" :max="params.steps.max" :hint="params.steps.hint" />
          <ResolutionPicker v-model="resolutionIndex" :presets="params.resolutions" />
          <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2">
              <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
              <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" title="Random seed" />
            </div>
          </UFormField>
          
          <SliderField v-if="params.cfg" v-model="cfg" label="CFG" :min="params.cfg.min" :max="params.cfg.max" :step="params.cfg.step" :description="params.cfg.hint" />
          <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" :description="params.fps.hint" />
          <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" :description="params.lora.hint" />
        </div>
      </div>
    </UCard>

    <!-- ═══ 4. LTX-2 Audio & Camera ═══ -->
    <UCard v-if="isLtx2" variant="outline">
      <div class="space-y-4">
        <!-- Audio prompt -->
        <div class="space-y-2">
          <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">🔊 Audio Prompt</h3>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-for="p in AUDIO_PRESETS" :key="p.label" size="xs"
              :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
              :color="audioPrompt === p.prompt ? 'secondary' : 'neutral'"
              @click="audioPrompt = audioPrompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="audioPrompt" placeholder="birds chirping, wind blowing, footsteps on gravel..." :rows="2" autoresize class="w-full" size="sm" />
        </div>

        <!-- Camera LoRA -->
        <div class="space-y-2">
          <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">🎥 Camera Motion</h3>
          <div class="flex flex-wrap gap-1.5">
            <UButton
              size="xs"
              :variant="!cameraLora ? 'soft' : 'ghost'"
              :color="!cameraLora ? 'primary' : 'neutral'"
              @click="cameraLora = ''"
            >None</UButton>
            <UButton
              v-for="cam in LTX2_CAMERA_LORAS" :key="cam.id" size="xs"
              :variant="cameraLora === cam.id ? 'soft' : 'ghost'"
              :color="cameraLora === cam.id ? 'primary' : 'neutral'"
              @click="cameraLora = cameraLora === cam.id ? '' : cam.id"
            >{{ cam.label }}</UButton>
          </div>
          <p class="text-[10px] text-slate-400">Adds a camera motion LoRA to the generation. Only one can be active at a time.</p>
        </div>

        <!-- Text Encoder -->
        <div class="space-y-2">
          <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">🧠 Text Encoder</h3>
          <div class="flex flex-wrap gap-1.5">
            <UButton
              v-for="enc in LTX2_TEXT_ENCODERS" :key="enc.id" size="xs"
              :variant="textEncoder === enc.filename ? 'soft' : 'ghost'"
              :color="textEncoder === enc.filename ? 'primary' : 'neutral'"
              @click="textEncoder = enc.filename"
            >{{ enc.label }}</UButton>
          </div>
          <p class="text-[10px] text-slate-400">Abliterated encoders may produce more realistic or uncensored video results. <span class="font-semibold text-slate-500">For maximum prompt adherence, select Sikaworld.</span></p>
        </div>
      </div>
    </UCard>

    <!-- ═══ 5. Negative Prompt (collapsible) ═══ -->
    <div>
      <UButton size="xs" variant="ghost" color="neutral" @click="showAdvanced = !showAdvanced">
        <UIcon :name="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="w-3.5 h-3.5" />
        Negative Prompt
      </UButton>
      <UFormField v-if="showAdvanced" size="sm" class="mt-2">
        <UTextarea v-model="negativePrompt" placeholder="Things to avoid (optional)..." :rows="2" autoresize :disabled="gen.generating.value" class="w-full" size="sm" />
      </UFormField>
    </div>

    <!-- ═══ 6. Summary ═══ -->
    <UCard v-if="canGenerate" variant="subtle" class="bg-linear-to-r from-cyan-50 to-blue-50 border-cyan-200">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-[10px] text-cyan-600 uppercase tracking-wider font-semibold mb-0.5">Ready to generate</div>
          <p class="text-xs text-cyan-800">
            {{ totalCount }} video{{ totalCount !== 1 ? 's' : '' }}
            · {{ steps }} steps
            · {{ currentResolution.w }}×{{ currentResolution.h }}
            · {{ isLtx2 ? 'LTX-2' : 'Wan 2.2' }}
            <template v-if="isLtx2 && audioPrompt"> · 🔊 audio</template>
            <template v-if="isLtx2 && cameraLora"> · 🎥 {{ LTX2_CAMERA_LORAS.find(c => c.id === cameraLora)?.label }}</template>
          </p>
          <p class="text-[10px] text-cyan-500 mt-0.5">Est. {{ estimatedTime }}</p>
        </div>
        <UIcon name="i-lucide-rocket" class="w-5 h-5 text-cyan-400" />
      </div>
    </UCard>

    <!-- ═══ Progress ═══ -->
    <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200">
      <div class="w-4 h-4 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
      <div class="text-xs text-cyan-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} videos. Waiting…</div>
    </div>
  </div>
</template>
