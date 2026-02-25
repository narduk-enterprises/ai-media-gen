<script setup lang="ts">
import { VIDEO_MODELS } from '~/composables/useCreateShared'
import {
  DIRECTION_PRESETS, AUDIO_PRESETS, DEFAULT_NEGATIVE_PROMPT,
  randomAudioPrompt, I2V_PRESETS,
} from '~/composables/useVideoDefaults'

const gen = useGeneration()
const shared = useCreateShared()
const queue = useQueue()

// ─── Source Mode ─────────────────────────────────────────────
type SourceMode = 'gallery' | 'generate'
const sourceMode = ref<SourceMode>('gallery')

// ─── Gallery Image Source ────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')

function onImageSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaId.value = payload.mediaItemId || null
  uploadedBase64.value = payload.base64 || ''
}
function onImageClear() {
  selectedMediaId.value = null
  uploadedBase64.value = ''
}

// ─── Generate Image Source ───────────────────────────────────
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

const imagePrompt = ref('')
const imageModel = ref('cyberrealistic_pony')
const imageSteps = ref(30)
const imageCfg = ref(5.0)

// ─── Video Prompts ───────────────────────────────────────────
const motionPrompt = ref('')
const audioPrompt = ref('')
const negativePrompt = ref(DEFAULT_NEGATIVE_PROMPT)

// ─── Batch JSON ──────────────────────────────────────────────
interface BatchPipelineItem {
  imagePrompt: string
  motionPrompt?: string
  audioPrompt?: string
  negativePrompt?: string
}

const batchItems = ref<BatchPipelineItem[]>([])
const showBatchInput = ref(false)
const batchJsonInput = ref('')
const batchError = ref('')
const hasBatch = computed(() => batchItems.value.length > 0)

const BATCH_EXAMPLE = JSON.stringify([
  {
    imagePrompt: 'Stunning blonde girl on a tropical beach, golden hour, soft wind in her hair, cinematic photography',
    motionPrompt: 'she turns to camera and smiles, wind blowing through her hair, slow motion',
    audioPrompt: 'ocean waves, tropical ambience, gentle breeze',
    negativePrompt: 'worst quality, blurry, distorted',
  },
  {
    imagePrompt: 'Beautiful brunette in a sunlit European café, morning light, espresso on the table',
    motionPrompt: 'she takes a sip of espresso and glances up, soft smile, steam rising',
    audioPrompt: 'café ambience, clinking cups, soft jazz',
  },
], null, 2)

function parseBatchItems(raw: string): BatchPipelineItem[] | null {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const result: BatchPipelineItem[] = []
    for (const item of parsed) {
      const ip = typeof item === 'string' ? item : (item.imagePrompt ?? item.image_prompt ?? item.prompt ?? '')
      if (typeof ip === 'string' && ip.trim()) {
        result.push({
          imagePrompt: ip.trim(),
          motionPrompt: item.motionPrompt ?? item.motion_prompt ?? item.videoPrompt ?? item.video_prompt ?? undefined,
          audioPrompt: item.audioPrompt ?? item.audio_prompt ?? item.audio ?? undefined,
          negativePrompt: item.negativePrompt ?? item.negative_prompt ?? item.negative ?? undefined,
        })
      }
    }
    return result.length > 0 ? result : null
  } catch {
    return null
  }
}

function loadBatchJson() {
  batchError.value = ''
  const parsed = parseBatchItems(batchJsonInput.value.trim())
  if (parsed) {
    batchItems.value = parsed
    batchJsonInput.value = ''
    showBatchInput.value = false
  } else {
    batchError.value = 'Invalid JSON. Expected an array of objects with "imagePrompt" field.'
  }
}

function loadBatchExample() {
  batchJsonInput.value = BATCH_EXAMPLE
}

function removeBatchItem(idx: number) {
  batchItems.value = batchItems.value.filter((_, i) => i !== idx)
}

function clearBatch() {
  batchItems.value = []
  batchJsonInput.value = ''
  batchError.value = ''
}

