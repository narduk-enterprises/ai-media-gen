<script setup lang="ts">
export interface BatchItem {
  prompt: string
  negativePrompt?: string
  audioPrompt?: string
}

defineProps<{
  label?: string
  placeholder?: string
  /** When true, displays per-item negative/audio fields in the preview list */
  richMode?: boolean
}>()

const items = defineModel<BatchItem[]>('items', { default: () => [] })

const jsonInput = ref('')
const fileError = ref('')
const { remixPrompts: doRemixPrompts, remixLoading: remixing, remixProgress } = useRemix()

function parseBatchJson(raw: string): BatchItem[] | null {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const result: BatchItem[] = []
      for (const item of parsed) {
        if (typeof item === 'string' && item.trim()) {
          result.push({ prompt: item.trim() })
        } else if (typeof item === 'object' && item !== null) {
          const p = item.prompt ?? item.Positive ?? item.positive
          if (typeof p === 'string' && p.trim()) {
            result.push({
              prompt: p.trim(),
              negativePrompt: item.negativePrompt ?? item.negative_prompt ?? item.negative ?? undefined,
              audioPrompt: item.audioPrompt ?? item.audio_prompt ?? item.audio ?? undefined,
            })
          }
        }
      }
      return result.length > 0 ? result : null
    }
    return null
  } catch {
    return null
  }
}

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileError.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    const parsed = parseBatchJson(text)
    if (parsed) {
      items.value = parsed
      jsonInput.value = text
      fileError.value = ''
    } else {
      fileError.value = 'Invalid JSON. Expected an array of strings or objects with a "prompt" field.'
    }
  }
  reader.onerror = () => { fileError.value = 'Failed to read file' }
  reader.readAsText(file)
  input.value = ''
}

function handleParse() {
  const raw = jsonInput.value.trim()
  if (!raw) return
  fileError.value = ''
  const parsed = parseBatchJson(raw)
  if (parsed) {
    items.value = parsed
    fileError.value = ''
    jsonInput.value = ''
  } else {
    fileError.value = 'Invalid JSON. Expected an array of strings or objects with a "prompt" field.'
  }
}

function handlePaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain')?.trim()
  if (!text) return
  if (text.startsWith('[')) {
    const parsed = parseBatchJson(text)
    if (parsed) {
      nextTick(() => {
        items.value = parsed
        fileError.value = ''
      })
    }
  }
}

function removeItem(index: number) {
  items.value = items.value.filter((_, i) => i !== index)
}

function clearAll() {
  items.value = []
  jsonInput.value = ''
  fileError.value = ''
}

/**
 * Remix all prompts via the server-side LLM.
 */
async function remixAll() {
  if (items.value.length === 0) return
  try {
    const remixed = await doRemixPrompts(items.value.map(i => i.prompt))
    items.value = items.value.map((item, idx) => ({
      ...item,
      prompt: remixed[idx] ?? item.prompt,
    }))
  } catch (e: any) {
    fileError.value = `Remix failed: ${e.message}`
  }
}

/** Backward-compat: flat prompt list (for consumers that only need strings) */
const prompts = computed(() => items.value.map(i => i.prompt))
defineExpose({ prompts })
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">{{ label || 'Upload Prompts JSON' }}</h2>

    <div class="flex items-center gap-3">
      <label class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50/30 cursor-pointer transition-all">
        <UIcon name="i-lucide-upload" class="w-4 h-4 text-slate-400" />
        <span class="text-sm text-slate-600 font-medium">Choose JSON file</span>
        <input type="file" accept=".json,application/json" class="hidden" @change="handleFileUpload" />
      </label>
      <span class="text-xs text-slate-400">or paste below</span>
    </div>

    <UTextarea
      v-model="jsonInput"
      :placeholder="placeholder || 'Paste JSON array here...'"
      :rows="4"
      class="w-full font-mono max-h-40 overflow-y-auto"
      size="sm"
      @paste="handlePaste"
    />

    <div class="flex items-center gap-2">
      <UButton size="xs" variant="soft" icon="i-lucide-check" :disabled="!jsonInput.trim()" @click="handleParse">
        Parse JSON
      </UButton>
      <UButton
        v-if="items.length > 0"
        size="xs"
        variant="outline"
        color="primary"
        icon="i-lucide-sparkles"
        :loading="remixing"
        :disabled="remixing"
        @click="remixAll"
      >
        {{ remixing ? `Remixing ${remixProgress.current}/${remixProgress.total}` : `AI Remix All (${items.length})` }}
      </UButton>
      <UButton v-if="items.length > 0" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="clearAll">
        Clear All
      </UButton>
    </div>

    <UAlert
      v-if="fileError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="fileError"
      :close="true"
      @update:open="fileError = ''"
    />

    <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
      <p class="text-[10px] text-slate-500 leading-relaxed">
        Accepts an array of strings: <code class="bg-slate-200 px-1 rounded text-[10px]">["prompt 1", "prompt 2"]</code>
        <br />
        Or objects: <code class="bg-slate-200 px-1 rounded text-[10px]">[{"prompt": "...", "negativePrompt": "...", "audioPrompt": "..."}]</code>
      </p>
      <slot name="hint" />
    </div>

    <!-- Remix progress bar -->
    <div v-if="remixing" class="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div class="flex-1">
        <p class="text-xs text-violet-700">Remixing {{ remixProgress.current }} / {{ remixProgress.total }} prompts…</p>
        <div class="mt-1 h-1 bg-violet-200 rounded-full overflow-hidden">
          <div
            class="h-full bg-violet-500 rounded-full transition-all duration-300"
            :style="{ width: remixProgress.total ? `${(remixProgress.current / remixProgress.total) * 100}%` : '0%' }"
          />
        </div>
      </div>
    </div>

    <!-- Parsed items list -->
    <UCard v-if="items.length > 0" variant="subtle">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{{ items.length }} prompt{{ items.length !== 1 ? 's' : '' }}</span>
        <slot name="badges" />
      </div>
      <div class="space-y-1.5 max-h-64 overflow-y-auto">
        <div v-for="(item, i) in items" :key="i" class="flex items-start gap-2 group">
          <span class="text-[10px] text-slate-400 font-mono w-6 shrink-0 text-right pt-0.5">{{ i + 1 }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-600 leading-relaxed line-clamp-2">{{ item.prompt }}</p>
            <div v-if="richMode && (item.negativePrompt || item.audioPrompt)" class="flex flex-wrap gap-2 mt-0.5">
              <span v-if="item.negativePrompt" class="text-[10px] text-red-400 truncate max-w-[200px]">⛔ {{ item.negativePrompt }}</span>
              <span v-if="item.audioPrompt" class="text-[10px] text-amber-500 truncate max-w-[200px]">🔊 {{ item.audioPrompt }}</span>
            </div>
          </div>
          <button
            class="p-0.5 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
            @click="removeItem(i)"
          >
            <UIcon name="i-lucide-x" class="w-3 h-3" />
          </button>
        </div>
      </div>
    </UCard>
  </section>
</template>
