<script setup lang="ts">
import { downloadMedia, formatDate } from '~/composables/useGallery'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const sweepId = computed(() => route.params.id as string)

// ─── Fetch sweep data ───────────────────────────────────────────────────
interface SweepData {
  sweepId: string
  prompt: string
  totalVariants: number
  generations: {
    id: string
    prompt: string
    sweepLabel: string
    settings: Record<string, unknown>
    items: { id: string; type: string; status: string; url: string | null; error: string | null }[]
    createdAt: string
  }[]
}

const { data: sweep, pending, error, refresh } = useAsyncData<SweepData>(
  `sweep-${sweepId.value}`,
  () => $fetch<SweepData>(`/api/sweep/${sweepId.value}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }),
  { server: false }
)

// ─── SEO Metadata ───────────────────────────────────────────
const seoTitle = computed(() => {
  if (sweep.value?.prompt) return `Sweep: ${sweep.value.prompt.slice(0, 50)}...`
  return 'View Sweep'
})

const seoDesc = computed(() => {
  if (sweep.value) return `Result for sweep with ${sweep.value.generations?.length || 0} variants.`
  return 'View AI media generation sweep results.'
})

useSeo({
  title: seoTitle.value,
  description: seoDesc.value
})
useWebPageSchema()

// ─── Transform to flat entries ──────────────────────────────────────────
interface SweepVariant {
  steps: number
  cfg: number | undefined
  loraStrength: number
  sampler: string | undefined
  scheduler: string | undefined
  width: number
  height: number
  seed: number
}

interface SweepEntry {
  id: string
  variant: SweepVariant
  label: string
  itemId: string | null
  status: 'pending' | 'complete' | 'failed'
  url: string | null
  settings: Record<string, unknown>
  createdAt: string
}

const entries = computed<SweepEntry[]>(() => {
  if (!sweep.value) return []
  return sweep.value.generations.map(gen => {
    const s = gen.settings || {}
    const item = gen.items.find(i => i.type === 'image') || gen.items[0]
    return {
      id: gen.id,
      variant: {
        steps: (s.steps as number) ?? 0,
        cfg: s.cfg as number | undefined,
        loraStrength: (s.loraStrength as number) ?? 1.0,
        sampler: s.sampler as string | undefined,
        scheduler: s.scheduler as string | undefined,
        width: (s.width as number) ?? 0,
        height: (s.height as number) ?? 0,
        seed: (s.seed as number) ?? 0,
      },
      label: (gen.sweepLabel || s.sweepLabel || `Variant`) as string,
      itemId: item?.id ?? null,
      status: (item?.status === 'complete' ? 'complete' : item?.status === 'failed' ? 'failed' : 'pending') as 'pending' | 'complete' | 'failed',
      url: item?.url ?? null,
      settings: s,
      createdAt: gen.createdAt,
    }
  })
})

// ─── Stats ──────────────────────────────────────────────────────────────
const completeCount = computed(() => entries.value.filter(e => e.status === 'complete').length)
const pendingCount = computed(() => entries.value.filter(e => e.status === 'pending').length)
const failedCount = computed(() => entries.value.filter(e => e.status === 'failed').length)
const hasActive = computed(() => pendingCount.value > 0)

// ─── Auto-refresh while pending ─────────────────────────────────────────
let refreshTimer: ReturnType<typeof setInterval> | null = null

watch(hasActive, (active) => {
  if (active && !refreshTimer) {
    refreshTimer = setInterval(() => refresh(), 4000)
  } else if (!active && refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

// ─── View mode ──────────────────────────────────────────────────────────
type ViewMode = 'grid' | 'compare' | 'grid2d'
const viewMode = ref<ViewMode>('grid')

// ─── Filter ─────────────────────────────────────────────────────────────
type StatusFilter = 'all' | 'complete' | 'pending' | 'failed'
const statusFilter = ref<StatusFilter>('all')

const filteredEntries = computed(() => {
  if (statusFilter.value === 'all') return entries.value
  return entries.value.filter(e => e.status === statusFilter.value)
})

// ─── Grid size ──────────────────────────────────────────────────────────
const gridSize = ref<'sm' | 'md' | 'lg'>('md')

const gridCols = computed(() => {
  const n = filteredEntries.value.length
  if (gridSize.value === 'lg') {
    if (n <= 2) return 'grid-cols-1 sm:grid-cols-2'
    return 'grid-cols-2 lg:grid-cols-3'
  }
  if (gridSize.value === 'sm') {
    if (n <= 4) return 'grid-cols-2 sm:grid-cols-4'
    return 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6'
  }
  // md
  if (n <= 2) return 'grid-cols-2'
  if (n <= 4) return 'grid-cols-2 lg:grid-cols-4'
  if (n <= 6) return 'grid-cols-3 lg:grid-cols-6'
  if (n <= 9) return 'grid-cols-3'
  return 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
})

// ─── Axis extraction ────────────────────────────────────────────────────
type AxisValue = number | string

interface AxisDef {
  key: string
  label: string
  values: AxisValue[]
  format: (v: AxisValue) => string
}

const axes = computed<AxisDef[]>(() => {
  const stepsSet = new Set<number>()
  const cfgSet = new Set<number>()
  const loraSet = new Set<number>()
  const samplerSet = new Set<string>()
  const schedulerSet = new Set<string>()
  const sizeSet = new Set<number>()
  const seedSet = new Set<number>()

  for (const e of entries.value) {
    stepsSet.add(e.variant.steps)
    if (e.variant.cfg != null) cfgSet.add(e.variant.cfg)
    loraSet.add(e.variant.loraStrength)
    if (e.variant.sampler) samplerSet.add(e.variant.sampler)
    if (e.variant.scheduler) schedulerSet.add(e.variant.scheduler)
    sizeSet.add(e.variant.width * 10000 + e.variant.height)
    seedSet.add(e.variant.seed)
  }

  const result: AxisDef[] = []
  if (stepsSet.size > 1) result.push({ key: 'steps', label: 'Steps', values: [...stepsSet].sort((a, b) => a - b), format: v => `${v} steps` })
  if (cfgSet.size > 1) result.push({ key: 'cfg', label: 'CFG', values: [...cfgSet].sort((a, b) => (a as number) - (b as number)), format: v => `CFG ${v}` })
  if (loraSet.size > 1) result.push({ key: 'lora', label: 'LoRA', values: [...loraSet].sort((a, b) => a - b), format: v => `LoRA ${(v as number).toFixed(2)}` })
  if (samplerSet.size > 1) result.push({ key: 'sampler', label: 'Sampler', values: [...samplerSet].sort(), format: v => String(v) })
  if (schedulerSet.size > 1) result.push({ key: 'scheduler', label: 'Scheduler', values: [...schedulerSet].sort(), format: v => String(v) })
  if (sizeSet.size > 1) result.push({ key: 'size', label: 'Resolution', values: [...sizeSet].sort((a, b) => a - b), format: v => { const n = v as number; return `${Math.floor(n / 10000)}×${n % 10000}` } })
  if (seedSet.size > 1) result.push({ key: 'seed', label: 'Seed', values: [...seedSet].sort((a, b) => a - b), format: v => `#${String(v).slice(0, 6)}` })
  return result
})

