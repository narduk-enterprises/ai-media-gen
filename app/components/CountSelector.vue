<script setup lang="ts">
defineProps<{
  label?: string
  options?: number[]
}>()

const modelValue = defineModel<number>({ default: 1 })
</script>

<template>
  <div class="flex items-center gap-3">
    <span class="text-xs text-slate-500 font-medium">{{ label || 'Count' }}</span>
    <UButton
      v-for="n in (options || [1, 2, 4])" :key="n"
      size="xs"
      :variant="modelValue === n ? 'soft' : 'outline'"
      :color="modelValue === n ? 'primary' : 'neutral'"
      @click="modelValue = n"
    >
      {{ n }}
    </UButton>
    <slot />
  </div>
</template>
