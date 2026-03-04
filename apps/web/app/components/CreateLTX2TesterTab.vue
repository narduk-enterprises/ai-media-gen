<script setup lang="ts">
import { I2V_PRESETS } from '~/composables/useVideoDefaults'

type I2V_PRESET = (typeof I2V_PRESETS)[number]

const props = defineProps<{
  modelValue: {
    prompt: string
    negativePrompt?: string
    image?: string | null
    duration?: number
    steps?: number
    cfg?: number
  }
  votes: Record<string, 'up' | 'down' | undefined>
}>()

const emit = defineEmits<{
  'update:modelValue': [val: typeof props.modelValue]
  'generate': [presets: I2V_PRESET[]]
  'vote': [payload: { presetKey: string, direction: 'up' | 'down' }]
}>()

const enabledPresets = ref(new Set<string>(I2V_PRESETS.map((p: I2V_PRESET) => p.key)))
const testEntries = ref<{
  presetKey: string
  presetLabel: string
  presetDesc: string
  status: 'idle' | 'queued' | 'processing' | 'complete' | 'failed'
  url?: string
  itemId?: string
  error?: string
}[]>([])

const isGenerating = ref(false)

async function generate() {
  if (isGenerating.value) return
  isGenerating.value = true
  
  testEntries.value = I2V_PRESETS
    .filter((p: I2V_PRESET) => enabledPresets.value.has(p.key))
    .map((p: I2V_PRESET) => ({
      presetKey: p.key,
      presetLabel: p.label,
      presetDesc: p.desc,
      status: 'queued'
    }))

  emit('generate', I2V_PRESETS.filter((p: I2V_PRESET) => enabledPresets.value.has(p.key)))
}

function updateEntry(presetKey: string, updates: Partial<(typeof testEntries.value)[0]>) {
  const idx = testEntries.value.findIndex(e => e.presetKey === presetKey)
  if (idx >= 0) {
    testEntries.value[idx] = { ...testEntries.value[idx]!, ...updates }
  }
}

const canGenerate = computed(() => !!props.modelValue.prompt && enabledPresets.value.size > 0 && !isGenerating.value)
const totalCount = computed(() => enabledPresets.value.size)
const completedCount = computed(() => testEntries.value.filter(e => e.status === 'complete').length)
const failedCount = computed(() => testEntries.value.filter(e => e.status === 'failed').length)
const stillRunning = computed(() => testEntries.value.filter(e => e.status === 'processing' || e.status === 'queued').length)

const completedPresetsText = computed(() => `${completedCount.value} complete`)
const failedPresetsText = computed(() => `${failedCount.value} failed`)
const runningPresetsText = computed(() => `${stillRunning.value} running`)

function onVoteUp(presetKey: string) {
  emit('vote', { presetKey, direction: 'up' })
}

function onVoteDown(presetKey: string) {
  emit('vote', { presetKey, direction: 'down' })
}

function getUpVoteClass(presetKey: string) {
  return getItemVoteClass(presetKey, 'up')
}

function getDownVoteClass(presetKey: string) {
  return getItemVoteClass(presetKey, 'down')
}

function getItemVoteClass(presetKey: string, direction: 'up' | 'down') {
  const active = props.votes[presetKey] === direction
  if (direction === 'up') {
    return active ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300' : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50'
  }
  return active ? 'bg-red-100 text-red-600 ring-1 ring-red-300' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
}

const canToggleAll = computed(() => enabledPresets.value.size === I2V_PRESETS.length)

function toggleAll() {
  if (canToggleAll.value) enabledPresets.value.clear()
  else for (const p of I2V_PRESETS) enabledPresets.value.add(p.key)
}

defineExpose({ generate, canGenerate, totalCount, isVideo: true, updateEntry })
</script>

