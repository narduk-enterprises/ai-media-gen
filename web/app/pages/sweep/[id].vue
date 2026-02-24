<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const sweepId = computed(() => route.params.id as string)

useSeoMeta({ title: 'Sweep Comparison' })

// Fetch sweep data
const { data: sweep, pending, error, refresh } = useAsyncData(
  `sweep-${sweepId.value}`,
  () => $fetch<{
    sweepId: string
    prompt: string
    totalVariants: number
    generations: {
      id: string
      prompt: string
      sweepLabel: string
      settings: Record<string, any>
      items: { id: string; type: string; status: string; url: string | null; error: string | null }[]
      createdAt: string
    }[]
  }>(`/api/sweep/${sweepId.value}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }),
  { server: false }
)

// Transform to SweepResultEntry format for the comparison grid
const sweepEntries = computed(() => {
  if (!sweep.value) return []
  return sweep.value.generations.map(gen => {
    const s = gen.settings || {}
    const item = gen.items.find(i => i.type === 'image')
    return {
      variant: {
        steps: s.steps ?? 0,
        loraStrength: s.loraStrength ?? 1.0,
        width: s.width ?? 0,
        height: s.height ?? 0,
        seed: s.seed ?? 0,
        label: gen.sweepLabel || `${s.steps}st`,
      },
      itemId: item?.id ?? null,
      status: (item?.status === 'complete' ? 'complete' : item?.status === 'failed' ? 'failed' : 'pending') as 'pending' | 'complete' | 'failed',
      url: item?.url ?? null,
    }
  })
})

// Auto-refresh while any items pending
const hasActive = computed(() => sweepEntries.value.some(e => e.status === 'pending'))
let refreshTimer: ReturnType<typeof setInterval> | null = null

watch(hasActive, (active) => {
  if (active && !refreshTimer) {
    refreshTimer = setInterval(() => refresh(), 5000)
  } else if (!active && refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <NuxtLink to="/create" class="text-sm text-slate-400 hover:text-slate-600 transition-colors">
            ← Create
          </NuxtLink>
        </div>
        <h1 class="font-display text-2xl font-bold text-slate-800">
          <span class="text-transparent bg-clip-text bg-linear-to-r from-amber-500 to-orange-500">Sweep Comparison</span>
        </h1>
        <p v-if="sweep" class="text-sm text-slate-500 mt-1 max-w-xl truncate">
          "{{ sweep.prompt }}" · {{ sweep.totalVariants }} variants
        </p>
      </div>
      <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-refresh-cw" @click="refresh()">Refresh</UButton>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex items-center justify-center min-h-[300px]">
      <div class="text-center">
        <div class="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
        <p class="text-sm text-slate-400">Loading sweep…</p>
      </div>
    </div>

    <!-- Error -->
    <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error.message || 'Failed to load sweep'" class="mb-6" />

    <!-- Comparison Grid -->
    <SweepComparisonGrid v-else-if="sweepEntries.length > 0" :entries="sweepEntries" :generating="hasActive" />

    <!-- Empty -->
    <div v-else class="text-center py-16 text-slate-400">
      <UIcon name="i-lucide-grid-3x3" class="w-12 h-12 mb-3 opacity-40" />
      <p>No sweep data found.</p>
    </div>
  </div>
</template>