function handleDownloadMedia(url: string | null) {
  if (url) downloadMedia(url, 'image')
}

function handleOpenCompareAt(entry: SweepEntry) {
  openCompareAt(entry)
}

const canShow2D = computed(() => axes.value.length === 2)

// ─── Compare mode sliders ───────────────────────────────────────────────
const axisIndices = ref<Record<string, number>>({})

watch(axes, (a) => {
  const ni: Record<string, number> = {}
  for (const axis of a) ni[axis.key] = axisIndices.value[axis.key] ?? 0
  axisIndices.value = ni
}, { immediate: true })

const selectedValues = computed(() => {
  const result: Record<string, AxisValue> = {}
  for (const axis of axes.value) {
    result[axis.key] = axis.values[axisIndices.value[axis.key] ?? 0] ?? axis.values[0]!
  }
  return result
})

function matchAxis(e: SweepEntry, key: string, val: AxisValue): boolean {
  switch (key) {
    case 'steps': return e.variant.steps === val
    case 'cfg': return e.variant.cfg === val
    case 'lora': return e.variant.loraStrength === val
    case 'sampler': return e.variant.sampler === val
    case 'scheduler': return e.variant.scheduler === val
    case 'size': return (e.variant.width * 10000 + e.variant.height) === val
    case 'seed': return e.variant.seed === val
    default: return false
  }
}

