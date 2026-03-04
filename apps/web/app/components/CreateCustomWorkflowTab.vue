<script setup lang="ts">
/**
 * CreateCustomWorkflowTab — Submit raw ComfyUI workflow JSON directly.
 *
 * Lets the user paste a full ComfyUI API-format workflow JSON,
 * optionally label it, choose image vs video output, and submit.
 */

const gen = useGeneration()

// ─── Local State ────────────────────────────────────────────────────────
const workflowJson = ref('')
const label = ref('Custom Workflow')
const expectVideo = ref(false)
const jsonError = ref('')

// ─── Validation ─────────────────────────────────────────────────────────
const parsedWorkflow = computed(() => {
  if (!workflowJson.value.trim()) return null
  try {
    const parsed = JSON.parse(workflowJson.value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
})

// Track validation errors separately (avoids side effects in computed)
watch(workflowJson, (val) => {
  if (!val.trim()) { jsonError.value = ''; return }
  try {
    const parsed = JSON.parse(val)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      jsonError.value = 'Must be a JSON object (not an array)'
    } else {
      jsonError.value = ''
    }
  } catch (e) {
    jsonError.value = (e as Error).message
  }
})

const nodeCount = computed(() => parsedWorkflow.value ? Object.keys(parsedWorkflow.value).length : 0)
const canGenerate = computed(() => parsedWorkflow.value !== null)
const totalCount = computed(() => canGenerate.value ? 1 : 0)

// ─── Generate ───────────────────────────────────────────────────────────
async function generate() {
  if (!parsedWorkflow.value) return

  const { effectiveEndpoint } = useAppSettings()

  gen.submitting.value = true
  gen.error.value = ''
  gen.results.value = []

  try {
    const result = await $fetch<{ items?: { id: string }[] }>('/api/generate/custom', {
      method: 'POST',
      body: {
        workflow: parsedWorkflow.value,
        label: label.value || 'Custom Workflow',
        expectVideo: expectVideo.value,
        endpoint: effectiveEndpoint.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })

    if (result.items?.length) {
      for (const item of result.items) {
        gen.results.value.push({ id: item.id, type: 'image', url: null, status: 'queued', parentId: null })
        const queue = useQueue()
        queue.submitAndTrack(item.id)
      }
    }
  } catch (e) {
    const err = e as { data?: { message?: string } }
    gen.error.value = err.data?.message || 'Custom workflow failed'
  } finally {
    gen.submitting.value = false
  }
}

// ─── Example placeholder ────────────────────────────────────────────────
function insertExample() {
  workflowJson.value = JSON.stringify({
    "10": {
      "inputs": { "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "default" },
      "class_type": "CLIPLoader"
    },
    "20": {
      "inputs": { "text": "A beautiful sunset over the ocean", "clip": ["10", 0] },
      "class_type": "CLIPTextEncode"
    }
  }, null, 2)
}

defineExpose({ generate, canGenerate, totalCount, isVideo: expectVideo })
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Label -->
    <UFormField label="Label" size="sm" description="A name for this generation (stored for reference)">
      <UInput v-model="label" placeholder="Custom Workflow" size="sm" class="max-w-xs" />
    </UFormField>

    <!-- Output type toggle -->
    <div class="flex items-center gap-3">
      <span class="text-sm text-slate-600">Output type:</span>
      <UButton size="xs" :variant="!expectVideo ? 'soft' : 'ghost'" :color="!expectVideo ? 'primary' : 'neutral'" @click="expectVideo = false">
        <UIcon name="i-lucide-image" class="w-3.5 h-3.5" /> Image
      </UButton>
      <UButton size="xs" :variant="expectVideo ? 'soft' : 'ghost'" :color="expectVideo ? 'primary' : 'neutral'" @click="expectVideo = true">
        <UIcon name="i-lucide-film" class="w-3.5 h-3.5" /> Video
      </UButton>
    </div>

    <!-- Workflow JSON -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <label class="text-xs font-semibold text-slate-500 uppercase tracking-wider">ComfyUI Workflow JSON</label>
        <UButton size="xs" variant="ghost" color="neutral" @click="insertExample">Insert Example</UButton>
      </div>
      <UTextarea
        v-model="workflowJson"
        placeholder='Paste your ComfyUI API-format workflow JSON here...

{
  "10": {
    "inputs": { ... },
    "class_type": "CLIPLoader"
  },
  ...
}'
        :rows="16"
        class="font-mono text-xs"
      />

      <!-- Validation feedback -->
      <div class="mt-2 flex items-center gap-2">
        <template v-if="jsonError">
          <UIcon name="i-lucide-circle-x" class="w-4 h-4 text-red-500" />
          <span class="text-xs text-red-500">{{ jsonError }}</span>
        </template>
        <template v-else-if="parsedWorkflow">
          <UIcon name="i-lucide-circle-check" class="w-4 h-4 text-green-500" />
          <span class="text-xs text-green-600">Valid JSON — {{ nodeCount }} nodes</span>
        </template>
        <template v-else>
          <span class="text-xs text-slate-400">Paste ComfyUI API-format JSON (not the visual graph format)</span>
        </template>
      </div>
    </div>
  </div>
</template>
