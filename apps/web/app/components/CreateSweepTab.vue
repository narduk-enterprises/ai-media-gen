<script setup lang="ts">
import { IMAGE_MODELS, IMAGE_MODEL_PARAMS } from '~/composables/useCreateShared'
import type { ImageModelParams } from '~/composables/models'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Local State ────────────────────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref('')
const selectedModel = ref('wan22')
const seed = ref(42)

// ─── Value Parser ───────────────────────────────────────────────────────
// Supports: comma-separated, ranges (min-max:step), or mixed
// Examples: "4, 8, 12"  |  "4-40:4"  |  "4, 10-30:5"

function parseNumericValues(raw: string): number[] {
  const results: number[] = []
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const rangeMatch = part.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*(?::(\d+(?:\.\d+)?))?$/)
    if (rangeMatch) {
      const lo = Number.parseFloat(rangeMatch[1]!)
      const hi = Number.parseFloat(rangeMatch[2]!)
      const step = rangeMatch[3] ? Number.parseFloat(rangeMatch[3]) : (hi - lo) / 9
      if (step > 0 && hi >= lo) {
        for (let v = lo; v <= hi + step * 0.001; v += step) {
          results.push(Math.round(v * 1000) / 1000)
        }
      }
    } else {
      const n = Number.parseFloat(part)
      if (!isNaN(n)) results.push(n)
    }
  }
  return [...new Set(results)]
}

function parseStringValues(raw: string): string[] {
  return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
}

function parseSizes(raw: string): { w: number; h: number }[] {
  const results: { w: number; h: number }[] = []
  for (const part of raw.split(',').map(s => s.trim())) {
    const [w, h] = part.split('x').map(Number)
    if (w && h) results.push({ w, h })
  }
  return results
}

// ─── Sweep Axis Definitions ─────────────────────────────────────────────
interface SweepAxis {
  key: string
  label: string
  icon: string
  enabled: Ref<boolean>
  input: Ref<string>
  hint: string
}

const sweepSteps = ref(true)
const sweepCfg = ref(false)
const sweepLora = ref(false)
const sweepSampler = ref(false)
const sweepScheduler = ref(false)
const sweepSizes = ref(false)
const sweepSeeds = ref(true)

const stepsInput = ref('4, 8, 12, 20, 30, 40')
const cfgInput = ref('1-10:1')
const loraInput = ref('0, 0.5, 1.0, 1.5')
const samplerInput = ref('')
const schedulerInput = ref('')
const sizesInput = ref('512x512, 768x768, 1024x1024')

// ─── Seed Controls ──────────────────────────────────────────────────────
type SeedMode = 'fixed' | 'random' | 'manual' | 'sequential'
const seedMode = ref<SeedMode>('random')
const seedCount = ref(6)
const manualSeedsInput = ref('42, 123, 456, 789, 1234')
const sequentialBase = ref(42)

const seedModes: { value: SeedMode; label: string; icon: string }[] = [
  { value: 'fixed', label: 'Fixed', icon: 'i-lucide-lock' },
  { value: 'random', label: 'Random', icon: 'i-lucide-shuffle' },
  { value: 'manual', label: 'Manual', icon: 'i-lucide-edit-3' },
  { value: 'sequential', label: 'Sequential', icon: 'i-lucide-arrow-right' },
]

const randomSeeds = ref<number[]>([])
function regenerateRandomSeeds() {
  randomSeeds.value = Array.from({ length: seedCount.value }, () => Math.floor(Math.random() * 999999999))
}
watch(seedCount, () => regenerateRandomSeeds())
regenerateRandomSeeds()

function randomizeSeed() {
  seed.value = Math.floor(Math.random() * 999999999)
}

const seedValues = computed<number[]>(() => {
  if (!sweepSeeds.value) return [seed.value]
  switch (seedMode.value) {
    case 'fixed': return [seed.value]
    case 'random': return randomSeeds.value
    case 'manual': return parseNumericValues(manualSeedsInput.value).map(Math.floor)
    case 'sequential': return Array.from({ length: seedCount.value }, (_, i) => sequentialBase.value + i)
  }
})

// ─── Model-aware defaults ───────────────────────────────────────────────
const params = computed<ImageModelParams>(() => shared.getImageModelParams(selectedModel.value))

// When model changes, update sampler/scheduler inputs with model's available options
watch(selectedModel, () => {
  const p = params.value
  if (p.sampler) samplerInput.value = p.sampler.options.join(', ')
  if (p.scheduler) schedulerInput.value = p.scheduler.options.join(', ')
}, { immediate: true })

