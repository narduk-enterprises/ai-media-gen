<script setup lang="ts">
export interface DurationPreset {
  label: string
  value: number
  description: string
}

const props = withDefaults(defineProps<{
  presets?: DurationPreset[]
  multiSelect?: boolean
}>(), {
  presets: () => [
    { label: '~1.7s', value: 41, description: 'Quick' },
    { label: '~3.4s', value: 81, description: 'Standard' },
    { label: '~5s', value: 121, description: 'Long' },
    { label: '~6.7s', value: 161, description: 'Extended' },
    { label: '~8.4s', value: 201, description: 'Maximum' },
  ],
  multiSelect: true,
})

const modelValue = defineModel<number[]>({ default: () => [81] })

function toggle(value: number) {
  if (props.multiSelect) {
    if (modelValue.value.includes(value)) {
      if (modelValue.value.length > 1) modelValue.value = modelValue.value.filter(v => v !== value)
    } else {
      modelValue.value = [...modelValue.value, value]
    }
  } else {
    modelValue.value = [value]
  }
}
</script>

<template>
  <section>
    <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 block">
      Duration
      <span v-if="multiSelect" class="text-slate-400 font-normal normal-case tracking-normal">(select one or more)</span>
    </label>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="preset in presets"
        :key="preset.value"
        class="py-2 px-1 rounded-lg text-center transition-all border"
        :class="modelValue.includes(preset.value)
          ? 'bg-cyan-50 border-cyan-300 text-cyan-700 ring-1 ring-cyan-200'
          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'"
        @click="toggle(preset.value)"
      >
        <span class="block text-xs font-semibold">{{ preset.label }}</span>
        <span class="block text-[9px] mt-0.5 opacity-60">{{ preset.description }}</span>
      </button>
    </div>
    <p class="text-[10px] text-slate-400 mt-1.5">{{ modelValue.length }} duration{{ modelValue.length !== 1 ? 's' : '' }} selected</p>
  </section>
</template>
