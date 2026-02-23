/**
 * Shared state for the Create page — settings, model selection, form persistence.
 * Shared across all mode tabs.
 *
 * Model definitions are sourced from the composable registry (./models/).
 */
import {
  IMAGE_MODELS, VIDEO_MODELS,
  IMAGE_MODEL_PARAMS, VIDEO_MODEL_PARAMS,
  getImageModelParams, getI2IModelParams, getVideoModelParams,
} from '~/composables/models'

import type {
  ModelDef, ImageModelParams, VideoModelParams,
} from '~/composables/models'

const DEFAULT_NEG = 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'

export type { ModelDef, ImageModelParams, VideoModelParams }

export {
  IMAGE_MODELS,
  VIDEO_MODELS,
  IMAGE_MODEL_PARAMS,
  VIDEO_MODEL_PARAMS,
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

  return {
    // Settings
    negativePrompt,
    showAdvanced,
    DEFAULT_NEG,

    // Models (re-exported from registry for backward compatibility)
    IMAGE_MODELS,
    VIDEO_MODELS,
    IMAGE_MODEL_PARAMS,
    VIDEO_MODEL_PARAMS,

    // Helpers
    getImageModelParams,
    getI2IModelParams,
    getVideoModelParams,

    // Persistence
    persistForm,
    restoreForm,
    resetShared,
  }
}
