<script setup lang="ts">
/**
 * SweepComparisonGrid — interactive comparison for parameter sweep results.
 *
 * Three modes:
 *   1. Grid — all results at a glance with parameter labels
 *   2. Compare — full-size image with per-axis sliders to scrub between values
 *   3. 2D Grid — when exactly 2 axes, show a row × column matrix
 */

interface SweepVariant {
  steps: number
  cfg?: number
  loraStrength: number
  sampler?: string
  scheduler?: string
  width: number
  height: number
  seed: number
  label: string
}

interface SweepResultEntry {
  variant: SweepVariant
  itemId: string | null
  status: 'pending' | 'complete' | 'failed'
  url: string | null
}

const props = defineProps<{
  entries: SweepResultEntry[]
  generating: boolean
}>()

// ─── Mode ───────────────────────────────────────────────────────────────
const viewMode = ref<'grid' | 'compare' | 'grid2d'>('grid')

const completedCount = computed(() => props.entries.filter(e => e.status === 'complete').length)
const totalCount = computed(() => props.entries.length)

// ─── Grid layout ────────────────────────────────────────────────────────
const gridCols = computed(() => {
  const n = totalCount.value
  if (n <= 2) return 'grid-cols-2'
  if (n <= 4) return 'grid-cols-2 lg:grid-cols-4'
  if (n <= 6) return 'grid-cols-3 lg:grid-cols-6'
  if (n <= 9) return 'grid-cols-3'
  return 'grid-cols-4 lg:grid-cols-5'
})

// ─── Axis extraction ────────────────────────────────────────────────────
// Supports both numeric and string axes
type AxisValue = number | string

interface AxisDef {
  key: string
  label: string
  values: AxisValue[]
  format: (v: AxisValue) => string
  isString: boolean
}

const axes = computed<AxisDef[]>(() => {
  const stepsSet = new Set<number>()
  const cfgSet = new Set<number>()
  const loraSet = new Set<number>()
  const samplerSet = new Set<string>()
  const schedulerSet = new Set<string>()
  const sizeSet = new Set<number>()
  const seedSet = new Set<number>()

  for (const e of props.entries) {
    stepsSet.add(e.variant.steps)
    if (e.variant.cfg != null) cfgSet.add(e.variant.cfg)
    loraSet.add(e.variant.loraStrength)
    if (e.variant.sampler) samplerSet.add(e.variant.sampler)
    if (e.variant.scheduler) schedulerSet.add(e.variant.scheduler)
    sizeSet.add(e.variant.width * 10000 + e.variant.height)
    seedSet.add(e.variant.seed)
  }

  const result: AxisDef[] = []

  if (stepsSet.size > 1) {
    result.push({
      key: 'steps', label: 'Steps', isString: false,
      values: [...stepsSet].sort((a, b) => a - b),
      format: (v) => `${v} steps`,
    })
  }
  if (cfgSet.size > 1) {
    result.push({
      key: 'cfg', label: 'CFG Scale', isString: false,
      values: [...cfgSet].sort((a, b) => (a as number) - (b as number)),
      format: (v) => `CFG ${v}`,
    })
  }
  if (loraSet.size > 1) {
    result.push({
      key: 'lora', label: 'LoRA Strength', isString: false,
      values: [...loraSet].sort((a, b) => a - b),
      format: (v) => `LoRA ${(v as number).toFixed(2)}`,
    })
  }
  if (samplerSet.size > 1) {
    result.push({
      key: 'sampler', label: 'Sampler', isString: true,
      values: [...samplerSet].sort(),
      format: (v) => String(v),
    })
  }
  if (schedulerSet.size > 1) {
    result.push({
      key: 'scheduler', label: 'Scheduler', isString: true,
      values: [...schedulerSet].sort(),
      format: (v) => String(v),
    })
  }
  if (sizeSet.size > 1) {
    const sizes = [...sizeSet].sort((a, b) => a - b)
    result.push({
      key: 'size', label: 'Resolution', isString: false,
      values: sizes,
      format: (v) => {
        const n = v as number
        const w = Math.floor(n / 10000)
        const h = n % 10000
        return `${w}×${h}`
      },
    })
  }
  if (seedSet.size > 1) {
    result.push({
      key: 'seed', label: 'Seed', isString: false,
      values: [...seedSet].sort((a, b) => a - b),
      format: (v) => `#${String(v).slice(0, 6)}`,
    })
  }

  return result
})

