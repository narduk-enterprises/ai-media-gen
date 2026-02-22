<script setup lang="ts">
const gen = useGeneration()
const queue = useQueue()

// ── Camera LoRA options ─────────────────────────────────────────────────
const CAMERA_LORAS = [
  { label: 'None', value: '' },
  { label: 'Dolly Left', value: 'dolly-left' },
  { label: 'Dolly Right', value: 'dolly-right' },
  { label: 'Dolly In', value: 'dolly-in' },
  { label: 'Dolly Out', value: 'dolly-out' },
  { label: 'Jib Up', value: 'jib-up' },
  { label: 'Jib Down', value: 'jib-down' },
  { label: 'Static', value: 'static' },
]

const I2V_PRESETS = [
  { label: 'None', value: '' },
  { label: 'Quality (res2s)', value: 'quality_res2s' },
  { label: 'Quality (euler)', value: 'quality_euler' },
  { label: 'Photorealistic', value: 'photorealistic' },
  { label: 'Max Fidelity', value: 'max_fidelity' },
  { label: 'Cinematic Breathe', value: 'cinematic_breathe' },
  { label: 'Gentle Wind', value: 'gentle_wind' },
  { label: 'Dreamy Drift', value: 'dreamy_drift' },
  { label: 'Natural Motion', value: 'natural_motion' },
  { label: 'Vivid Action', value: 'vivid_action' },
  { label: 'Soft Focus', value: 'soft_focus' },
  { label: 'Fluid Motion', value: 'fluid_motion' },
  { label: 'Tight Hold', value: 'tight_hold' },
  { label: 'Warm Glow', value: 'warm_glow' },
  { label: 'Dynamic Subtle', value: 'dynamic_subtle' },
  { label: 'Random', value: 'random' },
]

const DURATION_PRESETS = [
  { label: '3s', value: 73 },
  { label: '5s', value: 121 },
  { label: '7s', value: 169 },
  { label: '10s', value: 241 },
]

// ── Segment Interface ───────────────────────────────────────────────────
interface Segment {
  id: string
  type: 'text2video' | 'image2video'
  prompt: string
  frames: number
  steps: number
  cameraLora: string
  preset: string
  expanded: boolean
}

function newSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: crypto.randomUUID().slice(0, 8),
    type: 'text2video',
    prompt: '',
    frames: 121,
    steps: 20,
    cameraLora: '',
    preset: '',
    expanded: true,
    ...overrides,
  }
}

// ── State ───────────────────────────────────────────────────────────────
const segments = ref<Segment[]>([
  newSegment({
    prompt: 'Cinematic drone shot approaching a beautiful sorority girl driving a lime green golf cart down a sun-drenched palm tree lined path, golden hour lighting, she glances up at the camera with a confident smile, wind blowing through her blonde hair, warm California vibes, shallow depth of field, film grain, 4K cinematic quality',
    frames: 121,
    cameraLora: 'dolly-in',
    expanded: true,
  }),
  newSegment({
    type: 'image2video',
    prompt: 'Close-up side profile tracking shot of a gorgeous girl laughing and drinking a cold beer while steering a golf cart one-handed, condensation dripping down the bottle, sunlight catching her aviator sunglasses, natural skin texture, bokeh background of lush green grass and spanish colonial buildings, smooth natural motion, photorealistic',
    frames: 241,
    preset: 'natural_motion',
    expanded: false,
  }),
  newSegment({
    type: 'image2video',
    prompt: 'Wide pullback shot as the golf cart drives away down a tree-canopied avenue, girl waves goodbye over her shoulder without looking back, long afternoon shadows stretching across the path, dust particles floating in golden light beams, the cart shrinks into the vanishing point, cinematic depth, nostalgic summer feeling',
    frames: 145,
    cameraLora: 'dolly-out',
    preset: 'cinematic_breathe',
    expanded: false,
  }),
])

