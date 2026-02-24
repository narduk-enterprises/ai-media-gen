<script setup lang="ts">
import { FIDELITY_PRESETS } from '~/composables/useVideoDefaults'

const model = defineModel<number>({ required: true })
</script>

<template>
  <UFormField label="Image Fidelity" size="sm" description="How closely video matches source image">
    <div class="flex gap-1">
      <UButton
        v-for="f in FIDELITY_PRESETS" :key="f.value" size="xs"
        :variant="model === f.value ? 'soft' : 'ghost'"
        :color="model === f.value ? 'primary' : 'neutral'"
        @click="model = f.value"
      >{{ f.label }}</UButton>
    </div>
  </UFormField>
</template>
