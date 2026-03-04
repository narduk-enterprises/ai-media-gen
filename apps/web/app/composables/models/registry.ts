/**
 * Model Registry — central lookup for all model configurations.
 *
 * Provides typed arrays and lookup functions consumed by:
 * - useCreateShared (composable layer)
 * - Create*Tab components (UI layer)
 * - Server API validation (Zod schema enums)
 */
import type { ModelDef, ImageModelParams, VideoModelParams, ImageModelConfig, VideoModelConfig } from './types'
import { wan22Image, wan22Video } from './wan22'
import { qwenImage, qwenLora } from './qwen'
import { flux2Turbo, flux2Dev } from './flux2'
import { ltx2Video } from './ltx2'
import { zImageBase, zImageTurbo } from './zimage'
import { juggernautXL } from './juggernaut'
import { cyberRealisticPony } from './cyberrealistic'
import { epicRealism } from './epicrealism'
import { hyperBeast } from './hyperbeast'
import { nsfwSdxl } from './nsfw_sdxl'
import { pornCraft } from './porn_craft'

// ─── Image Model Registry ───────────────────────────────────────────────────

const IMAGE_CONFIGS: ImageModelConfig[] = [
  wan22Image,
  qwenImage,
  qwenLora,
  flux2Turbo,
  flux2Dev,
  zImageBase,
  zImageTurbo,
  juggernautXL,
  cyberRealisticPony,
  epicRealism,
  hyperBeast,
  nsfwSdxl,
  pornCraft,
]

/** All image model definitions (for ModelSelector) */
export const IMAGE_MODELS: readonly ModelDef[] = IMAGE_CONFIGS.map(c => c.def)

/** Image model params keyed by model ID */
export const IMAGE_MODEL_PARAMS: Record<string, ImageModelParams> = Object.fromEntries(
  IMAGE_CONFIGS.map(c => [c.def.id, c.params]),
)

/** I2I-specific param overrides keyed by model ID */
export const IMAGE_I2I_OVERRIDES: Record<string, Partial<ImageModelParams>> = Object.fromEntries(
  IMAGE_CONFIGS.filter(c => c.i2iParams).map(c => [c.def.id, c.i2iParams!]),
)

/** All valid image model IDs (for server-side Zod validation) */
export const ALL_IMAGE_MODEL_IDS = IMAGE_CONFIGS.map(c => c.def.id) as [string, ...string[]]

/** Models that support I2I */
export const I2I_MODEL_IDS = IMAGE_CONFIGS
  .filter(c => c.def.capabilities.includes('i2i'))
  .map(c => c.def.id) as [string, ...string[]]

// ─── Video Model Registry ───────────────────────────────────────────────────

const VIDEO_CONFIGS: VideoModelConfig[] = [
  wan22Video,
  ltx2Video,
]

/** All video model definitions (for ModelSelector) */
export const VIDEO_MODELS: readonly ModelDef[] = VIDEO_CONFIGS.map(c => c.def)

/** Video model params keyed by model ID */
export const VIDEO_MODEL_PARAMS: Record<string, VideoModelParams> = Object.fromEntries(
  VIDEO_CONFIGS.map(c => [c.def.id, c.params]),
)

/** All valid video model IDs (for server-side Zod validation) */
export const ALL_VIDEO_MODEL_IDS = VIDEO_CONFIGS.map(c => c.def.id) as [string, ...string[]]

// ─── Lookup Helpers ─────────────────────────────────────────────────────────

// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getImageModelParams(modelId: string): ImageModelParams {
  return IMAGE_MODEL_PARAMS[modelId] ?? IMAGE_MODEL_PARAMS.wan22!
}

/** Get image params merged with I2I overrides (denoise, cfg tweaks, etc.) */
// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getI2IModelParams(modelId: string): ImageModelParams {
  const base = getImageModelParams(modelId)
  const overrides = IMAGE_I2I_OVERRIDES[modelId]
  if (!overrides) return base
  return { ...base, ...overrides }
}

// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getVideoModelParams(modelId: string): VideoModelParams {
  return VIDEO_MODEL_PARAMS[modelId] ?? VIDEO_MODEL_PARAMS.wan22!
}

// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getImageModel(modelId: string): ModelDef | undefined {
  return IMAGE_MODELS.find(m => m.id === modelId)
}

// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getVideoModel(modelId: string): ModelDef | undefined {
  return VIDEO_MODELS.find(m => m.id === modelId)
}

/** Get the full image config including I2I overrides */
// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getImageConfig(modelId: string): ImageModelConfig | undefined {
  return IMAGE_CONFIGS.find(c => c.def.id === modelId)
}

/** Get the full video config */
// eslint-disable-next-line vue-official/require-use-prefix-for-composables
export function getVideoConfig(modelId: string): VideoModelConfig | undefined {
  return VIDEO_CONFIGS.find(c => c.def.id === modelId)
}
