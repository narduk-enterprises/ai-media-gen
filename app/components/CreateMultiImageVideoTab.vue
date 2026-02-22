<script setup lang="ts">
import { DIRECTION_PRESETS, AUDIO_PRESETS, DEFAULT_NEGATIVE_PROMPT, randomAudioPrompt, I2V_PRESETS } from '~/composables/useVideoDefaults'
import { VIDEO_MODELS } from '~/composables/useCreateShared'

const gen = useGeneration()
const queue = useQueue()
const shared = useCreateShared()

// ─── Segment data model ─────────────────────────────────────
interface Segment {
  id: string
  prompt: string
  image?: string
  preview?: string
  frames?: number
  steps?: number
  camera_lora?: string
  preset?: string
}

const DEFAULT_SEGMENTS: Omit<Segment, 'id'>[] = [
  {
    prompt: 'Cinematic drone shot approaching a gorgeous college girl driving a lime green golf cart down a sun-drenched palm tree lined campus road, golden hour lighting, she glances at the camera with a confident grin, wind blowing through her hair, cold beer in hand, shallow depth of field, film grain, 4K cinematic quality',
  },
  {
    prompt: 'Close-up tracking shot of her laughing and chugging a cold beer while steering the golf cart one-handed, condensation dripping off the bottle, aviator sunglasses catching sunlight, bokeh background of lush campus greenery and Spanish colonial buildings, smooth natural motion, photorealistic',
  },
  {
    prompt: 'Low angle side shot of the golf cart cruising past a crowded quad, students turning their heads, she tosses an empty beer can over her shoulder without looking, warm summer afternoon light, motion blur on the background, cinematic depth',
  },
  {
    prompt: 'Wide pullback shot as the golf cart drives away down a tree-canopied campus avenue, she raises a fresh beer triumphantly, long afternoon shadows stretching across the path, dust particles floating in golden light beams, nostalgic summer feeling',
  },
]

const segments = ref<Segment[]>([])
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// ─── Adding segments ─────────────────────────────────────────
function addPromptSegment(prompt = '') {
  segments.value.push({
    id: crypto.randomUUID().slice(0, 8),
    prompt,
  })
}

function addImageFiles(files: FileList | File[]) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const b64 = dataUrl.split(',')[1] || ''
      segments.value.push({
        id: crypto.randomUUID().slice(0, 8),
        prompt: '',
        image: b64,
        preview: dataUrl,
      })
    }
    reader.readAsDataURL(file)
  }
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) addImageFiles(input.files)
  input.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  if (e.dataTransfer?.files) addImageFiles(e.dataTransfer.files)
}

function removeSegment(idx: number) { segments.value.splice(idx, 1) }

function moveSegment(idx: number, dir: -1 | 1) {
  const to = idx + dir
  if (to < 0 || to >= segments.value.length) return
  const temp = segments.value[idx]!
  segments.value[idx] = segments.value[to]!
  segments.value[to] = temp
}

// ─── JSON Import ─────────────────────────────────────────────
const showJsonImport = ref(false)
const jsonInput = ref('')
const jsonError = ref('')

const EXAMPLE_JSON = JSON.stringify({
  segments: DEFAULT_SEGMENTS.map(s => ({ prompt: s.prompt })),
  targetDuration: 30,
  audioPrompt: 'upbeat summer indie music, golf cart engine humming, beer cans clinking, campus ambience, birds chirping, warm vibes',
  model: 'ltx2',
}, null, 2)