const width = ref(1280)
const height = ref(720)
const fps = ref(24)
const transition = ref<'crossfade' | 'cut'>('crossfade')
const transitionDuration = ref(0.5)
const submitting = ref(false)
const result = ref<{ id: string; status: string } | null>(null)
const error = ref('')

// ── Computed ────────────────────────────────────────────────────────────
const totalFrames = computed(() => segments.value.reduce((s, seg) => s + seg.frames, 0))
const totalDuration = computed(() => Math.round(totalFrames.value / fps.value * 10) / 10)
const canGenerate = computed(() => segments.value.length > 0 && segments.value.every(s => s.prompt.trim()))
const totalCount = computed(() => 1)

// ── Segment Management ─────────────────────────────────────────────────
function addSegment() {
  segments.value.push(newSegment({ expanded: true }))
}

function removeSegment(idx: number) {
  segments.value.splice(idx, 1)
}

function moveSegment(idx: number, dir: -1 | 1) {
  const newIdx = idx + dir
  if (newIdx < 0 || newIdx >= segments.value.length) return
  const temp = segments.value[idx]!
  segments.value[idx] = segments.value[newIdx]!
  segments.value[newIdx] = temp
}

function toggleExpand(idx: number) {
  segments.value[idx]!.expanded = !segments.value[idx]!.expanded
}

function getDurationLabel(frames: number): string {
  const secs = Math.round(frames / fps.value * 10) / 10
  return `${secs}s`
}

