<script setup lang="ts">
const queue = useQueue()
/**
 * LTX2 Tester — One image, all 10 I2V presets, side-by-side comparison.
 *
 * Flow:
 *  1. User picks a source image
 *  2. Clicks "Test All Presets" → submits 10 I2V jobs (one per preset)
 *  3. Results appear in a comparison grid as they complete
 *  4. User votes on the best result (thumbs up/down)
 *  5. Votes are stored via quality score → tracks winners over time
 */
const gen = useGeneration()

// ── I2V Presets (exact match with workflow_loader.py I2V_PRESETS) ────────
const I2V_PRESETS = [
  // Research-backed quality presets
  { key: 'quality_res2s', label: '🏆 Quality (res2s)', desc: 'Official best: res2_s + LoRA 0.60', color: 'yellow' },
  { key: 'quality_euler', label: '🎯 Quality (Euler)', desc: 'High quality euler + LoRA 0.80', color: 'lime' },
  { key: 'photorealistic', label: '📸 Photorealistic', desc: 'Optimized for photorealism, higher CFG', color: 'sky' },
  { key: 'max_fidelity', label: '💎 Max Fidelity', desc: 'Maximum quality, slow, best for hero shots', color: 'indigo' },
  // Motion-focused presets
  { key: 'cinematic_breathe', label: '🎬 Cinematic Breathe', desc: 'Subtle breathing/living motion, very faithful', color: 'violet' },
  { key: 'gentle_wind', label: '🌿 Gentle Wind', desc: 'Soft environmental motion, gentle breeze', color: 'emerald' },
  { key: 'dreamy_drift', label: '🌊 Dreamy Drift', desc: 'Dreamlike subtle movement, very smooth', color: 'blue' },
  { key: 'natural_motion', label: '🌲 Natural Motion', desc: 'Realistic natural movement, balanced', color: 'green' },
  { key: 'vivid_action', label: '⚡ Vivid Action', desc: 'More dynamic motion, slightly creative', color: 'amber' },
  { key: 'soft_focus', label: '📷 Soft Focus', desc: 'Soft cinematic feel, gentle transitions', color: 'rose' },
  { key: 'fluid_motion', label: '💧 Fluid Motion', desc: 'Smooth, flowing like water or silk', color: 'cyan' },
  { key: 'tight_hold', label: '🔒 Tight Hold', desc: 'Max fidelity, minimal but precise motion', color: 'slate' },
  { key: 'warm_glow', label: '🔥 Warm Glow', desc: 'Warm living quality, gentle light shifts', color: 'orange' },
  { key: 'dynamic_subtle', label: '✨ Dynamic Subtle', desc: 'Balanced between faithful and interesting', color: 'purple' },
] as const

// ── Source Image ─────────────────────────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedUrl = ref('')

function onImageSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaId.value = payload.mediaItemId || null
  uploadedUrl.value = payload.url || ''
}
function onImageClear() {
  selectedMediaId.value = null
  uploadedUrl.value = ''
}

// ── Settings ─────────────────────────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref('worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo')
const numFrames = ref(97)  // 4s — good for quick comparison
const steps = ref(30)
const width = ref(1280)
const height = ref(720)
const fps = ref(25)
const seed = ref(42)  // Fixed seed for fair comparison
const loraStrength = ref(0.80)
const audioPrompt = ref('')

// Advanced controls
const showAdvanced = ref(false)
const imageStrength = ref(1.0)
const cfg = ref(1.0)
const maxShift = ref(2.05)
const baseShift = ref(0.95)
const terminal = ref(0.1)
const cameraLora = ref('none')

const cameraLoraOptions = [
  { label: 'None', value: 'none' },
  { label: 'Dolly Left', value: 'dolly-left' },
]

const durationPresets = [
  { label: '2s', value: 49, desc: 'Ultra quick' },
  { label: '4s', value: 97, desc: 'Quick compare' },
  { label: '5s', value: 121, desc: 'Standard' },
  { label: '10s', value: 241, desc: 'Full length' },
]

