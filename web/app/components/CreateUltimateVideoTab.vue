<script setup lang="ts">
import { VIDEO_MODELS } from '~/composables/useCreateShared'
import { DIRECTION_PRESETS, AUDIO_PRESETS, DEFAULT_NEGATIVE_PROMPT, randomAudioPrompt } from '~/composables/useVideoDefaults'

const props = defineProps<{ prefillMediaId?: string | null }>()
const gen = useGeneration()
const shared = useCreateShared()
const { effectiveEndpoint } = useAppSettings()

// ─── Source Image ────────────────────────────────────────────
const selectedMediaId = ref<string | null>(null)
const uploadedBase64 = ref('')

watch(() => props.prefillMediaId, (id) => {
  if (id) selectedMediaId.value = id
}, { immediate: true })

function onImageSelect(payload: { mediaItemId?: string; base64?: string; url: string }) {
  selectedMediaId.value = payload.mediaItemId || null
  uploadedBase64.value = payload.base64 || ''
}
function onImageClear() {
  selectedMediaId.value = null
  uploadedBase64.value = ''
}

// ─── Prompts ─────────────────────────────────────────────────
const prompt = ref('')
const audioPrompt = ref('')
const negativePrompt = ref(DEFAULT_NEGATIVE_PROMPT)
const remixLoading = ref(false)
const remixVariations = ref<string[]>([])

onMounted(() => { audioPrompt.value = randomAudioPrompt() })