// ─── Check for 2D grid possibility ──────────────────────────────────────
const canShow2D = computed(() => axes.value.length === 2)

// ─── 2D Grid data ───────────────────────────────────────────────────────
const grid2D = computed(() => {
  if (!canShow2D.value) return null
  const [rowAxis, colAxis] = axes.value
  if (!rowAxis || !colAxis) return null

  const rows = rowAxis.values
  const cols = colAxis.values

  const cells: (SweepResultEntry | null)[][] = []
  for (const rv of rows) {
    const row: (SweepResultEntry | null)[] = []
    for (const cv of cols) {
      const entry = props.entries.find(e => {
        const rowMatch = matchAxis(e, rowAxis.key, rv)
        const colMatch = matchAxis(e, colAxis.key, cv)
        return rowMatch && colMatch
      })
      row.push(entry ?? null)
    }
    cells.push(row)
  }
  return { rowAxis, colAxis, rows, cols, cells }
})

function matchAxis(e: SweepResultEntry, key: string, val: AxisValue): boolean {
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

// ─── Slider state ───────────────────────────────────────────────────────
const axisIndices = ref<Record<string, number>>({})

watch(axes, (a) => {
  const newIndices: Record<string, number> = {}
  for (const axis of a) {
    newIndices[axis.key] = axisIndices.value[axis.key] ?? 0
  }
  axisIndices.value = newIndices
}, { immediate: true })

const selectedValues = computed(() => {
  const result: Record<string, AxisValue> = {}
  for (const axis of axes.value) {
    result[axis.key] = axis.values[axisIndices.value[axis.key] ?? 0] ?? axis.values[0]!
  }
  return result
})

const matchedEntry = computed(() => {
  const sv = selectedValues.value
  return props.entries.find(e => {
    return axes.value.every(a => matchAxis(e, a.key, sv[a.key]!))
  }) ?? null
})

const currentLabel = computed(() => {
  return axes.value.map(a => {
    const val = selectedValues.value[a.key]!
    return a.format(val)
  }).join(' · ')
})

// ─── Keyboard nav ───────────────────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if (viewMode.value !== 'compare' || axes.value.length === 0) return

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    const axis = axes.value[0]!
    const idx = axisIndices.value[axis.key] ?? 0
    if (idx < axis.values.length - 1) {
      axisIndices.value = { ...axisIndices.value, [axis.key]: idx + 1 }
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    const axis = axes.value[0]!
    const idx = axisIndices.value[axis.key] ?? 0
    if (idx > 0) {
      axisIndices.value = { ...axisIndices.value, [axis.key]: idx - 1 }
    }
  } else if (e.key === 'Escape') {
    viewMode.value = 'grid'
    e.preventDefault()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

function openCompareAt(entry: SweepResultEntry) {
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
        default: return undefined
      }
    })()
    if (val != null) {
      const idx = axis.values.indexOf(val as any)
      if (idx >= 0) axisIndices.value = { ...axisIndices.value, [axis.key]: idx }
    }
  }
  viewMode.value = 'compare'
}
</script>