// ─── Computed axes list ─────────────────────────────────────────────────
const axes = computed<SweepAxis[]>(() => {
  const result: SweepAxis[] = [
    { key: 'steps', label: 'Steps', icon: 'i-lucide-footprints', enabled: sweepSteps, input: stepsInput, hint: `Default: ${params.value.steps.default}` },
  ]
  if (params.value.cfg) {
    result.push({ key: 'cfg', label: 'CFG Scale', icon: 'i-lucide-sliders-vertical', enabled: sweepCfg, input: cfgInput, hint: `Range: ${params.value.cfg.min}–${params.value.cfg.max}` })
  }
  if (params.value.lora) {
    result.push({ key: 'lora', label: 'LoRA Strength', icon: 'i-lucide-layers', enabled: sweepLora, input: loraInput, hint: `Range: ${params.value.lora.min}–${params.value.lora.max}` })
  }
  if (params.value.sampler) {
    result.push({ key: 'sampler', label: 'Sampler', icon: 'i-lucide-sigma', enabled: sweepSampler, input: samplerInput, hint: `${params.value.sampler.options.length} available` })
  }
  if (params.value.scheduler) {
    result.push({ key: 'scheduler', label: 'Scheduler', icon: 'i-lucide-calendar-clock', enabled: sweepScheduler, input: schedulerInput, hint: `${params.value.scheduler.options.length} available` })
  }
  result.push({ key: 'sizes', label: 'Resolution', icon: 'i-lucide-maximize-2', enabled: sweepSizes, input: sizesInput, hint: `Default: ${params.value.defaultWidth}×${params.value.defaultHeight}` })
  return result
})

// ─── Quick Presets ───────────────────────────────────────────────────────
interface Preset {
  label: string
  icon: string
  apply: () => void
}

const presets = computed<Preset[]>(() => {
  const result: Preset[] = [
    {
      label: 'Steps Comparison',
      icon: 'i-lucide-footprints',
      apply: () => {
        sweepSteps.value = true; sweepCfg.value = false; sweepLora.value = false
        sweepSampler.value = false; sweepScheduler.value = false; sweepSizes.value = false; sweepSeeds.value = false
        stepsInput.value = '4, 8, 12, 20, 30, 40'
      },
    },
    {
      label: 'CFG Exploration',
      icon: 'i-lucide-sliders-vertical',
      apply: () => {
        sweepSteps.value = false; sweepCfg.value = true; sweepLora.value = false
        sweepSampler.value = false; sweepScheduler.value = false; sweepSizes.value = false; sweepSeeds.value = false
        cfgInput.value = '1, 2, 3, 5, 7, 10'
      },
    },
  ]
  if (params.value.sampler) {
    result.push({
      label: 'Sampler Shootout',
      icon: 'i-lucide-sigma',
      apply: () => {
        sweepSteps.value = false; sweepCfg.value = false; sweepLora.value = false
        sweepSampler.value = true; sweepScheduler.value = false; sweepSizes.value = false; sweepSeeds.value = false
        samplerInput.value = params.value.sampler!.options.join(', ')
      },
    })
  }
  if (params.value.scheduler) {
    result.push({
      label: 'Scheduler Test',
      icon: 'i-lucide-calendar-clock',
      apply: () => {
        sweepSteps.value = false; sweepCfg.value = false; sweepLora.value = false
        sweepSampler.value = false; sweepScheduler.value = true; sweepSizes.value = false; sweepSeeds.value = false
        schedulerInput.value = params.value.scheduler!.options.join(', ')
      },
    })
  }
  result.push({
    label: 'Seed Variations',
    icon: 'i-lucide-shuffle',
    apply: () => {
      sweepSteps.value = false; sweepCfg.value = false; sweepLora.value = false
      sweepSampler.value = false; sweepScheduler.value = false; sweepSizes.value = false
      sweepSeeds.value = true; seedMode.value = 'random'; seedCount.value = 6
      regenerateRandomSeeds()
    },
  })
  if (params.value.sampler && params.value.cfg) {
    result.push({
      label: 'Steps × CFG Grid',
      icon: 'i-lucide-grid-3x3',
      apply: () => {
        sweepSteps.value = true; sweepCfg.value = true; sweepLora.value = false
        sweepSampler.value = false; sweepScheduler.value = false; sweepSizes.value = false; sweepSeeds.value = false
        stepsInput.value = '8, 20, 40'
        cfgInput.value = '2, 5, 8'
      },
    })
  }
  return result
})

