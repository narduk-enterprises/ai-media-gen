/**
 * Shared state for the Create page — settings, model selection, form persistence.
 * Shared across all mode tabs.
 */

const DEFAULT_NEG = 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'

// ─── Model Definitions ──────────────────────────────────────────────────

export interface ModelDef {
  id: string
  label: string
  description: string
  icon: string
  defaultSteps: number
}

export interface ModelParams {
  steps: { min: number; max: number; default: number }
  cfg?: { min: number; max: number; default: number; step: number }
  lora?: { min: number; max: number; default: number; step: number }
  sizes: number[]
  defaultWidth: number
  defaultHeight: number
}

export const IMAGE_MODELS: readonly ModelDef[] = [
  { id: 'wan22', label: 'Wan 2.2', description: '14B dual-UNET, 20 steps', icon: 'i-lucide-brain', defaultSteps: 20 },
  { id: 'qwen_image', label: 'Qwen 2.5', description: 'VL 7B, 50 steps (4 with Lightning)', icon: 'i-lucide-sparkles', defaultSteps: 50 },
  { id: 'flux2_turbo', label: 'Flux 2 Turbo', description: 'Fast Mistral CLIP, 4 steps', icon: 'i-lucide-zap', defaultSteps: 4 },
  { id: 'flux2_dev', label: 'Flux 2 Dev', description: 'Full quality, 20 steps', icon: 'i-lucide-gem', defaultSteps: 20 },
] as const

export const VIDEO_MODELS: readonly ModelDef[] = [
  { id: 'wan22', label: 'Wan 2.2', description: '14B LightX2V, 4 steps', icon: 'i-lucide-brain', defaultSteps: 4 },
  { id: 'ltx2', label: 'LTX-2', description: '19B + upscaler, 20 steps', icon: 'i-lucide-film', defaultSteps: 20 },
] as const

// ─── Per-Model Parameter Ranges ──────────────────────────────────────────

export const IMAGE_MODEL_PARAMS: Record<string, ModelParams> = {
  wan22: {
    steps: { min: 1, max: 50, default: 20 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 768, 1024, 1536, 2048],
    defaultWidth: 1024, defaultHeight: 1024,
  },
  qwen_image: {
    steps: { min: 1, max: 50, default: 50 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 768, 1024, 1536],
    defaultWidth: 1024, defaultHeight: 1024,
  },
  flux2_turbo: {
    steps: { min: 1, max: 10, default: 4 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 768, 1024, 1536, 2048],
    defaultWidth: 1024, defaultHeight: 1024,
  },
  flux2_dev: {
    steps: { min: 1, max: 50, default: 20 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 768, 1024, 1536, 2048],
    defaultWidth: 1024, defaultHeight: 1024,
  },
}

export const VIDEO_MODEL_PARAMS: Record<string, {
  steps: { min: number; max: number; default: number }
  cfg?: { min: number; max: number; default: number; step: number }
  fps?: { min: number; max: number; default: number }
  lora?: { min: number; max: number; default: number; step: number }
  imageStrength?: { min: number; max: number; default: number; step: number }
  resolutions: { label: string; w: number; h: number }[]
  durations: { label: string; value: number; description: string }[]
}> = {
  wan22: {
    steps: { min: 1, max: 50, default: 4 },
    cfg: { min: 1, max: 15, default: 3.5, step: 0.5 },
    resolutions: [
      { label: '640 × 640', w: 640, h: 640 },
      { label: '512 × 512', w: 512, h: 512 },
      { label: '768 × 512', w: 768, h: 512 },
      { label: '512 × 768', w: 512, h: 768 },
      { label: '832 × 480', w: 832, h: 480 },
      { label: '480 × 832', w: 480, h: 832 },
    ],
    durations: [
      { label: '~1.7s', value: 41, description: 'Quick' },
      { label: '~3.4s', value: 81, description: 'Standard' },
      { label: '~5s', value: 121, description: 'Long' },
      { label: '~6.7s', value: 161, description: 'Extended' },
      { label: '~8.4s', value: 201, description: 'Maximum' },
    ],
  },
  ltx2: {
    steps: { min: 1, max: 50, default: 20 },
    cfg: { min: 1, max: 15, default: 3.5, step: 0.5 },
    fps: { min: 12, max: 60, default: 24 },
    lora: { min: 0, max: 2, default: 0.7, step: 0.05 },
    imageStrength: { min: 0, max: 1, default: 1.0, step: 0.05 },
    resolutions: [
      { label: '1280 × 720 → 2560×1440', w: 1280, h: 720 },
      { label: '1920 × 1088 → 3840×2176', w: 1920, h: 1088 },
      { label: '1024 × 576 → 2048×1152', w: 1024, h: 576 },
      { label: '768 × 432 → 1536×864', w: 768, h: 432 },
      { label: '720 × 1280 → 1440×2560 (Portrait)', w: 720, h: 1280 },
      { label: '576 × 1024 → 1152×2048 (Portrait)', w: 576, h: 1024 },
      { label: '768 × 768 → 1536×1536 (Square)', w: 768, h: 768 },
    ],
    durations: [
      { label: '~2.7s', value: 65, description: 'Quick' },
      { label: '~4s', value: 97, description: 'Standard (recommended)' },
      { label: '~5s', value: 121, description: 'Long' },
      { label: '~6.7s', value: 161, description: 'Extended' },
      { label: '~10s', value: 241, description: 'Extra Long' },
      { label: '~20s', value: 481, description: '20 seconds' },
      { label: '~30s', value: 721, description: 'Maximum' },
    ],
  },
}

export function useCreateShared() {
  // ─── Shared settings (useState for SSR → client hydration safety) ──
  const negativePrompt = useState('create-negativePrompt', () => DEFAULT_NEG)
  const showAdvanced = useState('create-showAdvanced', () => false)

  // ─── Form persistence ─────────────────────────────────────────
  const FORM_KEY = 'ai-media-gen:create-form'

  function persistForm(extra: Record<string, any> = {}) {
    if (import.meta.server) return
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({
        negativePrompt: negativePrompt.value,
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
      if (s.negativePrompt != null) negativePrompt.value = s.negativePrompt
      return s
    } catch { return {} }
  }

  function resetShared() {
    negativePrompt.value = DEFAULT_NEG
    showAdvanced.value = false
  }

  // ─── Helper: get model params ──────────────────────────────────
  function getImageModelParams(modelId: string): ModelParams {
    return IMAGE_MODEL_PARAMS[modelId] ?? IMAGE_MODEL_PARAMS.wan22!
  }

  function getVideoModelParams(modelId: string) {
    return VIDEO_MODEL_PARAMS[modelId] ?? VIDEO_MODEL_PARAMS.wan22!
  }

  return {
    // Settings
    negativePrompt,
    showAdvanced,
    DEFAULT_NEG,

    // Models
    IMAGE_MODELS,
    VIDEO_MODELS,
    IMAGE_MODEL_PARAMS,
    VIDEO_MODEL_PARAMS,

    // Helpers
    getImageModelParams,
    getVideoModelParams,

    // Persistence
    persistForm,
    restoreForm,
    resetShared,
  }
}