// ─── Video Settings ──────────────────────────────────────────
const selectedModel = ref('ltx2')
const steps = ref(20)
const width = ref(1280)
const height = ref(720)
const numFrames = ref(241)
const fps = ref(24)
const loraStrength = ref(0.7)
const imageStrength = ref(1.0)
const selectedPreset = ref('quality_res2s')
const seed = ref(-1)
const count = ref(1)

const isLtx2 = computed(() => selectedModel.value === 'ltx2')
const params = computed(() => shared.getVideoModelParams(selectedModel.value))

onMounted(() => { audioPrompt.value = randomAudioPrompt() })

watch(selectedModel, (id) => {
  const p = shared.getVideoModelParams(id)
  steps.value = p.steps.default
  numFrames.value = p.durations[1]?.value ?? p.durations[0]?.value ?? 81
  if (p.fps) fps.value = p.fps.default
  if (p.lora) loraStrength.value = p.lora.default
  if (p.imageStrength) imageStrength.value = p.imageStrength.default
})

// ─── Can Generate ────────────────────────────────────────────
const hasGalleryImage = computed(() => !!selectedMediaId.value || !!uploadedBase64.value)
const hasImagePrompt = computed(() => imagePrompt.value.trim().length > 0)
const canGenerate = computed(() => {
  if (hasBatch.value) return true
  if (sourceMode.value === 'gallery') return hasGalleryImage.value
  return hasImagePrompt.value
})
const totalCount = computed(() => {
  if (hasBatch.value) return batchItems.value.length
  return canGenerate.value ? count.value : 0
})