const matchedEntry = computed(() => {
  const sv = selectedValues.value
  return entries.value.find(e => axes.value.every(a => matchAxis(e, a.key, sv[a.key]!))) ?? null
})

const currentLabel = computed(() => axes.value.map(a => a.format(selectedValues.value[a.key]!)).join(' · '))

// ─── 2D Grid ────────────────────────────────────────────────────────────
const grid2D = computed(() => {
  if (!canShow2D.value) return null
  const [rowAxis, colAxis] = axes.value
  if (!rowAxis || !colAxis) return null
  const rows = rowAxis.values
  const cols = colAxis.values
  const cells: (SweepEntry | null)[][] = []
  for (const rv of rows) {
    const row: (SweepEntry | null)[] = []
    for (const cv of cols) {
      const entry = entries.value.find(e => matchAxis(e, rowAxis.key, rv) && matchAxis(e, colAxis.key, cv))
      row.push(entry ?? null)
    }
    cells.push(row)
  }
  return { rowAxis, colAxis, rows, cols, cells }
})

// ─── Lightbox ───────────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const showInfo = ref(false)

const completedEntries = computed(() => filteredEntries.value.filter(e => e.status === 'complete' && e.url))
const lightboxItems = computed(() => completedEntries.value.map(e => ({
  id: e.itemId || e.id,
  url: e.url!,
  type: 'image' as const,
  prompt: sweep.value?.prompt,
})))

const currentLightboxEntry = computed(() => completedEntries.value[lightboxIndex.value] ?? null)

function openLightbox(entry: SweepEntry) {
  if (entry.status !== 'complete' || !entry.url) return
  const idx = completedEntries.value.findIndex(e => e.id === entry.id)
  if (idx >= 0) {
    lightboxIndex.value = idx
    lightboxOpen.value = true
    showInfo.value = false
  }
}

function openCompareAt(entry: SweepEntry) {
  if (entry.status !== 'complete') return
  for (const axis of axes.value) {
    const val = (() => {
      switch (axis.key) {
        case 'steps': return entry.variant.steps
        case 'cfg': return entry.variant.cfg
        case 'lora': return entry.variant.loraStrength
        case 'sampler': return entry.variant.sampler
        case 'scheduler': return entry.variant.scheduler
        case 'size': return entry.variant.width * 10000 + entry.variant.height
        case 'seed': return entry.variant.seed
        default: return
      }
    })()
    if (val !== undefined && val !== null) {
      const idx = axis.values.indexOf(val as AxisValue)
      if (idx >= 0) axisIndices.value = { ...axisIndices.value, [axis.key]: idx }
    }
  }
  viewMode.value = 'compare'
}

// ─── Keyboard nav ───────────────────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if (lightboxOpen.value) return // lightbox handles its own keys
  if (viewMode.value !== 'compare' || axes.value.length === 0) return

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    const axis = axes.value[0]!
    const idx = axisIndices.value[axis.key] ?? 0
    if (idx < axis.values.length - 1) axisIndices.value = { ...axisIndices.value, [axis.key]: idx + 1 }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    const axis = axes.value[0]!
    const idx = axisIndices.value[axis.key] ?? 0
    if (idx > 0) axisIndices.value = { ...axisIndices.value, [axis.key]: idx - 1 }
  } else if (e.key === 'Escape') {
    viewMode.value = 'grid'
    e.preventDefault()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

// ─── Actions ────────────────────────────────────────────────────────────
const toast = useToast()

function copyPrompt(text: string) {
  navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied', description: 'Prompt copied to clipboard', color: 'success' })
}

function copySweepLink() {
  navigator.clipboard.writeText(window.location.href)
  toast.add({ title: 'Copied', description: 'Sweep link copied', color: 'success' })
}

async function downloadAll() {
  for (const e of completedEntries.value) {
    if (e.url) downloadMedia(e.url, 'image')
    await new Promise(r => setTimeout(r, 300))
  }
}

function formatSettingKey(key: string): string {
  return key.replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase())
}

