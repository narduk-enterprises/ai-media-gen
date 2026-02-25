<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  min?: number
  max?: number
  lowLabel?: string
  highLabel?: string
  hint?: string
}>(), {
  label: 'Quality (Steps)',
  min: 1,
  max: 20,
  lowLabel: 'Faster',
  highLabel: 'Higher quality',
})

const modelValue = defineModel<number>({ default: 4 })
</script>

<template>
  <section>
    <div class="flex items-center justify-between mb-2">
      <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{{ label }}</label>
      <span class="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ modelValue }}</span>
    </div>
    <USlider v-model="modelValue" :min="min" :max="max" class="w-full" size="xs" />
    <div class="flex justify-between text-[9px] text-slate-400 mt-1">
      <span>{{ lowLabel }}</span>
      <span>{{ highLabel }}</span>
    </div>
    <p v-if="hint" class="text-[10px] text-slate-500 mt-1">{{ hint }}</p>
  </section>
</template>
