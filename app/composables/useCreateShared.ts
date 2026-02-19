/**
 * Shared state for the Create page — settings, model selection, form persistence.
 * Shared across all mode tabs.
 */
import type { AttributeKey } from '~/utils/promptBuilder'
import { createEmptyAttributes } from '~/utils/promptBuilder'

const DEFAULT_NEG = 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'

const IMAGE_MODELS = [
  { id: 'wan22', label: 'Wan 2.2', description: '14B dual-UNET, 20 steps', icon: 'i-lucide-brain', defaultSteps: 20 },
  { id: 'z_image_turbo', label: 'Z-Image Turbo', description: 'Ultra-fast, 6 steps', icon: 'i-lucide-zap', defaultSteps: 6 },
] as const

const t2vResolutionPresets = [
  { label: '640 × 640', w: 640, h: 640 },
  { label: '512 × 512', w: 512, h: 512 },
  { label: '768 × 512', w: 768, h: 512 },
  { label: '512 × 768', w: 512, h: 768 },
  { label: '832 × 480', w: 832, h: 480 },
  { label: '480 × 832', w: 480, h: 832 },
]

const durationPresets = [
  { label: '~1.7s', value: 41, description: 'Quick' },
  { label: '~3.4s', value: 81, description: 'Standard' },
  { label: '~5s', value: 121, description: 'Long' },
  { label: '~6.7s', value: 161, description: 'Extended' },
  { label: '~8.4s', value: 201, description: 'Maximum' },
]

const sizeItems = [512, 768, 1024, 1536, 2048].map(v => ({ label: `${v}`, value: v }))

export function useCreateShared() {
  // ─── Shared settings ──────────────────────────────────────────
  const steps = ref(20)
  const imageWidth = ref(1024)
  const imageHeight = ref(1024)
  const negativePrompt = ref(DEFAULT_NEG)
  const loraStrength = ref(1.0)
  const imageSeed = ref(-1)
  const showAdvanced = ref(false)

  // ─── Model selection ──────────────────────────────────────────
  const selectedModels = ref<string[]>(['wan22'])
  const compareMode = computed(() => selectedModels.value.length > 1)

  function toggleModel(id: string) {
    const idx = selectedModels.value.indexOf(id)
    if (idx >= 0 && selectedModels.value.length > 1) {
      selectedModels.value.splice(idx, 1)
    } else if (idx < 0) {
      selectedModels.value.push(id)
    }
    if (selectedModels.value.length === 1) {
      const m = IMAGE_MODELS.find(m => m.id === selectedModels.value[0])
      if (m) steps.value = m.defaultSteps
    }
  }

  // ─── Form persistence ─────────────────────────────────────────
  const FORM_KEY = 'ai-media-gen:create-form'

  function persistForm(extra: Record<string, any> = {}) {
    if (import.meta.server) return
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({
        steps: steps.value,
        imageWidth: imageWidth.value,
        imageHeight: imageHeight.value,
        negativePrompt: negativePrompt.value,
        loraStrength: loraStrength.value,
        selectedModels: selectedModels.value,
        imageSeed: imageSeed.value,
        ...extra,
      }))
    } catch {}
  }

  function restoreForm(): Record<string, any> {
    if (import.meta.server) return {}
    try {
      const raw = localStorage.getItem(FORM_KEY)
      if (!raw) return {}
      const s = JSON.parse(raw)
      if (s.steps != null) steps.value = s.steps
      if (s.imageWidth != null) imageWidth.value = s.imageWidth
      if (s.imageHeight != null) imageHeight.value = s.imageHeight
      if (s.negativePrompt != null) negativePrompt.value = s.negativePrompt
      if (s.loraStrength != null) loraStrength.value = s.loraStrength
      if (Array.isArray(s.selectedModels) && s.selectedModels.length > 0) selectedModels.value = s.selectedModels
      if (s.imageSeed != null) imageSeed.value = s.imageSeed
      return s
    } catch { return {} }
  }

  function resetShared() {
    steps.value = 20
    imageWidth.value = 1024
    imageHeight.value = 1024
    negativePrompt.value = DEFAULT_NEG
    showAdvanced.value = false
    loraStrength.value = 1.0
    selectedModels.value = ['wan22']
    imageSeed.value = -1
  }

  return {
    // Settings
    steps,
    imageWidth,
    imageHeight,
    negativePrompt,
    loraStrength,
    imageSeed,
    showAdvanced,
    sizeItems,
    DEFAULT_NEG,

    // Models
    IMAGE_MODELS,
    selectedModels,
    compareMode,
    toggleModel,

    // Video presets
    t2vResolutionPresets,
    durationPresets,

    // Persistence
    persistForm,
    restoreForm,
    resetShared,
  }
}
