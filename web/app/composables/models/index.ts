/**
 * Barrel export — re-exports types, registry, and model configs.
 */

// Types
export type {
  MediaType, ModelCapability, ParameterRange, ResolutionPreset,
  DurationPreset, CameraLoraDef, ModelDef, ImageModelParams,
  VideoModelParams, ImageModelConfig, VideoModelConfig,
} from './types'

// Registry (primary import for consumers)
export {
  IMAGE_MODELS, VIDEO_MODELS,
  IMAGE_MODEL_PARAMS, VIDEO_MODEL_PARAMS,
  IMAGE_I2I_OVERRIDES,
  ALL_IMAGE_MODEL_IDS, ALL_VIDEO_MODEL_IDS, I2I_MODEL_IDS,
  getImageModelParams, getI2IModelParams, getVideoModelParams,
  getImageModel, getVideoModel,
  getImageConfig, getVideoConfig,
} from './registry'

// Individual model configs (for direct access when needed)
export { wan22Image, wan22Video } from './wan22'
export { qwenImage } from './qwen'
export { flux2Turbo, flux2Dev } from './flux2'
export { ltx2Video, LTX2_CAMERA_LORAS, LTX2_TEXT_ENCODERS, LTX2_I2V_PRESET_KEYS } from './ltx2'
export type { Ltx2I2vPreset } from './ltx2'
export { zImageBase, zImageTurbo } from './zimage'