// ─── Generate ────────────────────────────────────────────────
async function generate() {
  if (!canGenerate.value) return

  // Batch mode: loop through all batch items as pipeline jobs
  if (hasBatch.value) {
    let genId: string | undefined
    for (const item of batchItems.value) {
      const result = await gen.generatePipelineVideo({
        prompt: item.imagePrompt,
        negativePrompt: (item.negativePrompt ?? negativePrompt.value).trim(),
        width: width.value,
        height: height.value,
        steps: imageSteps.value,
        cfg: imageCfg.value,
        seed: seed.value,
        imageModel: imageModel.value,
        videoPrompt: item.motionPrompt?.trim() || item.imagePrompt,
        videoModel: selectedModel.value,
        videoSteps: steps.value,
        videoFrames: numFrames.value,
        videoFps: fps.value,
        loraStrength: loraStrength.value,
        imageStrength: imageStrength.value,
        count: 1,
        ...(genId ? { generationId: genId } : {}),
      })
    }
    return
  }

  if (sourceMode.value === 'gallery' && selectedMediaId.value) {
    // Use existing gallery image → I2V via video.post.ts
    for (let i = 0; i < count.value; i++) {
      await gen.makeVideo(selectedMediaId.value!, {
        model: selectedModel.value,
        prompt: motionPrompt.value.trim() || undefined,
        negativePrompt: negativePrompt.value.trim() || undefined,
        numFrames: numFrames.value,
        steps: steps.value,
        width: width.value,
        height: height.value,
        fps: isLtx2.value ? fps.value : undefined,
        loraStrength: isLtx2.value ? loraStrength.value : undefined,
        imageStrength: isLtx2.value ? imageStrength.value : undefined,
        audioPrompt: audioPrompt.value.trim() || undefined,
        preset: selectedPreset.value || undefined,
      })
    }
  } else if (sourceMode.value === 'generate') {
    // Generate image first, then video → T2I→I2V pipeline
    await gen.generatePipelineVideo({
      prompt: imagePrompt.value.trim(),
      negativePrompt: negativePrompt.value.trim(),
      width: width.value,
      height: height.value,
      steps: imageSteps.value,
      cfg: imageCfg.value,
      seed: seed.value,
      imageModel: imageModel.value,
      videoPrompt: motionPrompt.value.trim() || imagePrompt.value.trim(),
      videoModel: selectedModel.value,
      videoSteps: steps.value,
      videoFrames: numFrames.value,
      videoFps: fps.value,
      loraStrength: loraStrength.value,
      imageStrength: imageStrength.value,
      count: count.value,
    })
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-5 pt-3">
    <!-- Header -->
    <div class="bg-linear-to-r from-cyan-50 to-violet-50 border border-cyan-200 rounded-xl px-4 py-3">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-linear-to-br from-cyan-500 to-violet-500 flex items-center justify-center">
          <UIcon name="i-lucide-film" class="w-4 h-4 text-white" />
        </div>
        <div>
          <div class="font-semibold text-sm text-slate-800">Image → Video</div>
          <div class="text-[10px] text-slate-500">Pick or generate an image, add prompts, create stunning LTX-2 video</div>
        </div>
      </div>
    </div>

    <!-- ═══ 1. Source Mode ═══ -->
    <UCard variant="outline">
      <div class="space-y-4">
        <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">Image Source</h3>
        <div class="flex gap-2">
          <button
            class="flex-1 text-left px-4 py-3 rounded-xl border text-sm transition-all"
            :class="sourceMode === 'gallery'
              ? 'border-cyan-400 bg-cyan-50 text-cyan-700 ring-1 ring-cyan-300'
              : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'"
            @click="sourceMode = 'gallery'"
          >
            <span class="font-medium block">🖼️ Gallery Image</span>
            <span class="text-[10px] opacity-60 block mt-0.5">Pick an existing image from your gallery</span>
          </button>
          <button
            class="flex-1 text-left px-4 py-3 rounded-xl border text-sm transition-all"
            :class="sourceMode === 'generate'
              ? 'border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-300'
              : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'"
            @click="sourceMode = 'generate'"
          >
            <span class="font-medium block">✨ Generate Image</span>
            <span class="text-[10px] opacity-60 block mt-0.5">Type a prompt — AI creates the image first</span>
          </button>
        </div>

        <!-- Gallery Picker -->
        <div v-if="sourceMode === 'gallery'">
          <ImagePicker label="Pick an image to animate" @select="onImageSelect" @clear="onImageClear" />
        </div>

        <!-- Generate Image Prompt -->
        <div v-if="sourceMode === 'generate'" class="space-y-3">
          <UFormField label="Image Prompt" size="sm" description="Describe the image — this will be generated with AI before animating">
            <UTextarea v-model="imagePrompt" placeholder="Stunning girl on a tropical beach, golden hour, soft wind in her hair, cinematic photography, shallow depth of field..." :rows="3" autoresize class="w-full" size="sm" />
          </UFormField>

          <!-- Image Model Selector -->
          <div class="flex items-center gap-3">
            <span class="text-[10px] text-slate-500 uppercase tracking-wider font-semibold shrink-0">Image Model</span>
            <div class="flex flex-wrap gap-1.5">
              <UButton
                v-for="m in IMAGE_MODELS" :key="m.id"
                :variant="imageModel === m.id ? 'soft' : 'ghost'"
                :color="imageModel === m.id ? 'primary' : 'neutral'"
                size="xs" :icon="m.icon"
                @click="imageModel = m.id"
              >{{ m.label }}</UButton>
            </div>
          </div>

          <!-- Image Settings (collapsed) -->
          <details class="text-xs">
            <summary class="cursor-pointer text-slate-500 hover:text-slate-700">Image generation settings</summary>
            <div class="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
              <SliderField v-model="imageSteps" label="Steps" :min="4" :max="50" />
              <SliderField v-model="imageCfg" label="CFG" :min="1" :max="15" :step="0.5" />
              <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
                <div class="flex items-center gap-2">
                  <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
                  <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" />
                </div>
              </UFormField>
            </div>
          </details>
        </div>
      </div>
    </UCard>

    <!-- ═══ Batch JSON Import ═══ -->
    <UCard variant="outline" :class="showBatchInput ? 'ring-1 ring-violet-300' : ''">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2 cursor-pointer" @click="showBatchInput = !showBatchInput">
          <UIcon name="i-lucide-braces" class="w-4 h-4 text-violet-500" />
          <span class="text-sm font-medium text-slate-700">Batch JSON</span>
          <UBadge v-if="hasBatch" variant="subtle" color="primary" size="xs">{{ batchItems.length }} items</UBadge>
        </div>
        <UButton size="xs" :variant="showBatchInput ? 'soft' : 'ghost'" :color="showBatchInput ? 'primary' : 'neutral'" @click="showBatchInput = !showBatchInput">
          {{ showBatchInput ? 'Hide' : 'Paste Batch' }}
        </UButton>
      </div>
      <p v-if="!showBatchInput && !hasBatch" class="text-[10px] text-slate-400">
        Paste a JSON array — each object has: <code class="bg-slate-200 px-1 rounded">imagePrompt</code>, <code class="bg-slate-200 px-1 rounded">motionPrompt</code>, <code class="bg-slate-200 px-1 rounded">audioPrompt</code>, <code class="bg-slate-200 px-1 rounded">negativePrompt</code>.
        Each item generates an image (CyberRealistic Pony) then animates it with LTX-2.
      </p>
      <div v-if="showBatchInput" class="space-y-3">
        <UTextarea v-model="batchJsonInput" :rows="8" autoresize
          placeholder='[{ "imagePrompt": "...", "motionPrompt": "...", "audioPrompt": "..." }]'
          class="font-mono text-xs" size="sm" />
        <UAlert v-if="batchError" color="error" variant="subtle" :title="batchError" size="sm" />
        <div class="flex items-center gap-2">
          <UButton size="sm" color="primary" icon="i-lucide-check" @click="loadBatchJson">Load Batch</UButton>
          <UButton size="sm" variant="soft" color="secondary" icon="i-lucide-sparkles" @click="loadBatchExample">Load Example</UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="showBatchInput = false; batchJsonInput = ''; batchError = ''">Cancel</UButton>
        </div>
      </div>

      <!-- Batch items list -->
      <div v-if="hasBatch" class="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
        <div v-for="(item, i) in batchItems" :key="i" class="flex items-start gap-2 group p-2 rounded-lg border border-slate-100 hover:border-violet-200">
          <span class="text-[10px] text-slate-400 font-mono w-6 shrink-0 text-right pt-0.5">{{ i + 1 }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-700 font-medium line-clamp-1">🖼️ {{ item.imagePrompt }}</p>
            <p v-if="item.motionPrompt" class="text-[10px] text-cyan-600 line-clamp-1">🎬 {{ item.motionPrompt }}</p>
            <div class="flex gap-3">
              <span v-if="item.audioPrompt" class="text-[10px] text-amber-500 truncate max-w-[200px]">🔊 {{ item.audioPrompt }}</span>
              <span v-if="item.negativePrompt" class="text-[10px] text-red-400 truncate max-w-[200px]">⛔ {{ item.negativePrompt }}</span>
            </div>
          </div>
          <button class="p-0.5 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0" @click="removeBatchItem(i)">
            <UIcon name="i-lucide-x" class="w-3 h-3" />
          </button>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="clearBatch">Clear Batch</UButton>
        </div>
      </div>
    </UCard>

    <!-- ═══ 2. Motion Prompt (hidden when batch active) ═══ -->
    <template v-if="!hasBatch">
    <UCard variant="outline">
      <div class="space-y-3">
        <div>
          <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">🎬 Motion Prompt</h3>
          <p class="text-[10px] text-slate-400 mt-0.5">Describe how the image should be animated — camera movement, action, energy</p>
        </div>
        <div class="flex flex-wrap gap-1 mb-1">
          <UButton v-for="p in DIRECTION_PRESETS" :key="p.label" size="xs"
            :variant="motionPrompt === p.prompt ? 'soft' : 'ghost'"
            :color="motionPrompt === p.prompt ? 'primary' : 'neutral'"
            @click="motionPrompt = motionPrompt === p.prompt ? '' : p.prompt"
          >{{ p.label }}</UButton>
        </div>
        <UTextarea v-model="motionPrompt" placeholder="she turns to camera and smiles, wind blowing through her hair, slow motion, cinematic..." :rows="3" autoresize class="w-full" size="sm" />
      </div>
    </UCard>

    <!-- ═══ 3. Audio Prompt ═══ -->
    <UCard variant="outline">
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">🔊 Sound & Atmosphere</h3>
        <div class="flex flex-wrap gap-1 mb-1">
          <UButton v-for="p in AUDIO_PRESETS" :key="p.label" size="xs"
            :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
            :color="audioPrompt === p.prompt ? 'primary' : 'neutral'"
            @click="audioPrompt = audioPrompt === p.prompt ? '' : p.prompt"
          >{{ p.label }}</UButton>
        </div>
        <UTextarea v-model="audioPrompt" placeholder="upbeat electronic music, ocean waves, ambient wind..." :rows="2" autoresize class="w-full" size="sm" />
      </div>
    </UCard>

    <!-- ═══ 4. Negative Prompt ═══ -->
    <UCard variant="outline">
      <div class="space-y-2">
        <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">⛔ Negative Prompt</h3>
        <UTextarea v-model="negativePrompt" placeholder="Things to avoid..." :rows="1" autoresize class="w-full" size="sm" />
      </div>
    </UCard>
    </template>

    <!-- ═══ 5. I2V Presets ═══ -->
    <UCard v-if="isLtx2" variant="outline">
      <div class="space-y-3">
        <div>
          <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">I2V Generation Preset</h3>
          <p class="text-[10px] text-slate-400 mt-0.5">Controls how the video is generated — CFG, scheduler, sampler tuning</p>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          <button
            v-for="p in I2V_PRESETS" :key="p.key"
            class="text-left px-2 py-1.5 rounded-lg border text-xs transition-all"
            :class="selectedPreset === p.key
              ? 'border-cyan-400 bg-cyan-50 text-cyan-700 ring-1 ring-cyan-300'
              : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'"
            @click="selectedPreset = selectedPreset === p.key ? '' : p.key"
          >
            <span class="font-medium block truncate">{{ p.label }}</span>
            <span class="text-[9px] opacity-60 block truncate">{{ p.desc }}</span>
          </button>
        </div>
      </div>
    </UCard>

    <!-- ═══ 6. Video Settings ═══ -->
    <UCard variant="outline">
      <details>
        <summary class="text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:text-slate-800">
          Video Settings
        </summary>
        <div class="mt-4 space-y-4">
          <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="cyan" @update:selected="selectedModel = $event as string" />

          <UFormField label="Duration" size="sm">
            <div class="flex flex-wrap gap-2">
              <UButton v-for="d in params.durations" :key="d.value" size="xs"
                :variant="numFrames === d.value ? 'soft' : 'outline'" :color="numFrames === d.value ? 'primary' : 'neutral'"
                @click="numFrames = d.value">{{ d.label }} <span class="text-[10px] opacity-60">{{ d.description }}</span></UButton>
            </div>
          </UFormField>

          <ResolutionSelector v-model:width="width" v-model:height="height" />

          <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
            <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
            <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" />
            <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" />
            <FidelitySelector v-if="params.imageStrength" v-model="imageStrength" />
            <CountSelector v-model="count" label="Variations" :options="[1, 2, 4]" />
          </div>
        </div>
      </details>
    </UCard>

    <!-- ═══ Summary ═══ -->
    <UCard v-if="canGenerate" variant="subtle" class="bg-cyan-50/50">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-film" class="w-5 h-5 text-cyan-500" />
        <div>
          <div class="text-xs font-medium text-slate-700">
            {{ sourceMode === 'gallery' ? 'Gallery image' : `${IMAGE_MODELS.find(m => m.id === imageModel)?.label} image` }}
            → {{ selectedModel.toUpperCase() }} video ·
            {{ count }} variation{{ count !== 1 ? 's' : '' }} ·
            {{ width }}×{{ height }}
          </div>
          <div class="text-[10px] text-slate-500">
            {{ steps }} steps{{ isLtx2 ? `, ${fps}fps` : '' }}{{ selectedPreset ? `, ${I2V_PRESETS.find(p => p.key === selectedPreset)?.label || selectedPreset}` : '' }}
          </div>
        </div>
      </div>
    </UCard>

    <!-- Progress -->
    <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-cyan-50 border border-cyan-200">
      <div class="w-4 h-4 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
      <div class="text-xs text-cyan-700">Submitted {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }} video{{ gen.batchProgress.value.total !== 1 ? 's' : '' }}…</div>
    </div>
  </div>
</template>
