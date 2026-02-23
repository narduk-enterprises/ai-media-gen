<script setup lang="ts">
/**
 * ImageModelSettings — Data-driven settings card for image models.
 *
 * Renders knobs (Steps, CFG, Sampler, Scheduler, LoRA, Seed, Sizes, Denoise)
 * based on the model's ImageModelParams. Eliminates duplicate settings UI
 * across CreateTextToImageTab, CreateImageToImageTab, etc.
 */
import type { ImageModelParams } from '~/composables/models/types'

const props = defineProps<{
  params: ImageModelParams
  mode?: 't2i' | 'i2i'
  /** Hide negative prompt (some tabs manage it themselves) */
  hideNegativePrompt?: boolean
}>()

const steps = defineModel<number>('steps', { required: true })
const width = defineModel<number>('width', { required: true })
const height = defineModel<number>('height', { required: true })
const seed = defineModel<number>('seed', { required: true })
const cfg = defineModel<number | undefined>('cfg')
const loraStrength = defineModel<number | undefined>('loraStrength')
const sampler = defineModel<string | undefined>('sampler')
const scheduler = defineModel<string | undefined>('scheduler')
const denoise = defineModel<number | undefined>('denoise')
const negativePrompt = defineModel<string>('negativePrompt')
const customLoras = defineModel<Record<string, number>>('customLoras')

// ─── Computed items for selects ─────────────────────────────────────────
const sizeItems = computed(() => props.params.sizes.map(v => ({ label: `${v}`, value: v })))
const samplerItems = computed(() =>
  props.params.sampler?.options.map(v => ({ label: v.replace(/_/g, ' '), value: v })) || [],
)
const schedulerItems = computed(() =>
  props.params.scheduler?.options.map(v => ({
    label: v.charAt(0).toUpperCase() + v.slice(1),
    value: v,
  })) || [],
)
</script>

<template>
  <UCard variant="outline">
    <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
      <!-- Steps -->
      <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />

      <!-- CFG -->
      <SliderField
        v-if="params.cfg && cfg != null"
        v-model="cfg"
        label="CFG"
        :min="params.cfg.min"
        :max="params.cfg.max"
        :step="params.cfg.step || 0.5"
        :format="v => v?.toFixed(1) ?? ''"
      />

      <!-- Width / Height -->
      <UFormField label="Width" size="sm">
        <USelect v-model="width" :items="sizeItems" size="sm" class="w-24" />
      </UFormField>
      <UFormField label="Height" size="sm">
        <USelect v-model="height" :items="sizeItems" size="sm" class="w-24" />
      </UFormField>

      <!-- Sampler -->
      <UFormField v-if="samplerItems.length" label="Sampler" size="sm">
        <USelect v-model="sampler" :items="samplerItems" size="sm" class="w-36" />
      </UFormField>

      <!-- Scheduler -->
      <UFormField v-if="schedulerItems.length" label="Scheduler" size="sm">
        <USelect v-model="scheduler" :items="schedulerItems" size="sm" class="w-28" />
      </UFormField>

      <!-- LoRA -->
      <SliderField
        v-if="params.lora && loraStrength != null"
        v-model="loraStrength"
        label="LoRA"
        :min="params.lora.min"
        :max="params.lora.max"
        :step="params.lora.step"
        description="Speed LoRA strength"
        :format="v => v.toFixed(2)"
      />

      <!-- Denoise (I2I only) -->
      <SliderField
        v-if="mode === 'i2i' && params.denoise && denoise != null"
        v-model="denoise"
        label="Denoise"
        :min="params.denoise.min"
        :max="params.denoise.max"
        :step="params.denoise.step"
        description="How much to change"
        :format="v => v.toFixed(2)"
      />

      <!-- Custom LoRAs (e.g., Instareal, Detailz) -->
      <template v-if="params.customLoras?.length && customLoras">
        <SliderField
          v-for="cl in params.customLoras" :key="cl.id"
          :model-value="customLoras[cl.id] ?? cl.default"
          @update:model-value="customLoras = { ...customLoras, [cl.id]: $event }"
          :label="cl.label"
          :min="cl.min"
          :max="cl.max"
          :step="cl.step"
          :format="v => v.toFixed(2)"
        />
      </template>

      <!-- Seed -->
      <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
        <div class="flex items-center gap-2">
          <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
          <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" title="Random seed" />
        </div>
      </UFormField>
    </div>

    <!-- Negative prompt -->
    <div v-if="!hideNegativePrompt" class="mt-3 pt-3 border-t border-slate-100">
      <UInput v-model="negativePrompt" placeholder="Negative prompt (optional)" size="xs" icon="i-lucide-minus" class="w-full" />
    </div>
  </UCard>
</template>