// ── Generate ────────────────────────────────────────────────────────────
async function generate() {
  if (!canGenerate.value || submitting.value) return
  submitting.value = true
  error.value = ''
  result.value = null

  try {
    const { effectiveEndpoint } = useAppSettings()
    const res = await $fetch<{ item: any }>('/api/generate/multi-segment-video', {
      method: 'POST',
      body: {
        segments: segments.value.map((s, i) => ({
          type: i === 0 ? 'text2video' : s.type,
          prompt: s.prompt,
          frames: s.frames,
          steps: s.steps,
          ...(s.cameraLora ? { camera_lora: s.cameraLora } : {}),
          ...(s.preset ? { preset: s.preset } : {}),
          ...(i > 0 && s.type === 'image2video' ? { image: 'auto' } : {}),
        })),
        width: width.value,
        height: height.value,
        fps: fps.value,
        transition: transition.value,
        transitionDuration: transitionDuration.value,
        endpoint: effectiveEndpoint.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    result.value = res.item
    if (res.item) {
      gen.results.value.push(res.item)
      queue.submitAndTrack(res.item.id)
    }
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Multi-segment generation failed'
  } finally {
    submitting.value = false
  }
}

// ── JSON Import ─────────────────────────────────────────────────────────
const showJsonImport = ref(false)
const jsonInput = ref('')

function importJson() {
  try {
    const data = JSON.parse(jsonInput.value)
    const segs = data.segments || data
    if (!Array.isArray(segs)) throw new Error('Expected array of segments')
    segments.value = segs.map((s: any, i: number) => newSegment({
      type: i === 0 ? 'text2video' : (s.type || 'image2video'),
      prompt: s.prompt || '',
      frames: s.frames || 121,
      steps: s.steps || 20,
      cameraLora: s.camera_lora || '',
      preset: s.preset || '',
      expanded: i === 0,
    }))
    if (data.width) width.value = data.width
    if (data.height) height.value = data.height
    if (data.fps) fps.value = data.fps
    if (data.transition) transition.value = data.transition
    showJsonImport.value = false
    jsonInput.value = ''
  } catch (e: any) {
    error.value = `JSON parse error: ${e.message}`
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-4 pt-3">
    <!-- Header -->
    <div class="bg-gradient-to-r from-orange-50 to-rose-50 border border-orange-200 rounded-xl px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center">
            <UIcon name="i-lucide-scissors" class="w-4 h-4 text-white" />
          </div>
          <div>
            <div class="font-semibold text-sm text-slate-800">Multi-Segment Video</div>
            <div class="text-[10px] text-slate-500">Chain multiple shots into one cinematic video</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UBadge variant="subtle" color="warning" size="xs">{{ segments.length }} segments</UBadge>
          <UBadge variant="subtle" color="info" size="xs">~{{ totalDuration }}s total</UBadge>
        </div>
      </div>
    </div>

    <!-- ═══ Paste JSON ═══ -->
    <UCard variant="outline" :class="showJsonImport ? 'ring-1 ring-violet-300' : ''">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2 cursor-pointer" @click="showJsonImport = !showJsonImport">
          <UIcon name="i-lucide-clipboard-paste" class="w-4 h-4 text-violet-500" />
          <span class="text-sm font-medium text-slate-700">Paste JSON Prompt</span>
        </div>
        <UButton size="xs" :variant="showJsonImport ? 'soft' : 'ghost'" :color="showJsonImport ? 'primary' : 'neutral'" @click="showJsonImport = !showJsonImport">
          {{ showJsonImport ? 'Hide' : 'Paste JSON' }}
        </UButton>
      </div>
      <p v-if="!showJsonImport" class="text-[10px] text-slate-400">Have a JSON payload from another AI agent? Click to paste it and auto-fill all segments.</p>
      <div v-if="showJsonImport" class="space-y-3">
        <UTextarea v-model="jsonInput" :rows="8" autoresize
          placeholder='{
  "segments": [
    { "type": "text2video", "prompt": "...", "frames": 121, "camera_lora": "dolly-in" },
    { "type": "image2video", "prompt": "...", "frames": 241, "preset": "natural_motion", "image": "auto" }
  ],
  "width": 1280, "height": 720, "fps": 24, "transition": "crossfade"
}'
          class="font-mono text-xs" size="sm" />
        <div class="flex items-center gap-2">
          <UButton size="sm" color="primary" icon="i-lucide-check" @click="importJson">Load Segments</UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="showJsonImport = false; jsonInput = ''">Cancel</UButton>
          <span v-if="segments.length" class="text-[10px] text-amber-500 ml-2">⚠ This will replace your current segments</span>
        </div>
      </div>
    </UCard>

    <!-- Error -->
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" :close="true" @update:open="error = ''" />

    <!-- Success -->
    <UAlert v-if="result" color="success" variant="subtle" icon="i-lucide-check-circle" title="Multi-segment video queued!" description="Check your queue for progress." />

    <!-- Global Settings -->
    <UCard variant="outline">
      <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <UFormField label="Resolution" size="sm">
          <div class="flex gap-1">
            <UButton size="xs" :variant="width === 1280 ? 'soft' : 'ghost'" @click="width = 1280; height = 720">1280×720</UButton>
            <UButton size="xs" :variant="width === 768 ? 'soft' : 'ghost'" @click="width = 768; height = 512">768×512</UButton>
          </div>
        </UFormField>
        <UFormField label="FPS" size="sm">
          <UInput v-model.number="fps" type="number" size="sm" class="w-16" />
        </UFormField>
        <UFormField label="Transition" size="sm">
          <div class="flex gap-1">
            <UButton size="xs" :variant="transition === 'crossfade' ? 'soft' : 'ghost'" @click="transition = 'crossfade'">Crossfade</UButton>
            <UButton size="xs" :variant="transition === 'cut' ? 'soft' : 'ghost'" @click="transition = 'cut'">Cut</UButton>
          </div>
        </UFormField>
        <UFormField v-if="transition === 'crossfade'" label="Fade (s)" size="sm">
          <UInput v-model.number="transitionDuration" type="number" step="0.1" size="sm" class="w-16" />
        </UFormField>
      </div>
    </UCard>

    <!-- Segments -->
    <div class="space-y-3">
      <TransitionGroup name="list">
        <UCard v-for="(seg, idx) in segments" :key="seg.id" variant="outline"
          :class="[seg.expanded ? 'ring-1 ring-orange-200' : '']">

          <!-- Collapsed header -->
          <div class="flex items-center gap-3 cursor-pointer" @click="toggleExpand(idx)">
            <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              :class="idx === 0 ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-600'">
              {{ idx + 1 }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-slate-700 truncate">
                {{ seg.prompt || '(empty prompt)' }}
              </div>
              <div class="text-[10px] text-slate-400 flex items-center gap-2">
                <span>{{ idx === 0 ? 'Text→Video' : seg.type === 'text2video' ? 'Text→Video' : 'Image→Video (auto)' }}</span>
                <span>·</span>
                <span>{{ getDurationLabel(seg.frames) }}</span>
                <span v-if="seg.cameraLora">· 🎥 {{ seg.cameraLora }}</span>
                <span v-if="seg.preset">· ✨ {{ seg.preset }}</span>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0" @click.stop>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-up" :disabled="idx === 0" square @click="moveSegment(idx, -1)" />
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-down" :disabled="idx === segments.length - 1" square @click="moveSegment(idx, 1)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="segments.length <= 1" square @click="removeSegment(idx)" />
              <UIcon :name="seg.expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-4 h-4 text-slate-400" @click="toggleExpand(idx)" />
            </div>
          </div>

          <!-- Expanded content -->
          <div v-if="seg.expanded" class="mt-4 space-y-3 border-t border-slate-100 pt-3">
            <!-- Prompt -->
            <UFormField label="Prompt" size="sm">
              <UTextarea v-model="seg.prompt" :rows="3" autoresize placeholder="Describe this segment..." class="w-full" size="sm" />
            </UFormField>

            <div class="flex flex-wrap items-end gap-x-5 gap-y-3">
              <!-- Duration -->
              <UFormField label="Duration" size="sm">
                <div class="flex gap-1">
                  <UButton v-for="d in DURATION_PRESETS" :key="d.value" size="xs"
                    :variant="seg.frames === d.value ? 'soft' : 'ghost'"
                    :color="seg.frames === d.value ? 'primary' : 'neutral'"
                    @click="seg.frames = d.value">{{ d.label }}</UButton>
                </div>
              </UFormField>

              <!-- Steps -->
              <UFormField label="Steps" size="sm">
                <UInput v-model.number="seg.steps" type="number" size="sm" class="w-16" />
              </UFormField>

              <!-- Camera LoRA -->
              <UFormField label="Camera" size="sm">
                <USelectMenu v-model="seg.cameraLora" :items="CAMERA_LORAS" value-key="value" class="w-32" size="sm" />
              </UFormField>

              <!-- Preset (for I2V segments) -->
              <UFormField v-if="idx > 0" label="Preset" size="sm">
                <USelectMenu v-model="seg.preset" :items="I2V_PRESETS" value-key="value" class="w-36" size="sm" />
              </UFormField>
            </div>

            <!-- Continuity note -->
            <div v-if="idx > 0" class="text-[10px] text-amber-600 flex items-center gap-1">
              <UIcon name="i-lucide-link" class="w-3 h-3" />
              Auto-continuity: last frame of segment {{ idx }} → first frame of this segment
            </div>
          </div>
        </UCard>
      </TransitionGroup>
    </div>

    <!-- Add segment -->
    <div class="flex justify-center">
      <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-plus" @click="addSegment">Add Segment</UButton>
    </div>

    <!-- Summary -->
    <UCard v-if="canGenerate" variant="subtle">
      <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Multi-segment summary</div>
      <p class="text-xs text-slate-600">
        {{ segments.length }} segments · ~{{ totalDuration }}s total · {{ width }}×{{ height }} · {{ fps }}fps · {{ transition }}
      </p>
    </UCard>
  </div>
</template>

<style scoped>
.list-enter-active, .list-leave-active {
  transition: all 0.3s ease;
}
.list-enter-from, .list-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
