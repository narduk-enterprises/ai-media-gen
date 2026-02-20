<script setup lang="ts">
/**
 * SweepComparisonGrid — interactive comparison for parameter sweep results.
 *
 * Two modes:
 *   1. Grid — all results at a glance with parameter labels
 *   2. Compare — full-size image with per-axis sliders to scrub between values
 */

interface SweepResultEntry {
  variant: { steps: number; loraStrength: number; width: number; height: number; seed: number; label: string }
  itemId: string | null
  status: 'pending' | 'complete' | 'failed'
  url: string | null
}

const props = defineProps<{
  entries: SweepResultEntry[]
  generating: boolean
}>()

// ─── Mode ───────────────────────────────────────────────────────────────
const viewMode = ref<'grid' | 'compare'>('grid')

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
// Extract unique values per axis from the sweep entries
interface AxisDef {
  key: string
  label: string
  values: number[]
  format: (v: number) => string
}

const axes = computed<AxisDef[]>(() => {
  const stepsSet = new Set<number>()
  const loraSet = new Set<number>()
  const sizeSet = new Set<number>()
  const seedSet = new Set<number>()

  for (const e of props.entries) {
    stepsSet.add(e.variant.steps)
    loraSet.add(e.variant.loraStrength)
    sizeSet.add(e.variant.width * 10000 + e.variant.height)
    seedSet.add(e.variant.seed)
  }

  const result: AxisDef[] = []

  if (stepsSet.size > 1) {
    result.push({
      key: 'steps',
      label: 'Steps',
      values: [...stepsSet].sort((a, b) => a - b),
      format: (v) => `${v} steps`,
    })
  }
  if (loraSet.size > 1) {
    result.push({
      key: 'lora',
      label: 'LoRA Strength',
      values: [...loraSet].sort((a, b) => a - b),
      format: (v) => `LoRA ${v.toFixed(2)}`,
    })
  }
  if (sizeSet.size > 1) {
    // Decode sizes
    const sizes = [...sizeSet].sort((a, b) => a - b)
    result.push({
      key: 'size',
      label: 'Resolution',
      values: sizes,
      format: (v) => {
        const w = Math.floor(v / 10000)
        const h = v % 10000
        return `${w}×${h}`
      },
    })
  }

  if (seedSet.size > 1) {
    result.push({
      key: 'seed',
      label: 'Seed',
      values: [...seedSet].sort((a, b) => a - b),
      format: (v) => `#${v.toString().slice(0, 6)}`,
    })
  }

  return result
})

// ─── Slider state ───────────────────────────────────────────────────────
// Index into each axis's values array
const axisIndices = ref<Record<string, number>>({})

// Initialize indices when axes change
watch(axes, (a) => {
  const newIndices: Record<string, number> = {}
  for (const axis of a) {
    newIndices[axis.key] = axisIndices.value[axis.key] ?? 0
  }
  axisIndices.value = newIndices
}, { immediate: true })

// Get the currently selected value for each axis
const selectedValues = computed(() => {
  const result: Record<string, number> = {}
  for (const axis of axes.value) {
    result[axis.key] = axis.values[axisIndices.value[axis.key] ?? 0] ?? axis.values[0]!
  }
  return result
})

// Find the matching entry for the current slider positions
const matchedEntry = computed(() => {
  const sv = selectedValues.value
  return props.entries.find(e => {
    const stepsMatch = axes.value.some(a => a.key === 'steps') ? e.variant.steps === sv.steps : true
    const loraMatch = axes.value.some(a => a.key === 'lora') ? e.variant.loraStrength === sv.lora : true
    const sizeMatch = axes.value.some(a => a.key === 'size') ? (e.variant.width * 10000 + e.variant.height) === sv.size : true
    const seedMatch = axes.value.some(a => a.key === 'seed') ? e.variant.seed === sv.seed : true
    return stepsMatch && loraMatch && sizeMatch && seedMatch
  }) ?? null
})

// Label for the current selection
const currentLabel = computed(() => {
  return axes.value.map(a => {
    const val = selectedValues.value[a.key]!
    return a.format(val)
  }).join(' · ')
})

// ─── Keyboard nav ───────────────────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if (viewMode.value !== 'compare' || axes.value.length === 0) return

  // Use left/right for single axis, or first axis if multiple
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

// Open compare from grid click
function openCompareAt(entry: SweepResultEntry) {
  if (entry.status !== 'complete') return

  // Set slider indices to match this entry's values
  for (const axis of axes.value) {
    if (axis.key === 'steps') {
      axisIndices.value = { ...axisIndices.value, steps: axis.values.indexOf(entry.variant.steps) }
    } else if (axis.key === 'lora') {
      axisIndices.value = { ...axisIndices.value, lora: axis.values.indexOf(entry.variant.loraStrength) }
    } else if (axis.key === 'size') {
      const encoded = entry.variant.width * 10000 + entry.variant.height
      axisIndices.value = { ...axisIndices.value, size: axis.values.indexOf(encoded) }
    } else if (axis.key === 'seed') {
      axisIndices.value = { ...axisIndices.value, seed: axis.values.indexOf(entry.variant.seed) }
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
        <UButton
          v-if="completedCount >= 2"
          size="xs"
          :variant="viewMode === 'compare' ? 'soft' : 'outline'"
          :color="viewMode === 'compare' ? 'warning' : 'neutral'"
          :icon="viewMode === 'compare' ? 'i-lucide-grid-3x3' : 'i-lucide-sliders-horizontal'"
          @click="viewMode = viewMode === 'compare' ? 'grid' : 'compare'"
        >{{ viewMode === 'compare' ? 'Grid' : 'Compare' }}</UButton>
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

    <!-- ═══ GRID MODE ═══ -->
    <div v-if="viewMode === 'grid'" :class="['grid gap-2', gridCols]">
      <div
        v-for="(entry, i) in entries"
        :key="i"
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
