<script setup lang="ts">
defineProps<{
  label?: string
  placeholder?: string
  disabled?: boolean
  mediaType?: 'image' | 'video' | 'any'
}>()

const emit = defineEmits<{
  remix: []
}>()

const modelValue = defineModel<string>({ default: '' })

const { remixPrompt, remixLoading } = useRemix()
const remixing = ref(false)
const remixError = ref('')
const generatingPrompt = ref(false)
const promptUnrefined = ref(false)

// Directed remix state
const directRemixOpen = ref(false)
const directInstruction = ref('')

async function handleRemix() {
  if (!modelValue.value.trim()) return
  remixing.value = true
  remixError.value = ''
  try {
    modelValue.value = await remixPrompt(modelValue.value)
    emit('remix')
  } catch (e: any) {
    remixError.value = e?.message || 'Remix failed'
    console.error('[Remix] Error:', e)
  } finally {
    remixing.value = false
  }
}

async function handleDirectedRemix() {
  if (!modelValue.value.trim() || !directInstruction.value.trim()) return
  remixing.value = true
  remixError.value = ''
  directRemixOpen.value = false
  try {
    modelValue.value = await remixPrompt(modelValue.value, directInstruction.value.trim())
    directInstruction.value = ''
    emit('remix')
  } catch (e: any) {
    remixError.value = e?.message || 'Directed remix failed'
    console.error('[DirectedRemix] Error:', e)
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

async function handleGeneratePrompt() {
  generatingPrompt.value = true
  remixError.value = ''
  promptUnrefined.value = false
  try {
    const result = await $fetch<any>('/api/prompt-builder/generate', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { mediaType: $props.mediaType || 'any' },
    })
    modelValue.value = result.refinedPrompt || result.rawPrompt || ''
    if (result.wasRefined === false) {
      promptUnrefined.value = true
    }
  } catch (e: any) {
    remixError.value = e?.data?.message || e?.message || 'Generate failed'
  } finally {
    generatingPrompt.value = false
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
        size="xs"
        :variant="generatingPrompt ? 'soft' : 'outline'"
        :color="generatingPrompt ? 'primary' : 'neutral'"
        icon="i-lucide-wand"
        :loading="generatingPrompt"
        :disabled="disabled"
        @click="handleGeneratePrompt"
      >
        Generate
      </UButton>
      <UButton
        size="xs"
        :variant="remixing ? 'soft' : 'outline'"
        :color="remixing ? 'primary' : 'neutral'"
        icon="i-lucide-sparkles"
        :loading="remixing"
        :disabled="!modelValue.trim() || disabled"
        @click="handleRemix"
      >
        AI Remix
      </UButton>
      <UPopover v-model:open="directRemixOpen">
        <UButton
          size="xs"
          variant="outline"
          color="neutral"
          icon="i-lucide-pencil"
          :loading="remixing"
          :disabled="!modelValue.trim() || disabled"
        >
          Direct
        </UButton>
        <template #content>
          <div class="p-3 w-72 space-y-2">
            <p class="text-xs text-slate-500 font-medium">How should the prompt change?</p>
            <UInput
              v-model="directInstruction"
              placeholder="e.g. make it nighttime, add rain..."
              size="sm"
              autofocus
              @keydown.enter="handleDirectedRemix"
            />
            <UButton
              size="xs"
              color="primary"
              block
              :disabled="!directInstruction.trim()"
              @click="handleDirectedRemix"
            >
              Apply Change
            </UButton>
          </div>
        </template>
      </UPopover>
      <slot name="actions" />
      <span v-if="promptUnrefined" class="text-xs text-amber-500">⚠ Prompt not AI-enhanced (GPU pod offline)</span>
      <span v-if="remixError" class="text-xs text-red-500">{{ remixError }}</span>
    </template>
  </UFormField>
</template>
