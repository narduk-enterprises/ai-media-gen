<script setup lang="ts">
import { IMAGE_MODELS, IMAGE_MODEL_PARAMS } from '~/composables/useCreateShared'

const gen = useGeneration()
const shared = useCreateShared()

// ─── Local State ────────────────────────────────────────────────────────
const prompt = ref('')
const negativePrompt = ref('')
const selectedModel = ref('wan22')
const seed = ref(42)

// ─── Sweep Axes ─────────────────────────────────────────────────────────
const sweepSteps = ref(true)
const sweepLora = ref(false)
const sweepSizes = ref(false)
const sweepSeeds = ref(false)
const seedCount = ref(5)

const stepsValues = ref([4, 8, 12, 20, 30, 40])
const loraValues = ref([0, 0.5, 1.0, 1.5])
const sizeValues = ref([
  { w: 512, h: 512 },
  { w: 768, h: 768 },
  { w: 1024, h: 1024 },
])

const stepsInput = ref('4, 8, 12, 20, 30, 40')
const loraInput = ref('0, 0.5, 1.0, 1.5')
const sizesInput = ref('512x512, 768x768, 1024x1024')

function parseSteps(raw: string) {
  return raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0)
}
function parseLora(raw: string) {
  return raw.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n >= 0)
}
function parseSizes(raw: string) {
  return raw.split(',').map(s => {
    const [w, h] = s.trim().split('x').map(Number)
    return w && h ? { w, h } : null
  }).filter(Boolean) as { w: number; h: number }[]
}

watch(stepsInput, (v) => { stepsValues.value = parseSteps(v) })
watch(loraInput, (v) => { loraValues.value = parseLora(v) })
watch(sizesInput, (v) => { sizeValues.value = parseSizes(v) })

// Generate random seeds on demand (stable per seedCount)
const seedValues = ref<number[]>([])
function regenerateSeeds() {
  seedValues.value = Array.from({ length: seedCount.value }, () => Math.floor(Math.random() * 999999999))
}
watch(seedCount, () => regenerateSeeds())
// Initial generation
regenerateSeeds()

// ─── Cartesian Product ──────────────────────────────────────────────────
const params = computed(() => shared.getImageModelParams(selectedModel.value))

export interface SweepVariant {
  steps: number
  loraStrength: number
  width: number
  height: number
  seed: number
  label: string
}

const variants = computed<SweepVariant[]>(() => {
  const stepsArr = sweepSteps.value ? stepsValues.value : [params.value.steps.default]
  const loraArr = sweepLora.value ? loraValues.value : [params.value.lora?.default ?? 1.0]
  const sizesArr = sweepSizes.value ? sizeValues.value : [{ w: params.value.defaultWidth, h: params.value.defaultHeight }]
  const seedsArr = sweepSeeds.value ? seedValues.value : [seed.value]

  const result: SweepVariant[] = []
  for (const sd of seedsArr) {
    for (const s of stepsArr) {
      for (const l of loraArr) {
        for (const sz of sizesArr) {
          const parts: string[] = []
          if (sweepSeeds.value) parts.push(`#${sd.toString().slice(0, 6)}`)
          if (sweepSteps.value) parts.push(`${s}st`)
          if (sweepLora.value) parts.push(`LoRA ${l}`)
          if (sweepSizes.value) parts.push(`${sz.w}×${sz.h}`)
          result.push({ steps: s, loraStrength: l, width: sz.w, height: sz.h, seed: sd, label: parts.join(' · ') })
        }
      }
    }
  }
  return result
})

const totalCount = computed(() => variants.value.length)
const canGenerate = computed(() => prompt.value.trim().length > 0 && totalCount.value > 0)

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
      model: selectedModel.value,
      seed: variant.seed,
      append: true,
      sweepId,
      sweepLabel: variant.label,
    })
    const latest = gen.results.value[gen.results.value.length - 1]
    if (latest && sweepResults.value[i]) {
      sweepResults.value[i]!.itemId = latest.id
    }
  }
}

function randomizeSeed() {
  seed.value = Math.floor(Math.random() * 999999999)
}

defineExpose({ generate, canGenerate, totalCount, isVideo: false, sweepResults, sweepActive })
</script>

