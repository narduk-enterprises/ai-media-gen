<script setup lang="ts">
import { RESOLUTION_PRESETS } from '~/composables/useVideoDefaults'

const width = defineModel<number>('width', { required: true })
const height = defineModel<number>('height', { required: true })
</script>

<template>
  <UFormField label="Resolution" size="sm">
    <div class="flex flex-wrap gap-1">
      <UButton
        v-for="r in RESOLUTION_PRESETS" :key="r.label" size="xs"
        :variant="width === r.w && height === r.h ? 'soft' : 'ghost'"
        :color="width === r.w && height === r.h ? 'primary' : 'neutral'"
        @click="width = r.w; height = r.h"
      >{{ r.label }} <span class="text-[9px] opacity-60 ml-0.5">{{ r.tag }}</span></UButton>
    </div>
  </UFormField>
</template>
