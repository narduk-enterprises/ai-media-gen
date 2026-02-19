<script setup lang="ts">
defineProps<{
  i2iPrompt: string
  i2iImagePreview: string
  i2iCfg: number
  i2iSteps: number
  imageWidth: number
  imageHeight: number
}>()

const emit = defineEmits<{
  'update:i2iPrompt': [value: string]
  'update:i2iCfg': [value: number]
  'update:i2iSteps': [value: number]
  fileChange: [e: Event]
  drop: [e: DragEvent]
  clearImage: []
}>()

const i2iFileInput = ref<HTMLInputElement | null>(null)
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Image upload -->
    <section>
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Source Image</h2>
      <div
        v-if="!i2iImagePreview"
        class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50/30 transition-colors"
        @click="i2iFileInput?.click()"
        @dragover.prevent
        @drop="emit('drop', $event)"
      >
        <div class="text-slate-400 mb-2">
          <UIcon name="i-lucide-upload" class="w-8 h-8" />
        </div>
        <p class="text-sm text-slate-500">Drop an image here or click to browse</p>
        <p class="text-xs text-slate-400 mt-1">PNG, JPG, WebP</p>
      </div>
      <div v-else class="relative inline-block">
        <img :src="i2iImagePreview" class="max-h-64 rounded-xl border border-slate-200" />
        <UButton
          icon="i-lucide-x"
          color="error"
          variant="solid"
          size="xs"
          class="absolute top-2 right-2"
          @click="emit('clearImage')"
        />
      </div>
      <input
        ref="i2iFileInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="emit('fileChange', $event)"
      />
    </section>

    <!-- Prompt -->
    <PromptInput :model-value="i2iPrompt" @update:model-value="emit('update:i2iPrompt', $event)" label="New Prompt" placeholder="Describe the style or changes you want..." />

    <!-- Controls -->
    <div class="flex flex-wrap gap-x-6 gap-y-3">
      <UFormField label="CFG" size="sm" description="Higher = follow prompt more">
        <div class="flex items-center gap-2">
          <USlider :model-value="i2iCfg" @update:model-value="(v) => emit('update:i2iCfg', v ?? i2iCfg)" :min="1" :max="15" :step="0.5" class="w-28" size="xs" />
          <span class="text-xs text-slate-600 font-mono w-8 text-right">{{ i2iCfg }}</span>
        </div>
      </UFormField>
      <UFormField label="Steps" size="sm">
        <div class="flex items-center gap-2">
          <USlider :model-value="i2iSteps" @update:model-value="(v) => emit('update:i2iSteps', v ?? i2iSteps)" :min="4" :max="40" class="w-28" size="xs" />
          <span class="text-xs text-slate-600 font-mono w-5 text-right">{{ i2iSteps }}</span>
        </div>
      </UFormField>
    </div>
  </div>
</template>
