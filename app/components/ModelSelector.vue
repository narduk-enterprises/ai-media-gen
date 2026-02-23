<script setup lang="ts">
import type { ModelDef } from '~/composables/models'

const props = defineProps<{
  models: readonly ModelDef[]
  selected: string | string[]
  multi?: boolean
  color?: string
}>()

const emit = defineEmits<{
  'update:selected': [value: string | string[]]
}>()

const activeColor = computed(() => props.color ?? 'violet')

function isSelected(id: string) {
  return Array.isArray(props.selected) ? props.selected.includes(id) : props.selected === id
}

function toggle(id: string) {
  const model = props.models.find(m => m.id === id)
  if (model?.comingSoon) return
  if (props.multi && Array.isArray(props.selected)) {
    const idx = props.selected.indexOf(id)
    if (idx >= 0 && props.selected.length > 1) {
      emit('update:selected', props.selected.filter((_, i) => i !== idx))
    } else if (idx < 0) {
      emit('update:selected', [...props.selected, id])
    }
  } else {
    emit('update:selected', props.multi ? [id] : id)
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Model</h3>
      <UBadge v-if="multi && Array.isArray(selected) && selected.length > 1" size="xs" variant="subtle" color="info" class="gap-1">
        <UIcon name="i-lucide-columns-2" class="w-3 h-3" />Compare Mode
      </UBadge>
    </div>
    <div class="grid grid-cols-2 gap-3" :class="models.length > 2 ? 'lg:grid-cols-4' : ''">
      <button
        v-for="m in models" :key="m.id"
        class="flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all duration-150"
        :class="[
          isSelected(m.id)
            ? `border-${activeColor}-400 bg-${activeColor}-50/60 shadow-sm`
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
          m.comingSoon ? 'opacity-50 cursor-not-allowed' : '',
        ]"
        :disabled="m.comingSoon"
        @click="toggle(m.id)"
      >
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          :class="isSelected(m.id) ? `bg-${activeColor}-100 text-${activeColor}-600` : 'bg-slate-100 text-slate-400'"
        >
          <UIcon :name="m.icon" class="w-4 h-4" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold flex items-center gap-1.5" :class="isSelected(m.id) ? `text-${activeColor}-700` : 'text-slate-700'">
            {{ m.label }}
            <span v-if="m.comingSoon" class="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">Soon</span>
          </div>
          <div class="text-[11px]" :class="isSelected(m.id) ? `text-${activeColor}-500` : 'text-slate-400'">{{ m.description }}</div>
        </div>
        <!-- Checkbox for multi, radio for single -->
        <div v-if="multi" class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors" :class="isSelected(m.id) ? `border-${activeColor}-500 bg-${activeColor}-500` : 'border-slate-300'">
          <UIcon v-if="isSelected(m.id)" name="i-lucide-check" class="w-3 h-3 text-white" />
        </div>
        <div v-else class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0" :class="isSelected(m.id) ? `border-${activeColor}-500 bg-${activeColor}-500` : 'border-slate-300'">
          <div v-if="isSelected(m.id)" class="w-1.5 h-1.5 rounded-full bg-white" />
        </div>
      </button>
    </div>
  </div>
</template>