<template>
  <div class="space-y-4 pt-3">
    <!-- Header -->
    <div class="bg-linear-to-r from-cyan-50 to-violet-50 border border-cyan-200 rounded-xl px-4 py-3">
      <div class="flex items-center justify-between mb-2">
        <div>
          <h3 class="text-sm font-bold text-cyan-900 flex items-center gap-2">
            <UIcon name="i-lucide-test-tubes" class="w-4 h-4" />
            LTX-2 Comparison Tester
          </h3>
          <p class="text-[10px] text-cyan-700/70">Compare multiple motion & style presets simultaneously</p>
        </div>
        <UButton
          size="xs"
          variant="soft"
          color="info"
          :icon="canToggleAll ? 'i-lucide-square-dashed' : 'i-lucide-check-square'"
          @click="toggleAll"
        >
          {{ canToggleAll ? 'Deselect All' : 'Select All' }}
        </UButton>
      </div>

      <!-- Preset selector -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        <label
          v-for="preset in I2V_PRESETS"
          :key="preset.key"
          class="relative flex flex-col p-2 rounded-lg border transition-all cursor-pointer group"
          :class="enabledPresets.has(preset.key)
            ? 'bg-white border-cyan-300 ring-1 ring-cyan-100 shadow-sm'
            : 'bg-slate-50/50 border-slate-200 opacity-60 grayscale hover:opacity-100 hover:grayscale-0'"
        >
          <input
            type="checkbox"
            class="absolute top-2 right-2 w-3.5 h-3.5 text-cyan-500 rounded border-slate-300 focus:ring-cyan-400 cursor-pointer"
            :checked="enabledPresets.has(preset.key)"
            @change="enabledPresets.has(preset.key) ? enabledPresets.delete(preset.key) : enabledPresets.add(preset.key)"
          />
          <span class="text-[11px] font-bold text-slate-700">{{ preset.label }}</span>
          <span class="text-[9px] text-slate-500 leading-tight mt-0.5">{{ preset.desc }}</span>
        </label>
      </div>
    </div>

    <!-- Results Grid -->
    <div v-if="testEntries.length > 0" class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Test Results</span>
        <div class="flex gap-3">
          <span v-if="completedCount > 0" class="text-[10px] font-medium text-emerald-600">{{ completedPresetsText }}</span>
          <span v-if="stillRunning > 0" class="text-[10px] font-medium text-cyan-600 animate-pulse">{{ runningPresetsText }}</span>
          <span v-if="failedCount > 0" class="text-[10px] font-medium text-red-500">{{ failedPresetsText }}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="entry in testEntries"
          :key="entry.presetKey"
          class="group rounded-xl border border-slate-200 bg-white overflow-hidden transition-all hover:shadow-md"
        >
          <!-- Preview -->
          <div class="aspect-square bg-slate-100 relative">
            <template v-if="entry.status === 'complete' && entry.url">
              <video
                :src="entry.url + '#t=0.1'"
                class="w-full h-full object-cover"
                muted loop playsinline
                @mouseenter="($event.target as HTMLVideoElement).play()"
                @mouseleave="($event.target as HTMLVideoElement).pause()"
              />
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <UIcon name="i-lucide-play-circle" class="w-10 h-10 text-white/80" />
              </div>
            </template>
            <div v-else-if="entry.status === 'queued' || entry.status === 'processing'" class="absolute inset-0 flex flex-col items-center justify-center p-4">
              <div class="w-8 h-8 border-2 border-cyan-200 border-t-cyan-500 rounded-full animate-spin mb-2" />
              <span class="text-[10px] text-slate-400 font-medium">{{ entry.status === 'processing' ? 'Generating…' : 'Queued' }}</span>
            </div>
            <div v-else-if="entry.status === 'failed'" class="absolute inset-0 flex flex-col items-center justify-center p-4 bg-red-50/50">
              <UIcon name="i-lucide-x-circle" class="w-8 h-8 text-red-300 mb-1" />
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
                  :class="getUpVoteClass(entry.presetKey)"
                  @click="onVoteUp(entry.presetKey)"
                  title="Best result"
                >👍</button>
                <button
                  class="w-6 h-6 rounded flex items-center justify-center text-xs transition-all"
                  :class="getDownVoteClass(entry.presetKey)"
                  @click="onVoteDown(entry.presetKey)"
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
    </div>
  </div>
</template>
