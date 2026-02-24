<script setup lang="ts">
/**
 * Compact labeled slider with value display.
 * Replaces the repeated UFormField + USlider + span pattern used ~17 times across the app.
 */
const modelValue = defineModel<number>({ required: true })

defineProps<{
  label: string
  min: number
  max: number
  step?: number
  description?: string
  format?: (v: number) => string
  width?: string
}>()
</script>

<template>
  <UFormField :label="label" size="sm" :description="description">
    <div class="flex items-center gap-2">
      <USlider v-model="modelValue" :min="min" :max="max" :step="step ?? 1" :class="width ?? 'w-28'" size="xs" />
      <span class="text-xs text-slate-600 font-mono w-10 text-right shrink-0">{{ format ? format(modelValue) : modelValue }}</span>
    </div>
  </UFormField>
</template>