// ─── Cartesian Product ──────────────────────────────────────────────────
export interface SweepVariant {
  steps: number
  cfg: number
  loraStrength: number
  sampler: string
  scheduler: string
  width: number
  height: number
  seed: number
  label: string
}

const variants = computed<SweepVariant[]>(() => {
  const stepsArr = sweepSteps.value ? parseNumericValues(stepsInput.value) : [params.value.steps.default]
  const cfgArr = sweepCfg.value ? parseNumericValues(cfgInput.value) : [params.value.cfg?.default ?? 7]
  const loraArr = sweepLora.value ? parseNumericValues(loraInput.value) : [params.value.lora?.default ?? 1.0]
  const samplerArr = sweepSampler.value ? parseStringValues(samplerInput.value) : [params.value.sampler?.default ?? 'euler']
  const schedulerArr = sweepScheduler.value ? parseStringValues(schedulerInput.value) : [params.value.scheduler?.default ?? 'normal']
  const sizesArr = sweepSizes.value ? parseSizes(sizesInput.value) : [{ w: params.value.defaultWidth, h: params.value.defaultHeight }]
  const seedsArr = seedValues.value

  const result: SweepVariant[] = []
  for (const sd of seedsArr) {
    for (const s of stepsArr) {
      for (const c of cfgArr) {
        for (const l of loraArr) {
          for (const sam of samplerArr) {
            for (const sch of schedulerArr) {
              for (const sz of sizesArr) {
                const parts: string[] = []
                if (sweepSeeds.value) parts.push(`#${sd.toString().slice(0, 6)}`)
                if (sweepSteps.value) parts.push(`${s}st`)
                if (sweepCfg.value) parts.push(`CFG ${c}`)
                if (sweepLora.value) parts.push(`LoRA ${l}`)
                if (sweepSampler.value) parts.push(sam)
                if (sweepScheduler.value) parts.push(sch)
                if (sweepSizes.value) parts.push(`${sz.w}×${sz.h}`)
                result.push({
                  steps: s, cfg: c, loraStrength: l, sampler: sam, scheduler: sch,
                  width: sz.w, height: sz.h, seed: sd,
                  label: parts.join(' · '),
                })
              }
            }
          }
        }
      }
    }
  }
  return result
})

const totalCount = computed(() => variants.value.length)
const canGenerate = computed(() => prompt.value.trim().length > 0 && totalCount.value > 0 && totalCount.value <= 200)

// ─── Active axis count (for UI hints) ───────────────────────────────────
const activeAxisCount = computed(() => {
  let c = 0
  if (sweepSteps.value) c++
  if (sweepCfg.value) c++
  if (sweepLora.value) c++
  if (sweepSampler.value) c++
  if (sweepScheduler.value) c++
  if (sweepSizes.value) c++
  if (sweepSeeds.value) c++
  return c
})

// ─── Variant list collapsed ─────────────────────────────────────────────
const showVariantList = ref(false)

// ─── Sweep Results Tracking ─────────────────────────────────────────────
export interface SweepResultEntry {
  variant: SweepVariant
  itemId: string | null
  status: 'pending' | 'complete' | 'failed'
  url: string | null
}

const sweepResults = ref<SweepResultEntry[]>([])
const sweepActive = ref(false)

watch(() => gen.results.value, (results) => {
  if (!sweepActive.value) return
  for (const entry of sweepResults.value) {
    if (!entry.itemId) continue
    const r = results.find((r: any) => r.id === entry.itemId)
    if (r) {
      entry.status = r.status === 'complete' ? 'complete' : r.status === 'failed' ? 'failed' : 'pending'
      entry.url = r.url || null
    }
  }
}, { deep: true })

// ─── Generate ───────────────────────────────────────────────────────────
const lastSweepId = ref<string | null>(null)

async function generate() {
  if (!canGenerate.value) return
  const p = prompt.value.trim()

  const sweepId = crypto.randomUUID()
  lastSweepId.value = sweepId

  sweepResults.value = variants.value.map(v => ({
    variant: { ...v },
    itemId: null,
    status: 'pending' as const,
    url: null,
  }))
  sweepActive.value = true
  gen.clearResults()

  for (let i = 0; i < variants.value.length; i++) {
    const variant = variants.value[i]!
    await gen.generate({
      prompts: [p],
      negativePrompt: negativePrompt.value,
      steps: variant.steps,
      width: variant.width,
      height: variant.height,
      loraStrength: variant.loraStrength,
      cfg: variant.cfg,
      sampler: variant.sampler,
      scheduler: variant.scheduler,
      model: selectedModel.value,
      seed: variant.seed,
      append: true,
      sweepId,
      sweepLabel: variant.label,
    })
    const latest = gen.results.value.at(-1)
    if (latest && sweepResults.value[i]) {
      sweepResults.value[i]!.itemId = latest.id
    }
  }
}

