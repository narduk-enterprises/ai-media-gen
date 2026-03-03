<script setup lang="ts">
export interface ResolutionPreset {
  label: string
  w: number
  h: number
}

withDefaults(defineProps<{
  presets?: ResolutionPreset[]
}>(), {
  presets: () => [
    { label: '640 × 640', w: 640, h: 640 },
    { label: '512 × 512', w: 512, h: 512 },
    { label: '768 × 512', w: 768, h: 512 },
    { label: '512 × 768', w: 512, h: 768 },
    { label: '832 × 480', w: 832, h: 480 },
    { label: '480 × 832', w: 480, h: 832 },
  ],
})

const modelValue = defineModel<number>({ default: 0 })
</script>

<template>
  <section>
    <label class="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 block">Resolution</label>
    <div class="grid grid-cols-3 gap-1.5">
      <button
        v-for="(preset, i) in presets" :key="i"
        class="py-1.5 px-2 rounded-lg text-[11px] font-medium text-center transition-all border"
        :class="modelValue === i
          ? 'bg-cyan-50 border-cyan-300 text-cyan-700 ring-1 ring-cyan-200'
          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'"
        @click="modelValue = i"
      >
        {{ preset.label }}
      </button>
    </div>
  </section>
</template>