const resPresets = [
  { label: '1280×720', w: 1280, h: 720 },
  { label: '768×512', w: 768, h: 512 },
  { label: '512×768', w: 512, h: 768 },
  { label: '720×1280', w: 720, h: 1280 },
]

// ── Test Run State ───────────────────────────────────────────────────────
interface TestEntry {
  presetKey: string
  presetLabel: string
  presetDesc: string
  itemId: string | null
  status: 'pending' | 'queued' | 'processing' | 'complete' | 'failed'
  url: string | null
  error: string | null
}

const testEntries = ref<TestEntry[]>([])
const testRunning = ref(false)
const testBatchId = ref<string | null>(null)
const hasImage = computed(() => !!selectedMediaId.value)
const canGenerate = computed(() => hasImage.value && !testRunning.value)
const totalCount = computed(() => canGenerate.value ? I2V_PRESETS.length : 0)

// ── Selected preset filter (run subset or all) ──────────────────────────
const enabledPresets = ref<Set<string>>(new Set(I2V_PRESETS.map(p => p.key)))

function togglePreset(key: string) {
  const s = new Set(enabledPresets.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  enabledPresets.value = s
}
function toggleAll() {
  if (enabledPresets.value.size === I2V_PRESETS.length) {
    enabledPresets.value = new Set()
  } else {
    enabledPresets.value = new Set(I2V_PRESETS.map(p => p.key))
  }
}

// ── Generate ─────────────────────────────────────────────────────────────
async function generate() {
  if (!canGenerate.value || !selectedMediaId.value) return

  testRunning.value = true
  testBatchId.value = crypto.randomUUID().slice(0, 8)

  const activePresets = I2V_PRESETS.filter(p => enabledPresets.value.has(p.key))

  // Initialize entries
  testEntries.value = activePresets.map(p => ({
    presetKey: p.key,
    presetLabel: p.label,
    presetDesc: p.desc,
    itemId: null,
    status: 'pending' as const,
    url: null,
    error: null,
  }))

  const { runpodEndpoint, customEndpoint } = useAppSettings()
  const endpoint = customEndpoint.value || runpodEndpoint.value

  // Submit each preset sequentially (to avoid overwhelming the queue)
  for (let i = 0; i < activePresets.length; i++) {
    const preset = activePresets[i]!
    const entry = testEntries.value[i]!

    try {
      entry.status = 'queued'

      const body: Record<string, any> = {
        mediaItemId: selectedMediaId.value,
        model: 'ltx2',
        prompt: prompt.value.trim() || undefined,
        negativePrompt: negativePrompt.value.trim() || undefined,
        numFrames: numFrames.value,
        steps: steps.value,
        width: width.value,
        height: height.value,
        fps: fps.value,
        loraStrength: loraStrength.value,
        imageStrength: imageStrength.value,
        seed: seed.value,
        preset: preset.key,
        audioPrompt: audioPrompt.value.trim() || undefined,
        cfg: cfg.value !== 1.0 ? cfg.value : undefined,
        maxShift: maxShift.value !== 2.05 ? maxShift.value : undefined,
        baseShift: baseShift.value !== 0.95 ? baseShift.value : undefined,
        terminal: terminal.value !== 0.1 ? terminal.value : undefined,
        cameraLora: cameraLora.value !== 'none' ? cameraLora.value : undefined,
        endpoint,
      }

      const result = await $fetch<{ item: { id: string; status: string } }>('/api/generate/video', {
        method: 'POST', body,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      if (result.item) {
        entry.itemId = result.item.id
        entry.status = 'processing'
        queue.refresh()  // Show in sidebar queue
      }
    } catch (e: any) {
      entry.status = 'failed'
      entry.error = e.data?.message || 'Failed to submit'
    }
  }

  testRunning.value = false
  startPolling()
}

// ── Poll for results ─────────────────────────────────────────────────────
let pollInterval: ReturnType<typeof setInterval> | null = null

function startPolling() {
  if (pollInterval) return
  pollInterval = setInterval(checkResults, 3000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function checkResults() {
  const active = testEntries.value.filter(e => e.itemId && e.status === 'processing')
  if (active.length === 0) {
    stopPolling()
    return
  }

  for (const entry of active) {
    try {
      const job = await $fetch<{ item: { status: string; url: string | null; error: string | null } }>(`/api/generate/job/${entry.itemId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      if (job.item.status === 'complete') {
        entry.status = 'complete'
        entry.url = job.item.url
      } else if (job.item.status === 'failed' || job.item.status === 'cancelled') {
        entry.status = 'failed'
        entry.error = job.item.error || 'Generation failed'
      }
    } catch {
      // Network error — keep polling
    }
  }
}

onUnmounted(() => stopPolling())

// ── Voting ───────────────────────────────────────────────────────────────
const votes = ref<Record<string, 'up' | 'down'>>({})

async function vote(presetKey: string, direction: 'up' | 'down') {
  votes.value[presetKey] = direction

  // Find the entry and store the quality score
  const entry = testEntries.value.find(e => e.presetKey === presetKey && e.itemId)
  if (!entry?.itemId) return

  try {
    await $fetch('/api/generate/rate', {
      method: 'POST',
      body: {
        itemId: entry.itemId,
        score: direction === 'up' ? 9 : 2,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
  } catch {
    // Silent fail — local state is enough
  }
}

// ── Stats ────────────────────────────────────────────────────────────────
const completedCount = computed(() => testEntries.value.filter(e => e.status === 'complete').length)
const failedCount = computed(() => testEntries.value.filter(e => e.status === 'failed').length)
const stillRunning = computed(() => testEntries.value.filter(e => e.status === 'processing' || e.status === 'queued' || e.status === 'pending').length)

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-4 pt-3">
    <!-- Header -->
    <div class="bg-gradient-to-r from-cyan-50 to-violet-50 border border-cyan-200 rounded-xl px-4 py-3">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center text-white text-lg">🧪</div>
        <div>
          <h3 class="text-sm font-bold text-slate-800">LTX2 I2V Tester</h3>
          <p class="text-[10px] text-slate-500">Pick an image → test all workflow presets → compare side-by-side → vote for the best</p>
        </div>
      </div>
    </div>

    <!-- Source Image -->
    <ImagePicker label="Test Image" @select="onImageSelect" @clear="onImageClear" />

    <!-- Settings -->
    <UCard variant="outline">
      <div class="space-y-3">
        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <!-- Duration -->
          <UFormField label="Duration" size="sm">
            <div class="flex gap-1">
              <UButton v-for="d in durationPresets" :key="d.value" size="xs"
                :variant="numFrames === d.value ? 'soft' : 'ghost'"
                :color="numFrames === d.value ? 'primary' : 'neutral'"
                @click="numFrames = d.value"
              >{{ d.label }} <span class="text-[9px] opacity-60 ml-0.5">{{ d.desc }}</span></UButton>
            </div>
          </UFormField>

          <!-- Resolution -->
          <UFormField label="Resolution" size="sm">
            <div class="flex gap-1">
              <UButton v-for="r in resPresets" :key="r.label" size="xs"
                :variant="width === r.w && height === r.h ? 'soft' : 'ghost'"
                :color="width === r.w && height === r.h ? 'primary' : 'neutral'"
                @click="width = r.w; height = r.h"
              >{{ r.label }}</UButton>
            </div>
          </UFormField>

          <!-- Seed -->
          <UFormField label="Seed (fixed for fair compare)" size="sm">
            <div class="flex items-center gap-2">
              <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
              <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = Math.floor(Math.random() * 999999)" />
            </div>
          </UFormField>

          <!-- Steps -->
          <UFormField label="Steps" size="sm">
            <UInput v-model.number="steps" type="number" size="sm" class="w-20" />
          </UFormField>
        </div>

        <!-- Prompt (optional) -->
        <UFormField label="Prompt (optional — auto-generated if blank)" size="sm">
          <UTextarea v-model="prompt" placeholder="Leave blank to auto-caption the image..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

        <!-- Audio -->
        <UFormField label="Audio Prompt (optional)" size="sm">
          <UTextarea v-model="audioPrompt" placeholder="Soundscape description..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

        <!-- Advanced Settings Toggle -->
        <button
          class="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors mt-1"
          @click="showAdvanced = !showAdvanced"
        >
          <UIcon :name="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="w-3.5 h-3.5" />
          Advanced Settings
        </button>

        <!-- Advanced Settings Panel -->
        <div v-if="showAdvanced" class="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/50">
          <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
            <!-- FPS -->
            <UFormField label="FPS" size="sm" hint="Model native: 25">
              <div class="flex items-center gap-2">
                <input type="range" v-model.number="fps" min="12" max="50" step="1" class="w-24 accent-blue-500" />
                <span class="text-xs text-slate-600 font-mono w-6 text-right">{{ fps }}</span>
              </div>
            </UFormField>

            <!-- LoRA Strength -->
            <UFormField label="LoRA Strength" size="sm" hint="0.80 recommended">
              <div class="flex items-center gap-2">
                <input type="range" v-model.number="loraStrength" min="0" max="1" step="0.05" class="w-24 accent-blue-500" />
                <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ loraStrength.toFixed(2) }}</span>
              </div>
            </UFormField>

            <!-- Image Strength -->
            <UFormField label="Image Strength" size="sm" hint="1.0 = exact match">
              <div class="flex items-center gap-2">
                <input type="range" v-model.number="imageStrength" min="0" max="1" step="0.05" class="w-24 accent-blue-500" />
                <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ imageStrength.toFixed(2) }}</span>
              </div>
            </UFormField>

            <!-- CFG -->
            <UFormField label="CFG Scale" size="sm" hint="1.0 default">
              <div class="flex items-center gap-2">
                <input type="range" v-model.number="cfg" min="0.5" max="3" step="0.1" class="w-24 accent-blue-500" />
                <span class="text-xs text-slate-600 font-mono w-6 text-right">{{ cfg.toFixed(1) }}</span>
              </div>
            </UFormField>

            <!-- Camera LoRA -->
            <UFormField label="Camera Motion" size="sm">
              <USelect v-model="cameraLora" :items="cameraLoraOptions" value-key="value" size="sm" class="w-32" />
            </UFormField>
          </div>

          <!-- Scheduler -->
          <div class="border-t border-slate-200 pt-3">
            <p class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Scheduler (noise curve)</p>
            <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
              <UFormField label="Max Shift" size="sm">
                <div class="flex items-center gap-2">
                  <input type="range" v-model.number="maxShift" min="1.0" max="3.0" step="0.05" class="w-24 accent-violet-500" />
                  <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ maxShift.toFixed(2) }}</span>
                </div>
              </UFormField>
              <UFormField label="Base Shift" size="sm">
                <div class="flex items-center gap-2">
                  <input type="range" v-model.number="baseShift" min="0.5" max="2.0" step="0.05" class="w-24 accent-violet-500" />
                  <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ baseShift.toFixed(2) }}</span>
                </div>
              </UFormField>
              <UFormField label="Terminal" size="sm">
                <div class="flex items-center gap-2">
                  <input type="range" v-model.number="terminal" min="0.01" max="0.3" step="0.01" class="w-24 accent-violet-500" />
                  <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ terminal.toFixed(2) }}</span>
                </div>
              </UFormField>
            </div>
          </div>

          <!-- Negative Prompt -->
          <UFormField label="Negative Prompt" size="sm">
            <UTextarea v-model="negativePrompt" :rows="1" autoresize class="w-full" size="sm" />
          </UFormField>
        </div>
      </div>
    </UCard>

    <!-- Preset Selection -->
    <UCard variant="outline">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">Presets to Test</h3>
          <UButton size="xs" variant="ghost" color="neutral"
            @click="toggleAll"
          >{{ enabledPresets.size === I2V_PRESETS.length ? 'Deselect All' : 'Select All' }}</UButton>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          <button
            v-for="p in I2V_PRESETS" :key="p.key"
            class="text-left px-2 py-1.5 rounded-lg border text-xs transition-all"
            :class="enabledPresets.has(p.key)
              ? 'border-cyan-400 bg-cyan-50 text-cyan-700 ring-1 ring-cyan-300'
              : 'border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 opacity-60'"
            @click="togglePreset(p.key)"
          >
            <span class="font-medium block truncate">{{ p.label }}</span>
            <span class="text-[9px] opacity-60 block truncate">{{ p.desc }}</span>
          </button>
        </div>
        <p class="text-[10px] text-slate-400 text-center">{{ enabledPresets.size }} / {{ I2V_PRESETS.length }} presets selected · same seed ensures fair comparison</p>
      </div>
    </UCard>

    <!-- Results Grid (visible when there are entries) -->
    <template v-if="testEntries.length > 0">
      <!-- Progress bar -->
      <div class="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 flex items-center justify-between text-xs">
        <div class="flex items-center gap-3">
          <span v-if="stillRunning > 0" class="text-cyan-600 font-medium flex items-center gap-1">
            <UIcon name="i-lucide-loader" class="w-3 h-3 animate-spin" />
            {{ stillRunning }} running
          </span>
          <span class="text-emerald-600">{{ completedCount }} complete</span>
          <span v-if="failedCount > 0" class="text-red-500">{{ failedCount }} failed</span>
        </div>
        <span class="text-slate-400 font-mono">batch {{ testBatchId }}</span>
      </div>

      <!-- Comparison Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <div
          v-for="entry in testEntries" :key="entry.presetKey"
          class="relative rounded-xl border overflow-hidden transition-all"
          :class="entry.status === 'complete' ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'"
        >
          <!-- Media / Spinner -->
          <div class="aspect-video bg-slate-100 relative">
            <!-- Complete: show video -->
            <video
              v-if="entry.status === 'complete' && entry.url"
              :src="entry.url"
              controls
              muted
              preload="metadata"
              class="w-full h-full object-cover"
            />

            <!-- Processing: spinner -->
            <div v-else-if="entry.status !== 'failed'" class="w-full h-full flex flex-col items-center justify-center">
              <UIcon name="i-lucide-loader" class="w-6 h-6 text-cyan-500 animate-spin mb-1" />
              <span class="text-[10px] text-slate-400">{{ entry.status }}</span>
            </div>

            <!-- Failed -->
            <div v-else class="w-full h-full flex flex-col items-center justify-center bg-red-50">
              <UIcon name="i-lucide-x-circle" class="w-5 h-5 text-red-400 mb-1" />
              <span class="text-[10px] text-red-500 px-2 text-center">{{ entry.error }}</span>
            </div>
          </div>

          <!-- Info & Actions -->
          <div class="p-2">
            <p class="text-xs font-medium text-slate-700 truncate">{{ entry.presetLabel }}</p>
            <p class="text-[9px] text-slate-400 truncate mb-1.5">{{ entry.presetDesc }}</p>

            <div class="flex items-center justify-between">
              <!-- Vote buttons -->
              <div v-if="entry.status === 'complete'" class="flex gap-1">
                <button
                  class="w-6 h-6 rounded flex items-center justify-center text-xs transition-all"
                  :class="votes[entry.presetKey] === 'up' ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300' : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50'"
                  @click="vote(entry.presetKey, 'up')"
                  title="Best result"
                >👍</button>
                <button
                  class="w-6 h-6 rounded flex items-center justify-center text-xs transition-all"
                  :class="votes[entry.presetKey] === 'down' ? 'bg-red-100 text-red-600 ring-1 ring-red-300' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'"
                  @click="vote(entry.presetKey, 'down')"
                  title="Poor result"
                >👎</button>
              </div>

              <!-- Job link -->
              <NuxtLink v-if="entry.itemId" :to="`/job/${entry.itemId}`" class="text-[10px] text-violet-500 hover:text-violet-700 flex items-center gap-0.5">
                Details <UIcon name="i-lucide-external-link" class="w-2.5 h-2.5" />
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