function importJson() {
  jsonError.value = ''
  try {
    const data = JSON.parse(jsonInput.value)

    // Accept { segments: [...] } or just an array of prompts/objects
    let segs: any[]
    if (data.segments && Array.isArray(data.segments)) {
      segs = data.segments
    } else if (Array.isArray(data)) {
      segs = data
    } else if (data.prompts && Array.isArray(data.prompts)) {
      segs = data.prompts.map((p: any) => typeof p === 'string' ? { prompt: p } : p)
    } else {
      throw new Error('Expected "segments" array, a top-level array, or "prompts" array')
    }

    if (segs.length === 0) throw new Error('No segments found')

    segments.value = segs.map((s: any) => ({
      id: crypto.randomUUID().slice(0, 8),
      prompt: typeof s === 'string' ? s : (s.prompt || ''),
      image: s.image || undefined,
      preview: undefined,
      frames: s.frames || undefined,
      steps: s.steps || undefined,
      camera_lora: s.camera_lora || undefined,
      preset: s.preset || undefined,
    }))

    // Apply top-level settings if present
    if (data.targetDuration) targetDuration.value = data.targetDuration
    if (data.audioPrompt) audioPrompt.value = data.audioPrompt
    if (data.negativePrompt) negativePrompt.value = data.negativePrompt
    if (data.model) selectedModel.value = data.model
    if (data.width) width.value = data.width
    if (data.height) height.value = data.height
    if (data.fps) fps.value = data.fps
    if (data.steps) steps.value = data.steps
    if (data.preset) selectedPreset.value = data.preset
    if (data.transition) transition.value = data.transition
    if (data.globalPrompt) globalPrompt.value = data.globalPrompt

    showJsonImport.value = false
    jsonInput.value = ''
  } catch (e: any) {
    jsonError.value = e.message
  }
}

function loadExample() {
  jsonInput.value = EXAMPLE_JSON
}

// ─── Settings ────────────────────────────────────────────────
const targetDuration = ref(30)
const selectedModel = ref('ltx2')
const globalPrompt = ref('')
const negativePrompt = ref(DEFAULT_NEGATIVE_PROMPT)
const audioPrompt = ref('')
const steps = ref(20)
const fps = ref(24)
const width = ref(1280)
const height = ref(720)
const loraStrength = ref(0.7)
const imageStrength = ref(1.0)
const selectedPreset = ref('')
const transition = ref<'crossfade' | 'cut'>('crossfade')
const transitionDuration = ref(0.5)
const submitting = ref(false)
const error = ref('')
const resultMeta = ref<any>(null)

const isLtx2 = computed(() => selectedModel.value === 'ltx2')
const params = computed(() => shared.getVideoModelParams(selectedModel.value))

const segmentCount = computed(() => segments.value.length)
const hasImages = computed(() => segments.value.some(s => s.image))
const perSegmentDuration = computed(() => {
  if (segmentCount.value === 0) return 0
  return Math.round(targetDuration.value / segmentCount.value * 10) / 10
})

function loadDefaults() {
  segments.value = DEFAULT_SEGMENTS.map(s => ({
    ...s,
    id: crypto.randomUUID().slice(0, 8),
  }))
  audioPrompt.value = 'upbeat summer indie music, golf cart engine humming, beer cans clinking, campus ambience, birds chirping, warm vibes'
  targetDuration.value = 30
  selectedModel.value = 'ltx2'
}

onMounted(() => {
  if (segments.value.length === 0) loadDefaults()
})

const DURATION_OPTIONS = [
  { label: '10s', value: 10, desc: 'Quick' },
  { label: '15s', value: 15, desc: 'Short' },
  { label: '20s', value: 20, desc: 'Medium' },
  { label: '30s', value: 30, desc: 'Standard' },
  { label: '45s', value: 45, desc: 'Long' },
  { label: '60s', value: 60, desc: 'Extra Long' },
]

// ─── Generate ────────────────────────────────────────────────
const canGenerate = computed(() =>
  segments.value.length >= 1 && segments.value.every(s => s.prompt.trim()),
)
const totalCount = computed(() => canGenerate.value ? 1 : 0)

