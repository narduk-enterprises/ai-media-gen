<script setup lang="ts">
import { attributeKeys, attributeLabels, attributePresets, type AttributeKey } from '~/utils/promptBuilder'

const props = defineProps<{
  prompt: string
  attributes: Record<AttributeKey, string>
  count: number
  promptPreview: string
  disabled: boolean
}>()

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:attributes': [value: Record<AttributeKey, string>]
  'update:count': [value: number]
  randomizeAttr: [key: AttributeKey]
  randomizeAll: []
  clearAll: []
}>()

function updateAttr(key: AttributeKey, value: string) {
  emit('update:attributes', { ...props.attributes, [key]: value })
}
</script>

<template>
  <div class="space-y-6 pt-4">
    <PromptInput :model-value="prompt" @update:model-value="emit('update:prompt', $event)" :disabled="disabled" />

    <!-- Attributes -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Attributes</h2>
        <div class="flex gap-2">
          <UButton size="xs" variant="ghost" color="primary" icon="i-lucide-shuffle" @click="emit('randomizeAll')">Randomize All</UButton>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="emit('clearAll')">Clear</UButton>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div v-for="key in attributeKeys" :key="key" class="flex items-center gap-2">
          <label class="text-[11px] text-slate-500 font-medium w-20 shrink-0 flex items-center gap-1">
            <span>{{ attributeLabels[key].emoji }}</span>
            <span>{{ attributeLabels[key].label }}</span>
          </label>
          <UInput :model-value="attributes[key]" @update:model-value="updateAttr(key, $event as string)" :placeholder="attributePresets[key][0]" size="sm" class="flex-1" :disabled="disabled" />
          <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="emit('randomizeAttr', key)" />
        </div>
      </div>
    </section>

    <CountSelector :model-value="count" @update:model-value="emit('update:count', $event)" label="Images" :options="[1, 2, 4, 8]" />

    <!-- Preview -->
    <UCard v-if="promptPreview" variant="subtle">
      <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Composed prompt</div>
      <p class="text-xs text-slate-600 leading-relaxed">{{ promptPreview }}</p>
    </UCard>
  </div>
</template>