<template>
  <section class="mt-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-grid-3x3" class="w-4 h-4 text-amber-500" />
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sweep Comparison</h2>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-500">
        <span>{{ completedCount }}/{{ totalCount }} complete</span>
        <div v-if="completedCount >= 2" class="flex gap-1">
          <UButton
            size="xs"
            :variant="viewMode === 'grid' ? 'soft' : 'outline'"
            :color="viewMode === 'grid' ? 'warning' : 'neutral'"
            icon="i-lucide-grid-3x3"
            @click="viewMode = 'grid'"
          >Grid</UButton>
          <UButton
            size="xs"
            :variant="viewMode === 'compare' ? 'soft' : 'outline'"
            :color="viewMode === 'compare' ? 'warning' : 'neutral'"
            icon="i-lucide-sliders-horizontal"
            @click="viewMode = 'compare'"
          >Compare</UButton>
          <UButton
            v-if="canShow2D"
            size="xs"
            :variant="viewMode === 'grid2d' ? 'soft' : 'outline'"
            :color="viewMode === 'grid2d' ? 'warning' : 'neutral'"
            icon="i-lucide-table"
            @click="viewMode = 'grid2d'"
          >2D Grid</UButton>
        </div>
      </div>
    </div>

    <!-- ═══ COMPARE MODE — Sliders ═══ -->
    <Transition name="compare-mode" mode="out-in">
      <div v-if="viewMode === 'compare'" class="rounded-xl border-2 border-amber-200 bg-amber-50/30 overflow-hidden">
        <!-- Slider Controls -->
        <div class="p-4 bg-white border-b border-amber-100 space-y-4">
          <div v-for="axis in axes" :key="axis.key" class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{{ axis.label }}</label>
              <span class="text-xs font-mono text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                {{ axis.format(axis.values[axisIndices[axis.key] ?? 0]!) }}
              </span>
            </div>
            <!-- Discrete slider — uses index into axis values -->
            <USlider
              :model-value="axisIndices[axis.key] ?? 0"
              @update:model-value="axisIndices = { ...axisIndices, [axis.key]: $event as number }"
              :min="0"
              :max="axis.values.length - 1"
              :step="1"
              class="w-full"
              size="md"
            />
            <!-- Value labels under slider -->
            <div class="flex justify-between px-1">
              <button
                v-for="(val, vi) in axis.values" :key="vi"
                class="text-[9px] font-mono transition-colors cursor-pointer"
                :class="(axisIndices[axis.key] ?? 0) === vi
                  ? 'text-amber-700 font-bold'
                  : 'text-slate-400 hover:text-slate-600'"
                @click="axisIndices = { ...axisIndices, [axis.key]: vi }"
              >{{ axis.format(val) }}</button>
            </div>
          </div>
        </div>

        <!-- Current label -->
        <div class="px-4 py-2 bg-amber-100/40 flex items-center justify-between">
          <span class="text-xs font-semibold text-amber-700">{{ currentLabel }}</span>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-grid-3x3" @click="viewMode = 'grid'">Grid View</UButton>
        </div>

        <!-- Image display -->
        <div class="bg-white flex justify-center items-center min-h-[300px] p-4">
          <template v-if="matchedEntry?.status === 'complete' && matchedEntry.url">
            <img
              :src="matchedEntry.url"
              :alt="currentLabel"
              class="max-h-[500px] max-w-full rounded-lg shadow-lg transition-all duration-150"
              :key="matchedEntry.itemId ?? 'pending'"
            />
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

        <!-- Keyboard hint -->
        <div class="px-4 py-2 bg-slate-50 border-t border-slate-100">
          <p class="text-[10px] text-slate-400 text-center">
            ← → Arrow keys to scrub · Esc to exit · Click values to jump
          </p>
        </div>
      </div>
    </Transition>

    <!-- ═══ 2D GRID MODE ═══ -->
    <div v-if="viewMode === 'grid2d' && grid2D" class="overflow-x-auto rounded-xl border border-amber-200">
      <table class="w-full border-collapse">
        <!-- Column headers -->
        <thead>
          <tr>
            <th class="p-2 text-[10px] font-semibold text-amber-700 bg-amber-50 border-b border-r border-amber-200 sticky left-0 z-10">
              {{ grid2D.rowAxis.label }} \ {{ grid2D.colAxis.label }}
            </th>
            <th
              v-for="(cv, ci) in grid2D.cols" :key="ci"
              class="p-2 text-[10px] font-mono text-amber-600 bg-amber-50/60 border-b border-amber-200 min-w-[100px]"
            >{{ grid2D.colAxis.format(cv) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in grid2D.cells" :key="ri">
            <!-- Row header -->
            <td class="p-2 text-[10px] font-mono text-amber-600 bg-amber-50/40 border-b border-r border-amber-200 sticky left-0 z-10 whitespace-nowrap">
              {{ grid2D.rowAxis.format(grid2D.rows[ri]!) }}
            </td>
            <!-- Cells -->
            <td
              v-for="(cell, ci) in row" :key="ci"
              class="p-1 border-b border-amber-100 text-center"
              @click="cell && openCompareAt(cell)"
            >
              <!-- Complete -->
              <div v-if="cell?.status === 'complete' && cell.url" class="relative group cursor-pointer">
                <img :src="cell.url" :alt="cell.variant.label" class="w-full aspect-square object-cover rounded-md transition-transform group-hover:scale-[1.02]" loading="lazy" />
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-md flex items-center justify-center">
                  <UIcon name="i-lucide-maximize-2" class="w-4 h-4 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow" />
                </div>
              </div>
              <!-- Pending -->
              <div v-else-if="cell?.status === 'pending'" class="aspect-square bg-slate-50 rounded-md flex items-center justify-center">
                <div class="w-4 h-4 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
              </div>
              <!-- Failed -->
              <div v-else-if="cell?.status === 'failed'" class="aspect-square bg-red-50/50 rounded-md flex items-center justify-center">
                <UIcon name="i-lucide-x-circle" class="w-4 h-4 text-red-300" />
              </div>
              <!-- Empty  -->
              <div v-else class="aspect-square bg-slate-50/50 rounded-md" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ═══ GRID MODE ═══ -->
    <div v-if="viewMode === 'grid'" :class="['grid gap-2', gridCols]">
      <div
        v-for="(entry, i) in entries" :key="i"
        class="relative rounded-lg overflow-hidden border transition-all cursor-pointer group"
        :class="entry.status === 'complete'
          ? 'border-slate-200 hover:border-amber-300 hover:shadow-sm'
          : 'border-slate-100 cursor-default'"
        @click="openCompareAt(entry)"
      >
        <!-- Complete image -->
        <div v-if="entry.status === 'complete' && entry.url" class="aspect-square">
          <img :src="entry.url" :alt="entry.variant.label" class="w-full h-full object-cover" loading="lazy" />
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <UIcon name="i-lucide-sliders-horizontal" class="w-5 h-5 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-md" />
          </div>
        </div>

        <!-- Pending -->
        <div v-else-if="entry.status === 'pending'" class="aspect-square bg-slate-50 flex items-center justify-center">
          <div class="text-center">
            <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-1" />
            <span class="text-[9px] text-slate-400">Generating…</span>
          </div>
        </div>

        <!-- Failed -->
        <div v-else class="aspect-square bg-red-50/50 flex items-center justify-center">
          <UIcon name="i-lucide-x-circle" class="w-5 h-5 text-red-300" />
        </div>

        <!-- Parameter label overlay -->
        <div class="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/60 via-black/30 to-transparent px-2 py-1.5 pointer-events-none">
          <span class="text-[10px] font-medium text-white drop-shadow-sm leading-tight block">
            {{ entry.variant.label }}
          </span>
        </div>
      </div>
    </div>

    <!-- Tip for grid mode -->
    <p v-if="viewMode === 'grid' && completedCount >= 2" class="text-[10px] text-slate-400 mt-2 text-center">
      Click any image to open comparison sliders
    </p>
  </section>
</template>

<style scoped>
.compare-mode-enter-active, .compare-mode-leave-active {
  transition: all 0.2s ease;
}
.compare-mode-enter-from, .compare-mode-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