async function generate() {
  if (!canGenerate.value || submitting.value) return
  submitting.value = true
  error.value = ''
  resultMeta.value = null

  try {
    const { effectiveEndpoint } = useAppSettings()
    const body: Record<string, any> = {
      segments: segments.value.map(seg => ({
        prompt: seg.prompt,
        ...(seg.image ? { image: seg.image } : {}),
        ...(seg.frames ? { frames: seg.frames } : {}),
        ...(seg.steps ? { steps: seg.steps } : {}),
        ...(seg.camera_lora ? { camera_lora: seg.camera_lora } : {}),
        ...(seg.preset ? { preset: seg.preset } : {}),
      })),
      targetDuration: targetDuration.value,
      audioPrompt: audioPrompt.value.trim() || undefined,
      negativePrompt: negativePrompt.value.trim() || undefined,
      model: selectedModel.value,
      width: width.value,
      height: height.value,
      steps: steps.value,
      transition: transition.value,
      transitionDuration: transitionDuration.value,
      endpoint: effectiveEndpoint.value,
    }
    if (isLtx2.value) {
      body.fps = fps.value
      body.loraStrength = loraStrength.value
      body.imageStrength = imageStrength.value
      if (selectedPreset.value) body.preset = selectedPreset.value
    }

    const res = await $fetch<{ item: any; meta: any }>('/api/generate/multi-image-video', {
      method: 'POST',
      body,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    resultMeta.value = res.meta
    if (res.item) {
      gen.results.value.push(res.item)
      queue.submitAndTrack(res.item.id)
    }
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Video generation failed'
  } finally {
    submitting.value = false
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-5 pt-3">
    <!-- Header -->
    <div class="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <UIcon name="i-lucide-film" class="w-4 h-4 text-white" />
          </div>
          <div>
            <div class="font-semibold text-sm text-slate-800">Multi-Image Video</div>
            <div class="text-[10px] text-slate-500">Prompts and/or images → full AI-generated video with motion + audio</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UButton size="xs" variant="ghost" color="violet" icon="i-lucide-rotate-ccw" @click="loadDefaults">Defaults</UButton>
          <UBadge v-if="segmentCount" variant="subtle" color="primary" size="xs">{{ segmentCount }} shot{{ segmentCount !== 1 ? 's' : '' }}</UBadge>
          <UBadge v-if="segmentCount >= 1" variant="subtle" color="info" size="xs">~{{ perSegmentDuration }}s each</UBadge>
          <UBadge variant="subtle" color="warning" size="xs">~{{ targetDuration }}s total</UBadge>
        </div>
      </div>
    </div>

    <!-- Error -->
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" :close="true" @update:open="error = ''" />

    <!-- Success -->
    <UAlert v-if="resultMeta" color="success" variant="subtle" icon="i-lucide-check-circle"
      :title="`${resultMeta.numSegments}-shot video queued!`"
      :description="`~${resultMeta.effectiveDuration}s · ${resultMeta.autoFrames} frames/shot · ${resultMeta.t2vCount} T2V + ${resultMeta.i2vCount} I2V · Check your queue`" />

    <!-- ═══ JSON Import ═══ -->
    <UCard variant="outline" :class="showJsonImport ? 'ring-1 ring-violet-300' : ''">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2 cursor-pointer" @click="showJsonImport = !showJsonImport">
          <UIcon name="i-lucide-braces" class="w-4 h-4 text-violet-500" />
          <span class="text-sm font-medium text-slate-700">Paste JSON</span>
        </div>
        <UButton size="xs" :variant="showJsonImport ? 'soft' : 'ghost'" :color="showJsonImport ? 'primary' : 'neutral'" @click="showJsonImport = !showJsonImport">
          {{ showJsonImport ? 'Hide' : 'Paste JSON' }}
        </UButton>
      </div>
      <p v-if="!showJsonImport" class="text-[10px] text-slate-400">Drop in a JSON array of prompts or segment objects — each one becomes a real AI-generated video clip.</p>
      <div v-if="showJsonImport" class="space-y-3">
        <UTextarea v-model="jsonInput" :rows="10" autoresize
          placeholder='{ "segments": [ { "prompt": "..." }, ... ], "targetDuration": 30 }'
          class="font-mono text-xs" size="sm" />
        <UAlert v-if="jsonError" color="error" variant="subtle" :title="jsonError" size="sm" />
        <div class="flex items-center gap-2">
          <UButton size="sm" color="primary" icon="i-lucide-check" @click="importJson">Load Segments</UButton>
          <UButton size="sm" variant="soft" color="violet" icon="i-lucide-sparkles" @click="loadExample">Load Example</UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="showJsonImport = false; jsonInput = ''; jsonError = ''">Cancel</UButton>
          <span v-if="segments.length" class="text-[10px] text-amber-500 ml-2">This will replace your current segments</span>
        </div>
      </div>
    </UCard>

    <!-- ═══ Image Upload Area ═══ -->
    <UCard variant="outline">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">Shots ({{ segmentCount }})</h3>
          <div class="flex items-center gap-2">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-image-plus" @click="fileInput?.click()">Add Images</UButton>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-plus" @click="addPromptSegment()">Add Prompt</UButton>
            <UButton v-if="segments.length" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="segments = []">Clear All</UButton>
          </div>
        </div>

        <!-- Drop zone -->
        <div
          class="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all"
          :class="dragOver ? 'border-violet-400 bg-violet-50/50' : 'border-slate-300 hover:border-violet-300 hover:bg-violet-50/20'"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop="onDrop"
          @click="fileInput?.click()"
        >
          <UIcon name="i-lucide-image-up" class="w-6 h-6 mx-auto mb-1" :class="dragOver ? 'text-violet-500' : 'text-slate-400'" />
          <p class="text-xs" :class="dragOver ? 'text-violet-600' : 'text-slate-500'">
            {{ dragOver ? 'Drop images here' : 'Drop images to add as I2V shots, or use "Add Prompt" for T2V shots' }}
          </p>
          <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFileSelect" />
        </div>

        <!-- Segment list -->
        <TransitionGroup name="list" tag="div" class="space-y-2">
          <div v-for="(seg, idx) in segments" :key="seg.id"
            class="flex items-start gap-3 p-2.5 rounded-lg border border-slate-200 hover:border-violet-200 transition-colors group"
          >
            <!-- Shot number + thumbnail -->
            <div class="shrink-0 flex flex-col items-center gap-1">
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                :class="seg.image ? 'bg-violet-500 text-white' : 'bg-amber-100 text-amber-700'">
                {{ idx + 1 }}
              </div>
              <img v-if="seg.preview" :src="seg.preview" alt="" class="w-16 h-10 rounded object-cover border" />
              <div v-else class="w-16 h-10 rounded bg-amber-50 border border-amber-200 flex items-center justify-center">
                <UIcon name="i-lucide-type" class="w-3.5 h-3.5 text-amber-400" />
              </div>
              <span class="text-[8px] uppercase font-medium" :class="seg.image ? 'text-violet-500' : 'text-amber-500'">
                {{ seg.image ? 'I2V' : 'T2V' }}
              </span>
            </div>

            <!-- Prompt -->
            <div class="flex-1 min-w-0">
              <UTextarea v-model="seg.prompt" :rows="2" autoresize
                :placeholder="seg.image ? 'Describe how this image should be animated...' : 'Describe this shot — AI will generate the whole thing...'"
                class="w-full" size="sm" />
            </div>

            <!-- Controls -->
            <div class="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-up" :disabled="idx === 0" square @click="moveSegment(idx, -1)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" square @click="removeSegment(idx)" />
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-down" :disabled="idx === segments.length - 1" square @click="moveSegment(idx, 1)" />
            </div>
          </div>
        </TransitionGroup>
      </div>
    </UCard>

    <!-- ═══ Duration ═══ -->
    <UCard variant="outline">
      <div class="space-y-3">
        <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">Total Video Duration</h3>
        <div class="flex flex-wrap gap-2">
          <UButton v-for="d in DURATION_OPTIONS" :key="d.value" size="sm"
            :variant="targetDuration === d.value ? 'soft' : 'outline'"
            :color="targetDuration === d.value ? 'primary' : 'neutral'"
            @click="targetDuration = d.value"
          >
            {{ d.label }}
            <span class="text-[10px] opacity-60 ml-1">{{ d.desc }}</span>
          </UButton>
        </div>
        <div class="flex items-center gap-3">
          <UFormField label="Custom (seconds)" size="sm">
            <UInput v-model.number="targetDuration" type="number" :min="5" :max="120" size="sm" class="w-24" />
          </UFormField>
          <p v-if="segmentCount >= 1" class="text-[10px] text-slate-400 mt-4">
            {{ segmentCount }} shot{{ segmentCount !== 1 ? 's' : '' }} x ~{{ perSegmentDuration }}s each = ~{{ targetDuration }}s video
          </p>
        </div>
      </div>
    </UCard>

    <!-- ═══ Style & Audio ═══ -->
    <UCard variant="outline">
      <div class="space-y-4">
        <UFormField label="Global Motion / Style" size="sm" description="Applied to all shots that don't have their own prompt">
          <div class="flex flex-wrap gap-1 mb-2">
            <UButton v-for="p in DIRECTION_PRESETS" :key="p.label" size="xs"
              :variant="globalPrompt === p.prompt ? 'soft' : 'ghost'"
              :color="globalPrompt === p.prompt ? 'primary' : 'neutral'"
              @click="globalPrompt = globalPrompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="globalPrompt" placeholder="Optional global style — each shot's prompt takes priority" :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

        <UFormField label="Audio / Soundtrack" size="sm" description="LTX-2 generates real audio baked into the video">
          <div class="flex flex-wrap gap-1 mb-2">
            <UButton v-for="p in AUDIO_PRESETS" :key="p.label" size="xs"
              :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
              :color="audioPrompt === p.prompt ? 'primary' : 'neutral'"
              @click="audioPrompt = audioPrompt === p.prompt ? '' : p.prompt"
            >{{ p.label }}</UButton>
          </div>
          <UTextarea v-model="audioPrompt" placeholder="Describe the audio (e.g. 'upbeat summer music, golf cart engine, campus ambience')" :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

        <UFormField label="Negative Prompt" size="sm">
          <UTextarea v-model="negativePrompt" placeholder="Things to avoid..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>
      </div>
    </UCard>

    <!-- ═══ I2V Preset (LTX2) ═══ -->
    <UCard v-if="isLtx2" variant="outline">
      <div class="space-y-3">
        <div>
          <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">I2V Generation Preset</h3>
          <p class="text-[10px] text-slate-400 mt-0.5">Controls how each shot is generated — CFG, scheduler, sampler tuning</p>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          <button
            v-for="p in I2V_PRESETS" :key="p.key"
            class="text-left px-2 py-1.5 rounded-lg border text-xs transition-all"
            :class="selectedPreset === p.key
              ? 'border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-300'
              : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'"
            @click="selectedPreset = selectedPreset === p.key ? '' : p.key"
          >
            <span class="font-medium block truncate">{{ p.label }}</span>
            <span class="text-[9px] opacity-60 block truncate">{{ p.desc }}</span>
          </button>
        </div>
      </div>
    </UCard>

    <!-- ═══ Advanced Settings ═══ -->
    <UCard variant="outline">
      <details>
        <summary class="text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:text-slate-800">
          Advanced Settings
        </summary>
        <div class="mt-4 space-y-4">
          <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="violet" @update:selected="selectedModel = $event as string" />
          <ResolutionSelector v-model:width="width" v-model:height="height" />
          <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
            <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
            <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" />
            <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" />
            <FidelitySelector v-if="params.imageStrength" v-model="imageStrength" />
          </div>
          <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
            <UFormField label="Transition" size="sm">
              <div class="flex gap-1">
                <UButton size="xs" :variant="transition === 'crossfade' ? 'soft' : 'ghost'" @click="transition = 'crossfade'">Crossfade</UButton>
                <UButton size="xs" :variant="transition === 'cut' ? 'soft' : 'ghost'" @click="transition = 'cut'">Hard Cut</UButton>
              </div>
            </UFormField>
            <UFormField v-if="transition === 'crossfade'" label="Fade (s)" size="sm">
              <UInput v-model.number="transitionDuration" type="number" step="0.1" size="sm" class="w-16" />
            </UFormField>
          </div>
        </div>
      </details>
    </UCard>

    <!-- ═══ Summary ═══ -->
    <UCard v-if="canGenerate" variant="subtle" class="bg-violet-50/50">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-film" class="w-5 h-5 text-violet-500" />
        <div>
          <div class="text-xs font-medium text-slate-700">
            {{ segmentCount }} shot{{ segmentCount !== 1 ? 's' : '' }} · ~{{ targetDuration }}s total · {{ width }}x{{ height }} · {{ selectedModel.toUpperCase() }}
          </div>
          <div class="text-[10px] text-slate-500">
            Each prompt → full AI generation ({{ steps }} steps{{ isLtx2 ? `, ${fps}fps, with audio` : '' }}) → stitched with {{ transition }}
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>

<style scoped>
.list-enter-active, .list-leave-active { transition: all 0.3s ease; }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateY(-10px); }
</style>
