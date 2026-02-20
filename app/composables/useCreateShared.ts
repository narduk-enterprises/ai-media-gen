/**
 * Shared state for the Create page — settings, model selection, form persistence.
 * Shared across all mode tabs.
 */
import type { AttributeKey } from '~/utils/promptBuilder'
import { createEmptyAttributes } from '~/utils/promptBuilder'

const DEFAULT_NEG = 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'

const IMAGE_MODELS = [
  { id: 'wan22', label: 'Wan 2.2', description: '14B dual-UNET, 20 steps', icon: 'i-lucide-brain', defaultSteps: 20 },
  { id: 'qwen_image', label: 'Qwen 2.5', description: 'VL 7B, 50 steps (4 with Lightning)', icon: 'i-lucide-sparkles', defaultSteps: 50 },
  { id: 'flux2_turbo', label: 'Flux 2 Turbo', description: 'Fast Mistral CLIP, 4 steps', icon: 'i-lucide-zap', defaultSteps: 4 },
  { id: 'flux2_dev', label: 'Flux 2 Dev', description: 'Full quality, 20 steps', icon: 'i-lucide-gem', defaultSteps: 20 },
] as const

const VIDEO_MODELS = [
  { id: 'wan22', label: 'Wan 2.2', description: '14B LightX2V, 4 steps', icon: 'i-lucide-brain', defaultSteps: 4 },
  { id: 'ltx2', label: 'LTX-2', description: '19B + upscaler, 20 steps', icon: 'i-lucide-film', defaultSteps: 20 },
] as const

const t2vResolutionPresets: Record<string, { label: string; w: number; h: number }[]> = {
  wan22: [
    { label: '640 × 640', w: 640, h: 640 },
    { label: '512 × 512', w: 512, h: 512 },
    { label: '768 × 512', w: 768, h: 512 },
    { label: '512 × 768', w: 512, h: 768 },
    { label: '832 × 480', w: 832, h: 480 },
    { label: '480 × 832', w: 480, h: 832 },
  ],
  ltx2: [
    { label: '1280 × 720 → 2560×1440', w: 1280, h: 720 },
    { label: '1920 × 1088 → 3840×2176', w: 1920, h: 1088 },
    { label: '1024 × 576 → 2048×1152', w: 1024, h: 576 },
    { label: '768 × 432 → 1536×864', w: 768, h: 432 },
    { label: '720 × 1280 → 1440×2560 (Portrait)', w: 720, h: 1280 },
    { label: '576 × 1024 → 1152×2048 (Portrait)', w: 576, h: 1024 },
    { label: '768 × 768 → 1536×1536 (Square)', w: 768, h: 768 },
  ],
}

// Wan 2.2: any frame count works. LTX-2: must be 8n+1 (65, 97, 121, 161, 201, 257)
const durationPresets: Record<string, { label: string; value: number; description: string }[]> = {
  wan22: [
    { label: '~1.7s', value: 41, description: 'Quick' },
    { label: '~3.4s', value: 81, description: 'Standard' },
    { label: '~5s', value: 121, description: 'Long' },
    { label: '~6.7s', value: 161, description: 'Extended' },
    { label: '~8.4s', value: 201, description: 'Maximum' },
  ],
  ltx2: [
    { label: '~2.7s', value: 65, description: 'Quick' },
    { label: '~4s', value: 97, description: 'Standard (recommended)' },
    { label: '~5s', value: 121, description: 'Long' },
    { label: '~6.7s', value: 161, description: 'Extended' },
    { label: '~10s', value: 241, description: 'Extra Long' },
    { label: '~20s', value: 481, description: '20 seconds' },
    { label: '~30s', value: 721, description: 'Maximum' },
  ],
}

const sizeItems = [512, 768, 1024, 1536, 2048].map(v => ({ label: `${v}`, value: v }))

export function useCreateShared() {
  // ─── Shared settings (useState for SSR → client hydration safety) ──
  const steps = useState('create-steps', () => 20)
  const imageWidth = useState('create-imageWidth', () => 1024)
  const imageHeight = useState('create-imageHeight', () => 1024)
  const negativePrompt = useState('create-negativePrompt', () => DEFAULT_NEG)
  const loraStrength = useState('create-loraStrength', () => 1.0)
  const imageSeed = useState('create-imageSeed', () => -1)
  const showAdvanced = useState('create-showAdvanced', () => false)

  // ─── Model selection ──────────────────────────────────────────
  const selectedModels = useState<string[]>('create-selectedModels', () => ['wan22'])
  const selectedVideoModel = useState('create-selectedVideoModel', () => 'wan22')
  const compareMode = computed(() => selectedModels.value.length > 1)

  function toggleModel(id: string) {
    const idx = selectedModels.value.indexOf(id)
    if (idx >= 0 && selectedModels.value.length > 1) {
      selectedModels.value = selectedModels.value.filter((_, i) => i !== idx)
    } else if (idx < 0) {
      selectedModels.value = [...selectedModels.value, id]
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
        selectedVideoModel: selectedVideoModel.value,
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
      if (s.selectedVideoModel) selectedVideoModel.value = s.selectedVideoModel
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
    selectedVideoModel.value = 'wan22'
    imageSeed.value = -1
  }

  // ─── Model-aware video presets ──────────────────────────────
  const activeVideoResolutionPresets = computed(() =>
    t2vResolutionPresets[selectedVideoModel.value] ?? t2vResolutionPresets.wan22!
  )
  const activeVideoDurationPresets = computed(() =>
    durationPresets[selectedVideoModel.value] ?? durationPresets.wan22!
  )
  const activeVideoDefaultSteps = computed(() => {
    const m = VIDEO_MODELS.find(m => m.id === selectedVideoModel.value)
    return m?.defaultSteps ?? 4
  })

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
    VIDEO_MODELS,
    selectedModels,
    selectedVideoModel,
    compareMode,
    toggleModel,

    // Video presets (model-aware)
    t2vResolutionPresets: activeVideoResolutionPresets,
    durationPresets: activeVideoDurationPresets,
    activeVideoDefaultSteps,

    // Persistence
    persistForm,
    restoreForm,
    resetShared,
  }
}
