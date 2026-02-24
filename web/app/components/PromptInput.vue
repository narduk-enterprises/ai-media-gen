<script setup lang="ts">
defineProps<{
  label?: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  remix: []
}>()

const modelValue = defineModel<string>({ default: '' })

const { isSupported, loadProgress, loadingModel } = useWebLLM()
const remixing = ref(false)
const remixError = ref('')

async function handleRemix() {
  if (!modelValue.value.trim()) return
  remixing.value = true
  remixError.value = ''
  try {
    const { remixPrompt } = useWebLLM()
    modelValue.value = await remixPrompt(modelValue.value)
    emit('remix')
  } catch (e: any) {
    remixError.value = e?.message || 'Remix failed'
    console.error('[Remix] Error:', e)
  } finally {
    remixing.value = false
  }
}

/**
 * Auto-parse JSON pasted into the prompt box.
 * Extracts the 'prompt' field from JSON objects.
 */
function handlePaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')?.trim()
  if (!text) return

  // Only try to parse if it looks like JSON
  if (!(text.startsWith('{') || text.startsWith('['))) return

  try {
    const parsed = JSON.parse(text)

    // Single object with a prompt field
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const prompt = parsed.prompt || parsed.text || parsed.description || parsed.content
      if (prompt && typeof prompt === 'string') {
        e.preventDefault()
        modelValue.value = prompt
        return
      }
    }

    // Array of objects — join all prompts
    if (Array.isArray(parsed)) {
      const prompts = parsed
        .map(item => item?.prompt || item?.text || item?.description || item?.content)
        .filter((p): p is string => typeof p === 'string')
      if (prompts.length > 0) {
        e.preventDefault()
        modelValue.value = prompts.join('\n\n')
      }
    }
  } catch {
    // Not valid JSON — let it paste normally
  }
}

defineExpose({ remixing })
</script>

<template>
  <UFormField :label="label || 'Prompt'" size="lg">
    <div @paste="handlePaste">
      <UTextarea
        v-model="modelValue"
        :placeholder="placeholder || 'Describe what you want to generate...'"
        :rows="3"
        autoresize
        :disabled="disabled"
        class="w-full"
      />
    </div>
    <template #hint>
      <UButton
        v-if="isSupported"
        size="xs"
        :variant="remixing || loadingModel ? 'soft' : 'outline'"
        :color="remixing || loadingModel ? 'primary' : 'neutral'"
        icon="i-lucide-sparkles"
        :loading="remixing || loadingModel"
        :disabled="!modelValue.trim() || disabled"
        @click="handleRemix"
      >
        {{ loadingModel ? `AI (${loadProgress}%)` : 'AI Remix' }}
      </UButton>
      <slot name="actions" />
      <span v-if="remixError" class="text-xs text-red-500">{{ remixError }}</span>
    </template>
  </UFormField>
</template>
