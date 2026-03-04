<script setup lang="ts">
/**
 * Reusable prompt field with optional preset buttons + textarea.
 * Used for direction, audio, and negative prompts across create tabs.
 */
export interface PromptPreset {
  label: string
  prompt: string
}

withDefaults(defineProps<{
  label: string
  description?: string
  placeholder?: string
  presets?: readonly PromptPreset[]
  disabled?: boolean
  rows?: number
}>(), {
  description: '',
  placeholder: '',
  presets: undefined,
  rows: 2,
})

const modelValue = defineModel<string>({ default: '' })
</script>

<template>
  <UFormField :label="label" :description="description" size="sm">
    <div v-if="presets?.length" class="flex flex-wrap gap-1.5 mb-2">
      <UButton
        v-for="p in presets" :key="p.label"
        size="xs"
        :variant="modelValue === p.prompt ? 'soft' : 'ghost'"
        :color="modelValue === p.prompt ? 'primary' : 'neutral'"
        :disabled="disabled"
        @click="modelValue = p.prompt"
      >{{ p.label }}</UButton>
    </div>
    <UTextarea
      v-model="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      autoresize
      :disabled="disabled"
      class="w-full"
      size="sm"
    />
  </UFormField>
</template>