defineExpose({ generate, canGenerate, totalCount, isVideo: false, sweepResults, sweepActive })
</script>

<template>
  <div class="space-y-4 pt-3">
    <!-- Header Banner -->
    <div class="relative overflow-hidden rounded-xl bg-linear-to-br from-amber-500/10 via-orange-500/5 to-rose-500/10 border border-amber-200/60 px-4 py-3">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-linear-to-br from-amber-500 to-orange-500 flex items-center justify-center shrink-0">
          <UIcon name="i-lucide-test-tubes" class="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">Parameter Sweep</h3>
          <p class="text-[11px] text-amber-700/80">Fixed prompt, varying parameters — compare results side-by-side. Supports <code class="bg-amber-200/40 px-1 rounded text-[10px]">4, 8, 12</code> and <code class="bg-amber-200/40 px-1 rounded text-[10px]">4-40:4</code> range syntax.</p>
        </div>
      </div>
    </div>

    <!-- Prompt -->
    <PromptInput v-model="prompt" media-type="image" placeholder="Enter a prompt to test across parameter variations..." :disabled="gen.generating.value" />
    <UInput v-model="negativePrompt" size="xs" placeholder="Negative prompt (optional)" icon="i-lucide-minus" class="w-full" />

    <!-- Model Selector -->
    <ModelSelector :models="IMAGE_MODELS" :selected="selectedModel" color="amber" @update:selected="selectedModel = $event as string" />

    <!-- Quick Presets -->
    <div class="flex flex-wrap gap-1.5">
      <UButton
        v-for="preset in presets"
        :key="preset.label"
        size="xs"
        variant="soft"
        color="warning"
        :icon="preset.icon"
        @click="preset.apply"
      >{{ preset.label }}</UButton>
    </div>

    <!-- ═══ Seed Control Card ═══ -->
    <UCard variant="outline">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-dice-3" class="w-4 h-4 text-amber-500" />
            <h3 class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Seed Control</h3>
          </div>
          <UCheckbox v-model="sweepSeeds" label="Sweep Seeds" />
        </div>

        <!-- Seed mode tabs — only when sweeping seeds -->
        <template v-if="sweepSeeds">
          <div class="flex gap-1 bg-slate-50 rounded-lg p-1">
            <button
              v-for="sm in seedModes"
              :key="sm.value"
              class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer"
              :class="seedMode === sm.value
                ? 'bg-white text-amber-700 shadow-sm border border-amber-200'
                : 'text-slate-500 hover:text-slate-700'"
              @click="seedMode = sm.value"
            >
              <UIcon :name="sm.icon" class="w-3.5 h-3.5" />
              {{ sm.label }}
            </button>
          </div>

          <!-- Random mode -->
          <div v-if="seedMode === 'random'" class="flex items-center gap-2">
            <UInput v-model.number="seedCount" type="number" size="xs" :min="2" :max="50" class="w-20" />
            <span class="text-[11px] text-slate-400">random seeds</span>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-shuffle" square @click="regenerateRandomSeeds" title="Reshuffle seeds" />
            <span class="text-[10px] text-slate-400 font-mono truncate flex-1">{{ randomSeeds.slice(0, 3).join(', ') }}{{ randomSeeds.length > 3 ? '…' : '' }}</span>
          </div>

          <!-- Manual mode -->
          <div v-else-if="seedMode === 'manual'" class="space-y-1">
            <UInput v-model="manualSeedsInput" size="xs" placeholder="42, 123, 456, 789" class="w-full font-mono" />
            <p class="text-[10px] text-slate-400">Comma-separated seed values</p>
          </div>

          <!-- Sequential mode -->
          <div v-else-if="seedMode === 'sequential'" class="flex items-center gap-2">
            <span class="text-[11px] text-slate-500">Base:</span>
            <UInput v-model.number="sequentialBase" type="number" size="xs" class="w-28" />
            <span class="text-[11px] text-slate-500">Count:</span>
            <UInput v-model.number="seedCount" type="number" size="xs" :min="2" :max="50" class="w-16" />
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-shuffle" square @click="sequentialBase = Math.floor(Math.random() * 999999999)" title="Random base" />
          </div>
        </template>

        <!-- Fixed seed when NOT sweeping -->
        <div v-if="!sweepSeeds" class="flex items-center gap-2">
          <span class="text-xs text-slate-500 w-10 shrink-0">Seed</span>
          <UInput v-model.number="seed" type="number" size="xs" class="w-32 font-mono" />
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-shuffle" square @click="randomizeSeed" title="Randomize" />
        </div>
      </div>
    </UCard>

    <!-- ═══ Sweep Axes Card ═══ -->
    <UCard variant="outline">
      <div class="space-y-2.5">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-amber-500" />
          <h3 class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Sweep Axes</h3>
          <span class="ml-auto text-[10px] text-slate-400" v-if="activeAxisCount > 0">{{ activeAxisCount }} active</span>
        </div>

        <!-- Axis rows -->
        <div
          v-for="axis in axes"
          :key="axis.key"
          class="flex items-start gap-2 group rounded-lg px-2 py-1.5 transition-colors"
          :class="axis.enabled.value ? 'bg-amber-50/50' : 'hover:bg-slate-50'"
        >
          <UCheckbox v-model="axis.enabled.value" class="shrink-0 mt-0.5" />
          <div class="flex items-center gap-1.5 shrink-0 w-24">
            <UIcon :name="axis.icon" class="w-3.5 h-3.5 text-slate-400" />
            <span class="text-xs font-medium" :class="axis.enabled.value ? 'text-amber-700' : 'text-slate-600'">{{ axis.label }}</span>
          </div>
          <template v-if="axis.enabled.value">
            <UInput v-model="axis.input.value" size="xs" class="flex-1 font-mono text-[11px]" />
          </template>
          <span v-else class="text-[10px] text-slate-400 mt-0.5">{{ axis.hint }}</span>
        </div>
      </div>
    </UCard>

    <!-- ═══ Variant Summary ═══ -->
    <div class="flex items-center gap-3 px-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold" :class="totalCount > 100 ? 'text-red-600' : totalCount > 50 ? 'text-amber-600' : 'text-slate-700'">
          {{ totalCount }} variant{{ totalCount !== 1 ? 's' : '' }}
        </span>
        <span v-if="totalCount > 100" class="text-[10px] text-red-500">⚠ max 200</span>
      </div>

      <button
        v-if="totalCount > 0 && totalCount <= 50"
        class="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer flex items-center gap-1 transition-colors"
        @click="showVariantList = !showVariantList"
      >
        <UIcon :name="showVariantList ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-3 h-3" />
        {{ showVariantList ? 'Hide' : 'Show' }} variants
      </button>
    </div>

    <!-- Expandable variant list -->
    <Transition name="variant-list">
      <div v-if="showVariantList && totalCount <= 50" class="bg-slate-50 rounded-lg border border-slate-100 max-h-48 overflow-y-auto">
        <div
          v-for="(v, i) in variants"
          :key="i"
          class="flex items-center gap-2 px-3 py-1 text-[10px] font-mono text-slate-500 border-b border-slate-100 last:border-0"
        >
          <span class="text-slate-300 w-6 text-right shrink-0">{{ i + 1 }}.</span>
          <span>{{ v.label }}</span>
        </div>
      </div>
    </Transition>

    <!-- ═══ Sweep Comparison Grid (inline results) ═══ -->
    <SweepComparisonGrid v-if="sweepActive && sweepResults.length > 0" :entries="sweepResults" :generating="gen.generating.value" />

    <!-- Link to persistent sweep page -->
    <div v-if="lastSweepId && sweepActive" class="flex items-center justify-center gap-2 mt-2">
      <NuxtLink :to="`/sweep/${lastSweepId}`" class="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1 transition-colors">
        <UIcon name="i-lucide-external-link" class="w-3 h-3" />
        Open in Sweep Page
      </NuxtLink>
    </div>

    <!-- Batch progress -->
    <div v-if="gen.generating.value && gen.batchProgress.value.total > 0" class="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
      <div class="w-4 h-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin shrink-0" />
      <div class="flex-1">
        <div class="text-xs text-amber-700 font-medium">Sweeping {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }}…</div>
        <div class="mt-1 h-1 bg-amber-100 rounded-full overflow-hidden">
          <div class="h-full bg-linear-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500" :style="{ width: `${(gen.batchProgress.value.current / gen.batchProgress.value.total) * 100}%` }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.variant-list-enter-active, .variant-list-leave-active {
  transition: all 0.2s ease;
}
.variant-list-enter-from, .variant-list-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}
</style>