// ─── Remix (Qwen2.5) ────────────────────────────────────────
async function remixPrompt() {
  if (!prompt.value.trim() || remixLoading.value) return
  remixLoading.value = true
  remixVariations.value = []
  try {
    const res = await $fetch<{ prompts: string[]; elapsed: number }>('/api/generate/remix', {
      method: 'POST',
      body: {
        prompt: prompt.value.trim(),
        count: 4,
        temperature: 0.9,
        endpoint: effectiveEndpoint.value,
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    remixVariations.value = res.prompts || []
  } catch (e: any) {
    gen.error.value = e.data?.message || 'Remix failed'
  } finally {
    remixLoading.value = false
  }
}

function useVariation(text: string) {
  prompt.value = text
  remixVariations.value = []
}

// ─── Video Settings ──────────────────────────────────────────
const selectedModel = ref('wan22')
const steps = ref(20)
const cfg = ref(3.5)
const numFrames = ref(241) // ~15s @ 16fps for Wan
const width = ref(832)
const height = ref(480)
const fps = ref(16)
const seed = ref(-1)
const loraStrength = ref(1.0)
const imageStrength = ref(1.0)
const count = ref(1)

const isLtx2 = computed(() => selectedModel.value === 'ltx2')
const params = computed(() => shared.getVideoModelParams(selectedModel.value))
const hasImage = computed(() => !!selectedMediaId.value || !!uploadedBase64.value)

const DURATION_PRESETS = [
  { label: '~5s', value: 81, desc: 'Quick clip' },
  { label: '~8s', value: 129, desc: 'Short' },
  { label: '~10s', value: 161, desc: 'Medium' },
  { label: '~15s', value: 241, desc: '★ Sweet spot' },
  { label: '~22s', value: 361, desc: 'Long' },
  { label: '~30s', value: 481, desc: 'Extended' },
]

watch(selectedModel, (id) => {
  const p = shared.getVideoModelParams(id)
  steps.value = p.steps.default
  if (p.cfg) cfg.value = p.cfg.default
  if (p.fps) fps.value = p.fps.default
  if (p.lora) loraStrength.value = p.lora.default
  if (p.imageStrength) imageStrength.value = p.imageStrength.default
  // Keep duration
})

// ─── Generate ────────────────────────────────────────────────
const canGenerate = computed(() => hasImage.value && !gen.generating.value)
const totalCount = computed(() => canGenerate.value ? count.value : 0)

async function generate() {
  if (!canGenerate.value) return
  for (let i = 0; i < count.value; i++) {
    if (selectedMediaId.value) {
      await gen.makeVideo(selectedMediaId.value, {
        model: selectedModel.value,
        prompt: prompt.value.trim() || undefined,
        negativePrompt: negativePrompt.value.trim() || undefined,
        numFrames: numFrames.value,
        steps: steps.value,
        cfg: cfg.value,
        width: width.value, height: height.value,
        fps: fps.value,
        loraStrength: loraStrength.value,
        imageStrength: imageStrength.value,
        audioPrompt: audioPrompt.value.trim() || undefined,
      })
    } else {
      // Direct upload path
      const body: Record<string, any> = {
        image: uploadedBase64.value,
        model: selectedModel.value,
        prompt: prompt.value.trim() || undefined,
        negativePrompt: negativePrompt.value.trim() || undefined,
        numFrames: numFrames.value, steps: steps.value, cfg: cfg.value,
        width: width.value, height: height.value,
        fps: fps.value, seed: seed.value,
        loraStrength: loraStrength.value, imageStrength: imageStrength.value,
        audioPrompt: audioPrompt.value.trim() || undefined,
        endpoint: effectiveEndpoint.value,
      }
      try {
        gen.submitting.value = true
        const result = await $fetch<{ item: { id: string; type: string; url: string | null; status: string; parentId: string | null } }>('/api/generate/video-from-image', {
          method: 'POST', body,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        if (result.item) {
          gen.results.value.push(result.item)
          const queue = useQueue()
          queue.submitAndTrack(result.item.id)
        }
      } catch (e: any) {
        gen.error.value = e.data?.message || 'Video generation failed'
      } finally {
        gen.submitting.value = false
      }
    }
  }
}

// ─── Persistence ─────────────────────────────────────────────
onMounted(() => {
  const s = shared.restoreForm()
  if (s.ult_prompt != null) prompt.value = s.ult_prompt
  if (s.ult_audio != null) audioPrompt.value = s.ult_audio
  if (s.ult_neg != null) negativePrompt.value = s.ult_neg
  if (s.ult_model != null) selectedModel.value = s.ult_model
  if (s.ult_steps != null) steps.value = s.ult_steps
  if (s.ult_frames != null) numFrames.value = s.ult_frames
  if (s.ult_count != null) count.value = s.ult_count
  if (s.ult_seed != null) seed.value = s.ult_seed
})
watch([prompt, audioPrompt, negativePrompt, selectedModel, steps, numFrames, count, seed], () => {
  shared.persistForm({
    ult_prompt: prompt.value, ult_audio: audioPrompt.value, ult_neg: negativePrompt.value,
    ult_model: selectedModel.value, ult_steps: steps.value, ult_frames: numFrames.value,
    ult_count: count.value, ult_seed: seed.value,
  })
}, { deep: true })

defineExpose({ generate, canGenerate, totalCount, isVideo: true })
</script>

<template>
  <div class="space-y-5 pt-4">
    <!-- ═══ 1. Pick your image ═══ -->
    <ImagePicker label="Pick an image to animate" @select="onImageSelect" @clear="onImageClear" />

    <!-- ═══ 2. Video Motion Prompt ═══ -->
    <UCard variant="outline">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">Motion Prompt</h3>
            <p class="text-[10px] text-slate-400">Describe what happens in the video — leave blank for auto-caption</p>
          </div>
          <UButton
            size="xs" variant="soft" color="warning" icon="i-lucide-sparkles"
            :loading="remixLoading" :disabled="!prompt.trim()"
            @click="remixPrompt"
          >✨ Remix</UButton>
        </div>

        <!-- Direction preset chips -->
        <div class="flex flex-wrap gap-1">
          <UButton v-for="p in DIRECTION_PRESETS" :key="p.label" size="xs"
            :variant="prompt === p.prompt ? 'soft' : 'ghost'"
            :color="prompt === p.prompt ? 'primary' : 'neutral'"
            @click="prompt = prompt === p.prompt ? '' : p.prompt"
          >{{ p.label }}</UButton>
        </div>

        <UTextarea v-model="prompt" placeholder="she turns to camera and smiles, wind blowing through her hair, slow motion, cinematic..." :rows="3" autoresize class="w-full" size="sm" />

        <!-- Remix variations -->
        <div v-if="remixVariations.length > 0" class="space-y-1.5">
          <p class="text-[10px] text-amber-600 font-semibold uppercase tracking-wider">✨ Variations (click to use)</p>
          <div class="grid gap-1.5">
            <button
              v-for="(v, i) in remixVariations" :key="i"
              class="text-left text-xs p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-100 hover:border-amber-300 transition-colors text-slate-700 leading-relaxed"
              @click="useVariation(v)"
            >{{ v }}</button>
          </div>
        </div>
      </div>
    </UCard>

    <!-- ═══ 3. Audio / Sound ═══ -->
    <UCard variant="outline">
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider">🔊 Sound & Atmosphere</h3>
        <div class="flex flex-wrap gap-1">
          <UButton v-for="p in AUDIO_PRESETS" :key="p.label" size="xs"
            :variant="audioPrompt === p.prompt ? 'soft' : 'ghost'"
            :color="audioPrompt === p.prompt ? 'secondary' : 'neutral'"
            @click="audioPrompt = audioPrompt === p.prompt ? '' : p.prompt"
          >{{ p.label }}</UButton>
        </div>
        <UTextarea v-model="audioPrompt" placeholder="sensual electronic beat, soft breathing, wind..." :rows="2" autoresize class="w-full" size="sm" />
      </div>
    </UCard>

    <!-- ═══ 4. Duration & Model ═══ -->
    <UCard variant="outline">
      <div class="space-y-4">
        <!-- Duration (featured) -->
        <div>
          <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Duration</h3>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="d in DURATION_PRESETS" :key="d.value"
              class="px-3 py-2 rounded-lg border text-sm transition-all"
              :class="numFrames === d.value
                ? 'border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-300 font-semibold'
                : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'"
              @click="numFrames = d.value"
            >
              <span class="block font-medium">{{ d.label }}</span>
              <span class="block text-[10px] opacity-60">{{ d.desc }}</span>
            </button>
          </div>
        </div>

        <!-- Model -->
        <ModelSelector :models="VIDEO_MODELS" :selected="selectedModel" color="info" @update:selected="selectedModel = $event as string" />

        <!-- Negative prompt -->
        <UFormField label="Negative prompt" size="sm">
          <UTextarea v-model="negativePrompt" placeholder="blurry, low quality, watermark..." :rows="1" autoresize class="w-full" size="sm" />
        </UFormField>

        <!-- Fine-tuning row -->
        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <SliderField v-model="steps" label="Steps" :min="params.steps.min" :max="params.steps.max" />
          <SliderField v-if="params.cfg" v-model="cfg" label="CFG" :min="params.cfg.min" :max="params.cfg.max" :step="params.cfg.step" />
          <SliderField v-if="params.fps" v-model="fps" label="FPS" :min="params.fps.min" :max="params.fps.max" />
          <SliderField v-if="params.lora" v-model="loraStrength" label="LoRA" :min="params.lora.min" :max="params.lora.max" :step="params.lora.step" />
          <FidelitySelector v-if="params.imageStrength" v-model="imageStrength" />

          <CountSelector v-model="count" label="Variations" :options="[1, 2, 4]" />

          <UFormField label="Seed" size="sm" :description="seed < 0 ? 'Random' : 'Fixed'">
            <div class="flex items-center gap-2">
              <UInput v-model.number="seed" type="number" size="sm" class="w-28" />
              <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-shuffle" square @click="seed = -1" />
            </div>
          </UFormField>
        </div>
      </div>
    </UCard>

    <!-- ═══ Summary ═══ -->
    <UCard v-if="canGenerate" variant="subtle" class="bg-gradient-to-r from-violet-50 to-fuchsia-50 border-violet-200">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-[10px] text-violet-500 uppercase tracking-wider font-semibold mb-0.5">Ready to generate</div>
          <p class="text-xs text-violet-700">
            {{ count }} × {{ DURATION_PRESETS.find(d => d.value === numFrames)?.label || numFrames + 'f' }} video{{ count > 1 ? 's' : '' }}
            · {{ selectedModel === 'ltx2' ? 'LTX-2' : 'Wan 2.2 I2V' }}
            · {{ steps }} steps
            <template v-if="audioPrompt"> · 🔊 audio</template>
          </p>
        </div>
        <UIcon name="i-lucide-rocket" class="w-5 h-5 text-violet-400" />
      </div>
    </UCard>

    <!-- Progress -->
    <div v-if="gen.generating.value" class="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
      <div class="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
      <div class="text-xs text-violet-700">Generating video… this takes a few minutes for longer clips</div>
    </div>
  </div>
</template>
