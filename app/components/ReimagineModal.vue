<script setup lang="ts">
const props = defineProps<{
  open: boolean
  target: { url: string; prompt: string; settings?: Record<string, any> | null } | null
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [payload: { image: string; prompt: string; cfg: number; steps: number; width: number; height: number; negativePrompt: string; denoise: number }]
}>()

const prompt = ref('')
const cfg = ref(3.5)
const steps = ref(20)
const error = ref('')

watch(() => props.target, (t) => {
  if (t) {
    prompt.value = t.prompt
    error.value = ''
  }
})

async function handleSubmit() {
  if (!props.target || !prompt.value.trim()) return
  error.value = ''

  try {
    const resp = await fetch(props.target.url)
    const blob = await resp.blob()
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).replace(/^data:image\/[^;]+;base64,/, ''))
      reader.readAsDataURL(blob)
    })

    const w = props.target.settings?.width || 1024
    const h = props.target.settings?.height || 1024

    emit('submit', {
      image: base64,
      prompt: prompt.value.trim(),
      cfg: cfg.value,
      steps: steps.value,
      width: w,
      height: h,
      negativePrompt: props.target.settings?.negativePrompt || '',
      denoise: 0.75,
    })
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Reimagine failed'
  }
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold">Reimagine Image</h3>
        <p class="text-xs text-slate-400">Generate a new image from this one with a different prompt.</p>

        <div v-if="target" class="flex gap-3">
          <img :src="target.url" class="w-24 h-24 rounded-lg object-cover border border-slate-200 shrink-0" />
          <UTextarea v-model="prompt" placeholder="Describe the new image..." :rows="3" autoresize class="flex-1" />
        </div>

        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <UFormField label="CFG" size="sm">
            <div class="flex items-center gap-2">
              <USlider v-model="cfg" :min="1" :max="15" :step="0.5" class="w-24" size="xs" />
              <span class="text-xs text-slate-600 font-mono w-6">{{ cfg }}</span>
            </div>
          </UFormField>
          <UFormField label="Steps" size="sm">
            <div class="flex items-center gap-2">
              <USlider v-model="steps" :min="4" :max="40" class="w-24" size="xs" />
              <span class="text-xs text-slate-600 font-mono w-5">{{ steps }}</span>
            </div>
          </UFormField>
        </div>

        <UAlert v-if="error" color="error" variant="subtle" :title="error" size="sm" />

        <div class="flex justify-end gap-2 pt-2">
          <UButton variant="outline" color="neutral" @click="emit('update:open', false)">Cancel</UButton>
          <UButton color="primary" :loading="loading" :disabled="!prompt.trim()" @click="handleSubmit">
            <UIcon name="i-lucide-sparkles" class="w-4 h-4" />
            Generate
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
