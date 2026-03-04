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

/**
 * targetMachine values:
 *   - 'auto'       → default routing (prefers image-only pods for image jobs)
 *   - 'any'        → skip image-only preference, pick least loaded pod
 *   - 'https://...' → pin to a specific pod URL
 */
export type TargetMachine = 'auto' | 'any' | string

export function useCreateShared() {
  // ─── Shared settings (useState for SSR → client hydration safety) ──
  const negativePrompt = useState('create-negativePrompt', () => DEFAULT_NEG)
  const showAdvanced = useState('create-showAdvanced', () => false)
  const targetMachine = useState<TargetMachine>('create-targetMachine', () => 'auto')

  // ─── Form persistence ─────────────────────────────────────────
  const FORM_KEY = 'ai-media-gen:create-form'

  function persistForm(extra: Record<string, unknown> = {}) {
    if (import.meta.server) return
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({
        negativePrompt: negativePrompt.value,
        targetMachine: targetMachine.value,
        ...extra,
      }))
    } catch { }
  }

  function restoreForm(): Record<string, unknown> {
    if (import.meta.server) return {}
    try {
      const raw = localStorage.getItem(FORM_KEY)
      if (!raw) return {}
      const s = JSON.parse(raw) as Record<string, unknown>
      if (s.negativePrompt != null) negativePrompt.value = String(s.negativePrompt)
      if (s.targetMachine != null) targetMachine.value = s.targetMachine as TargetMachine
      // Backward compat: old anyMachine boolean
      else if (s.anyMachine === true) targetMachine.value = 'any'
      return s
    } catch { return {} }
  }

  function resetShared() {
    negativePrompt.value = DEFAULT_NEG
    showAdvanced.value = false
    targetMachine.value = 'auto'
  }

  return {
    // Settings
    negativePrompt,
    showAdvanced,
    targetMachine,
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