<template>
  <div class="space-y-3 pt-3">
    <!-- Header -->
    <p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
      <strong>Parameter Sweep</strong> — fixed seed, varying parameters, side-by-side comparison.
    </p>

    <!-- Prompt -->
    <PromptInput v-model="prompt" placeholder="Enter a prompt to test across parameter variations..." :disabled="gen.generating.value" />
    <UInput v-model="negativePrompt" size="xs" placeholder="Negative prompt (optional)" icon="i-lucide-minus" class="w-full" />

    <!-- Model Selector -->
    <ModelSelector :models="IMAGE_MODELS" :selected="selectedModel" color="amber" @update:selected="selectedModel = $event as string" />

    <!-- Seed + Sweep Axes in one card -->
    <UCard variant="outline">
      <div class="space-y-3">
        <!-- Fixed Seed — hidden when sweeping seeds -->
        <div v-if="!sweepSeeds" class="flex items-center gap-3">
          <span class="text-xs font-medium text-slate-600 w-14 shrink-0">Seed</span>
          <UInput v-model.number="seed" type="number" size="xs" class="w-28" />
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-shuffle" square @click="randomizeSeed" title="Randomize" />
        </div>

        <div :class="sweepSeeds ? '' : 'border-t border-slate-100 pt-2'">
          <h3 class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Sweep Axes</h3>
          <div class="space-y-2">
            <!-- Seeds -->
            <div class="flex items-center gap-2">
              <UCheckbox v-model="sweepSeeds" class="shrink-0" />
              <span class="text-xs text-slate-600 w-10 shrink-0">Seeds</span>
              <template v-if="sweepSeeds">
                <UInput v-model.number="seedCount" type="number" size="xs" :min="2" :max="50" class="w-16" />
                <span class="text-[10px] text-slate-400">random seeds</span>
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-shuffle" square @click="regenerateSeeds" title="Reshuffle seeds" />
              </template>
              <span v-else class="text-[10px] text-slate-400">fixed</span>
            </div>
            <!-- Steps -->
            <div class="flex items-center gap-2">
              <UCheckbox v-model="sweepSteps" class="shrink-0" />
              <span class="text-xs text-slate-600 w-10 shrink-0">Steps</span>
              <UInput v-if="sweepSteps" v-model="stepsInput" size="xs" placeholder="4, 8, 12, 20, 30, 40" class="flex-1" />
              <span v-else class="text-[10px] text-slate-400">{{ params.steps.default }}</span>
            </div>
            <!-- LoRA -->
            <div class="flex items-center gap-2">
              <UCheckbox v-model="sweepLora" class="shrink-0" />
              <span class="text-xs text-slate-600 w-10 shrink-0">LoRA</span>
              <UInput v-if="sweepLora" v-model="loraInput" size="xs" placeholder="0, 0.5, 1.0, 1.5" class="flex-1" />
              <span v-else class="text-[10px] text-slate-400">{{ params.lora?.default ?? 1.0 }}</span>
            </div>
            <!-- Sizes -->
            <div class="flex items-center gap-2">
              <UCheckbox v-model="sweepSizes" class="shrink-0" />
              <span class="text-xs text-slate-600 w-10 shrink-0">Sizes</span>
              <UInput v-if="sweepSizes" v-model="sizesInput" size="xs" placeholder="512x512, 768x768" class="flex-1" />
              <span v-else class="text-[10px] text-slate-400">{{ params.defaultWidth }}×{{ params.defaultHeight }}</span>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Variants count -->
    <div class="flex items-center gap-2 px-1">
      <span class="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{{ totalCount }} variant{{ totalCount !== 1 ? 's' : '' }}</span>
      <template v-if="totalCount > 0 && totalCount <= 12">
        <span class="text-slate-300">·</span>
        <span v-for="(v, i) in variants" :key="i" class="text-[10px] text-slate-400">{{ v.label }}<span v-if="i < variants.length - 1">,&nbsp;</span></span>
      </template>
    </div>

    <!-- Sweep Comparison Grid (inline results) -->
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
      <div class="text-xs text-amber-700">Sweeping {{ gen.batchProgress.value.current }} / {{ gen.batchProgress.value.total }}…</div>
    </div>
  </div>
</template>