function getAxisValueLabel(axis: AxisDef): string {
  const idx = axisIndices.value[axis.key] ?? 0
  const val = axis.values[idx]
  if (val === undefined) return ''
  return axis.format(val)
}

function shouldShowSetting(key: string, val: unknown): boolean {
  if (key === 'prompt' || key === 'sweepId' || key === 'sweepLabel') return false
  if (val === undefined || val === null || val === '') return false
  return true
}

function formatSettingValue(val: unknown): string {
  if (typeof val === 'object' && val !== null) return JSON.stringify(val)
  return String(val)
}

function onCopyPrompt() {
  if (sweep.value?.prompt) copyPrompt(sweep.value.prompt)
}

function getGrid2DLabel(cells: { rowAxis: AxisDef; colAxis: AxisDef }): string {
  return `${cells.rowAxis.label} \\ ${cells.colAxis.label}`
}

function _shouldShowAttr(key: string | number, val: unknown) {
  return shouldShowSetting(String(key), val)
}

function isAttrVisible(key: string | number) {
  return String(key) !== 'prompt'
}

function getAttrKey(key: string | number) {
  return formatSettingKey(String(key))
}

function getCreatedAtText() {
  if (!currentLightboxEntry.value?.createdAt) return ''
  return formatDate(currentLightboxEntry.value.createdAt)
}
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-slate-50">
    <!-- Header -->
    <div class="sticky top-16 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1">
              <NuxtLink to="/gallery" class="text-xs text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
                <UIcon name="i-lucide-arrow-left" class="w-3.5 h-3.5" />
                Gallery
              </NuxtLink>
              <span class="text-slate-300">·</span>
              <span class="text-xs text-amber-600 font-medium flex items-center gap-1">
                <UIcon name="i-lucide-test-tubes" class="w-3.5 h-3.5" />
                Parameter Sweep
              </span>
            </div>
            <h1 v-if="sweep" class="font-display text-xl font-bold text-slate-800 truncate">
              <span class="text-transparent bg-clip-text bg-linear-to-r from-amber-500 to-orange-500">{{ sweep.prompt }}</span>
            </h1>
            <h1 v-else class="font-display text-xl font-bold text-slate-400">Loading…</h1>

            <!-- Stats -->
            <div v-if="sweep" class="flex items-center gap-3 mt-1.5 text-xs">
              <span class="text-slate-500 font-medium">{{ sweep.totalVariants }} variants</span>
              <span class="text-emerald-600 font-medium" v-if="completeCount > 0">{{ completeCount }} complete</span>
              <span class="text-amber-600 font-medium" v-if="pendingCount > 0">
                <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse mr-1" />{{ pendingCount }} pending
              </span>
              <span class="text-red-500 font-medium" v-if="failedCount > 0">{{ failedCount }} failed</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1.5 shrink-0">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-link" @click="copySweepLink" title="Copy link" />
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-download" @click="downloadAll" title="Download all" v-if="completeCount > 1" />
            <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-refresh-cw" :class="{ 'animate-spin': pending }" @click="refresh()" />
          </div>
        </div>

        <!-- View Controls -->
        <div v-if="entries.length > 0" class="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100">
          <!-- View mode -->
          <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <UButton size="xs" :variant="viewMode === 'grid' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-grid-3x3" @click="viewMode = 'grid'">Grid</UButton>
            <UButton size="xs" :variant="viewMode === 'compare' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-sliders-horizontal" @click="viewMode = 'compare'" :disabled="completeCount < 2">Compare</UButton>
            <UButton v-if="canShow2D" size="xs" :variant="viewMode === 'grid2d' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-table" @click="viewMode = 'grid2d'">2D Grid</UButton>
          </div>

          <div class="flex-1" />

          <!-- Status filter -->
          <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <UButton size="xs" :variant="statusFilter === 'all' ? 'solid' : 'ghost'" color="neutral" @click="statusFilter = 'all'">All</UButton>
            <UButton size="xs" :variant="statusFilter === 'complete' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-check" @click="statusFilter = 'complete'" />
            <UButton size="xs" :variant="statusFilter === 'pending' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-clock" @click="statusFilter = 'pending'" />
            <UButton size="xs" :variant="statusFilter === 'failed' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-x" @click="statusFilter = 'failed'" />
          </div>

          <!-- Grid size -->
          <div v-if="viewMode === 'grid'" class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <UButton size="xs" :variant="gridSize === 'sm' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-layout-grid" @click="gridSize = 'sm'" title="Small" />
            <UButton size="xs" :variant="gridSize === 'md' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-grid-3x3" @click="gridSize = 'md'" title="Medium" />
            <UButton size="xs" :variant="gridSize === 'lg' ? 'solid' : 'ghost'" color="neutral" icon="i-lucide-grid-2x2" @click="gridSize = 'lg'" title="Large" />
          </div>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <!-- Loading -->
      <div v-if="pending && !entries.length" class="flex items-center justify-center min-h-[400px]">
        <div class="text-center">
          <div class="w-10 h-10 border-3 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-4" />
          <p class="text-sm text-slate-400">Loading sweep…</p>
        </div>
      </div>

      <!-- Error -->
      <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="(error as { message?: string })?.message || 'Failed to load sweep'" class="mb-6">
        <template #actions>
          <UButton variant="outline" size="xs" @click="refresh()">Retry</UButton>
        </template>
      </UAlert>

      <!-- Empty -->
      <div v-else-if="!entries.length" class="flex items-center justify-center min-h-[400px]">
        <div class="text-center">
          <div class="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-4">
            <UIcon name="i-lucide-test-tubes" class="w-8 h-8 text-amber-300" />
          </div>
          <p class="text-slate-500 text-sm mb-1">No sweep data found</p>
          <UButton to="/create" size="sm" variant="outline">Create a sweep</UButton>
        </div>
      </div>

      <!-- ═══ COMPARE MODE ═══ -->
      <Transition name="sweep-fade" mode="out-in">
        <div v-if="viewMode === 'compare'" class="rounded-xl border-2 border-amber-200 bg-amber-50/30 overflow-hidden">
          <!-- Slider Controls -->
          <div class="p-4 bg-white border-b border-amber-100 space-y-4">
            <div v-for="axis in axes" :key="axis.key" class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{{ axis.label }}</label>
                <span class="text-xs font-mono text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  {{ getAxisValueLabel(axis) }}
                </span>
              </div>
              <USlider
                :model-value="axisIndices[axis.key] ?? 0"
                @update:model-value="axisIndices = { ...axisIndices, [axis.key]: $event as number }"
                :min="0" :max="axis.values.length - 1" :step="1"
                class="w-full" size="md"
              />
              <div class="flex justify-between px-1">
                <button
                  v-for="(val, vi) in axis.values" :key="vi"
                  class="text-[9px] font-mono transition-colors cursor-pointer"
                  :class="(axisIndices[axis.key] ?? 0) === vi ? 'text-amber-700 font-bold' : 'text-slate-400 hover:text-slate-600'"
                  @click="axisIndices = { ...axisIndices, [axis.key]: vi }"
                >{{ axis.format(val) }}</button>
              </div>
            </div>
          </div>

          <!-- Label -->
          <div class="px-4 py-2 bg-amber-100/40 flex items-center justify-between">
            <span class="text-xs font-semibold text-amber-700">{{ currentLabel }}</span>
            <div class="flex gap-1">
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-maximize-2" @click="matchedEntry && openLightbox(matchedEntry)" :disabled="!matchedEntry?.url">Fullscreen</UButton>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-grid-3x3" @click="viewMode = 'grid'">Grid</UButton>
            </div>
          </div>

          <!-- Image -->
          <div class="bg-white flex justify-center items-center min-h-[400px] p-6">
            <template v-if="matchedEntry?.status === 'complete' && matchedEntry.url">
              <img :src="matchedEntry.url" :alt="currentLabel" class="max-h-[600px] max-w-full rounded-lg shadow-lg transition-all duration-200 cursor-pointer hover:shadow-xl" :key="matchedEntry.itemId ?? 'pending'" @click="openLightbox(matchedEntry)" />
            </template>
            <template v-else-if="matchedEntry?.status === 'pending'">
              <div class="text-center">
                <div class="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-2" />
                <p class="text-xs text-slate-400">Generating {{ currentLabel }}…</p>
              </div>
            </template>
            <template v-else-if="matchedEntry?.status === 'failed'">
              <div class="text-center">
                <UIcon name="i-lucide-x-circle" class="w-8 h-8 text-red-300 mx-auto mb-2" />
                <p class="text-xs text-red-400">Failed</p>
              </div>
            </template>
            <template v-else>
              <p class="text-xs text-slate-400">No matching result</p>
            </template>
          </div>

          <div class="px-4 py-2 bg-slate-50 border-t border-slate-100">
            <p class="text-[10px] text-slate-400 text-center">← → Arrow keys to scrub · Esc to exit · Click image for fullscreen</p>
          </div>
        </div>
      </Transition>

      <!-- ═══ 2D GRID MODE ═══ -->
      <div v-if="viewMode === 'grid2d' && grid2D" class="overflow-x-auto rounded-xl border border-amber-200">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="p-2 text-[10px] font-semibold text-amber-700 bg-amber-50 border-b border-r border-amber-200 sticky left-0 z-10">
                {{ getGrid2DLabel(grid2D) }}
              </th>
              <th v-for="(cv, ci) in grid2D.cols" :key="ci" class="p-2 text-[10px] font-mono text-amber-600 bg-amber-50/60 border-b border-amber-200 min-w-[120px]">
                {{ grid2D.colAxis.format(cv) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in grid2D.cells" :key="ri">
              <td class="p-2 text-[10px] font-mono text-amber-600 bg-amber-50/40 border-b border-r border-amber-200 sticky left-0 z-10 whitespace-nowrap">
                {{ grid2D.rowAxis.format(grid2D.rows[ri]!) }}
              </td>
              <td v-for="(cell, ci) in row" :key="ci" class="p-1.5 border-b border-amber-100 text-center">
                <div v-if="cell?.status === 'complete' && cell.url" class="relative group cursor-pointer" @click="openLightbox(cell)">
                  <img :src="cell.url" :alt="cell.label" class="w-full aspect-square object-cover rounded-lg transition-transform group-hover:scale-[1.02] shadow-sm" loading="lazy" />
                  <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg flex items-center justify-center">
                    <UIcon name="i-lucide-maximize-2" class="w-5 h-5 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow" />
                  </div>
                  <!-- Download on hover -->
                  <button class="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/40 hover:bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" @click.stop="handleDownloadMedia(cell.url)">
                    <UIcon name="i-lucide-download" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <div v-else-if="cell?.status === 'pending'" class="aspect-square bg-slate-50 rounded-lg flex items-center justify-center">
                  <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                </div>
                <div v-else-if="cell?.status === 'failed'" class="aspect-square bg-red-50/50 rounded-lg flex items-center justify-center">
                  <UIcon name="i-lucide-x-circle" class="w-5 h-5 text-red-300" />
                </div>
                <div v-else class="aspect-square bg-slate-50/50 rounded-lg" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ═══ GRID MODE ═══ -->
      <div v-if="viewMode === 'grid'" :class="['grid gap-3', gridCols]">
        <div
          v-for="entry in filteredEntries" :key="entry.id"
          class="group relative rounded-xl overflow-hidden border transition-all"
          :class="entry.status === 'complete'
            ? 'border-slate-200 hover:border-amber-300 hover:shadow-lg cursor-pointer'
            : 'border-slate-100'"
        >
          <!-- Complete image -->
          <div v-if="entry.status === 'complete' && entry.url" class="relative" @click="openLightbox(entry)">
            <img :src="entry.url" :alt="entry.label" class="w-full h-auto block" loading="lazy" />

            <!-- Hover overlay -->
            <div class="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

            <!-- Actions on hover -->
            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="w-7 h-7 rounded-lg bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm transition-colors cursor-pointer" @click.stop="handleDownloadMedia(entry.url)" title="Download">
                <UIcon name="i-lucide-download" class="w-3.5 h-3.5" />
              </button>
              <button class="w-7 h-7 rounded-lg bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm transition-colors cursor-pointer" @click.stop="handleOpenCompareAt(entry)" title="Compare mode">
                <UIcon name="i-lucide-sliders-horizontal" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <!-- Pending -->
          <div v-else-if="entry.status === 'pending'" class="aspect-square bg-slate-50 flex items-center justify-center min-h-40">
            <div class="text-center">
              <div class="w-6 h-6 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-1.5" />
              <span class="text-[10px] text-slate-400">Generating…</span>
            </div>
          </div>

          <!-- Failed -->
          <div v-else class="aspect-square bg-red-50/50 flex items-center justify-center min-h-40">
            <div class="text-center">
              <UIcon name="i-lucide-x-circle" class="w-6 h-6 text-red-300 mx-auto mb-1" />
              <span class="text-[10px] text-red-400">Failed</span>
            </div>
          </div>

          <!-- Label overlay -->
          <div class="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/70 via-black/40 to-transparent px-2.5 py-2 pointer-events-none">
            <span class="text-[10px] font-medium text-white drop-shadow-sm leading-tight block">{{ entry.label }}</span>
          </div>
        </div>
      </div>

      <!-- Grid hint -->
      <p v-if="viewMode === 'grid' && completeCount >= 2" class="text-[10px] text-slate-400 mt-3 text-center">
        Click any image for fullscreen · Hover for download & compare
      </p>
    </div>

    <!-- ═══ Lightbox ═══ -->
    <AppLightbox v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems">
      <template #toolbar="{ item }">
        <UButton variant="ghost" size="sm" icon="i-lucide-clipboard-copy" class="text-white/60 hover:text-white" @click="onCopyPrompt">Copy Prompt</UButton>
        <UButton variant="ghost" size="sm" icon="i-lucide-info" class="text-white/60 hover:text-white" @click="showInfo = !showInfo">Info</UButton>
      </template>

      <template #panel>
        <Transition name="sweep-fade">
          <div v-if="showInfo && currentLightboxEntry" class="absolute bottom-18 left-1/2 -translate-x-1/2 w-[480px] max-w-[90vw] max-h-80 overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md p-5 text-sm text-white/80 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs uppercase tracking-wider text-white/50 font-medium flex items-center gap-1.5">
                <UIcon name="i-lucide-test-tubes" class="w-3.5 h-3.5" />
                Sweep Variant Info
              </span>
              <button class="text-white/40 hover:text-white text-xs cursor-pointer" @click="showInfo = false">✕</button>
            </div>

            <!-- Label -->
            <div class="bg-amber-500/20 rounded-lg px-3 py-1.5">
              <span class="text-xs font-medium text-amber-300">{{ currentLightboxEntry.label }}</span>
            </div>

            <!-- Prompt -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] text-white/40 uppercase tracking-wider">Prompt</span>
                <button class="text-[10px] text-white/40 hover:text-white flex items-center gap-1 cursor-pointer" @click="onCopyPrompt">
                  <UIcon name="i-lucide-clipboard-copy" class="w-3 h-3" /> Copy
                </button>
              </div>
              <p class="text-xs text-white/80 leading-relaxed">{{ sweep?.prompt }}</p>
            </div>

            <!-- Settings grid -->
            <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t border-white/10 pt-3">
              <template v-for="(val, key) in currentLightboxEntry.settings" :key="key">
                <template v-if="isAttrVisible(key)">
                  <span class="text-white/40">{{ getAttrKey(key) }}</span>
                  <span class="truncate font-mono text-[11px]" :title="String(val)">
                    {{ formatSettingValue(val) }}
                  </span>
                </template>
              </template>
              <span class="text-white/40">Created</span>
              <span>{{ getCreatedAtText() }}</span>
            </div>
          </div>
        </Transition>
      </template>
    </AppLightbox>
  </div>
</template>

<style scoped>
.sweep-fade-enter-active, .sweep-fade-leave-active { transition: opacity 0.2s ease; }
.sweep-fade-enter-from, .sweep-fade-leave-to { opacity: 0; }
</style>
