/**
 * Model Type System — shared interfaces for all model configurations.
 */

// ─── Core Enums ─────────────────────────────────────────────────────────────

export type MediaType = 'image' | 'video'
export type ModelCapability = 't2i' | 'i2i' | 't2v' | 'i2v'

// ─── Parameter Types ────────────────────────────────────────────────────────

export interface ParameterRange {
  min: number
  max: number
  default: number
  step?: number
  /** Optional hint text to display next to the parameter to guide the user to the best value */
  hint?: string
}

export interface ResolutionPreset {
  label: string
  w: number
  h: number
}

export interface DurationPreset {
  label: string
  /** Frame count to pass to the backend */
  value: number
  description: string
}

export interface CameraLoraDef {
  id: string
  label: string
  /** Safetensors filename on the pod */
  filename: string
}

export interface TextEncoderDef {
  id: string
  label: string
  /** Safetensors filename on the pod */
  filename: string
}

// ─── Model Definition ───────────────────────────────────────────────────────

export interface ModelDef {
  id: string
  label: string
  description: string
  icon: string
  capabilities: ModelCapability[]
  /** Default step count shown in model selector descriptions */
  defaultSteps: number
  /** If true, the backend workflow builder is not yet implemented */
  comingSoon?: boolean
}

// ─── Image Model Params ─────────────────────────────────────────────────────

export interface ImageModelParams {
  steps: ParameterRange
  cfg?: ParameterRange
  lora?: ParameterRange
  /** Named LoRA controls beyond the generic speed LoRA */
  customLoras?: { id: string; label: string; default: number; min: number; max: number; step: number }[]
  /** Available width/height pixel values */
  sizes: number[]
  defaultWidth: number
  defaultHeight: number
  /** Denoise strength range (I2I only) */
  denoise?: ParameterRange
  /** Sampler options (e.g., euler, dpmpp_2m) */
  sampler?: { options: string[]; default: string }
  /** Scheduler options (e.g., simple, beta) */
  scheduler?: { options: string[]; default: string }
}

// ─── Video Model Params ─────────────────────────────────────────────────────

export interface VideoModelParams {
  steps: ParameterRange
  cfg?: ParameterRange
  fps?: ParameterRange
  lora?: ParameterRange
  imageStrength?: ParameterRange
  resolutions: ResolutionPreset[]
  durations: DurationPreset[]
  /** Available camera motion LoRAs */
  cameraLoras?: CameraLoraDef[]
  /** Available text encoder variants */
  textEncoders?: TextEncoderDef[]
  /** Whether the model supports audio prompts */
  supportsAudio?: boolean
  /** Whether the model has I2V presets */
  hasI2vPresets?: boolean
}

// ─── Full Model Config (combines def + params per capability) ───────────────

export interface ImageModelConfig {
  def: ModelDef
  params: ImageModelParams
  /** I2I-specific overrides (e.g. different step defaults, denoise) */
  i2iParams?: Partial<ImageModelParams>
}

export interface VideoModelConfig {
  def: ModelDef
  params: VideoModelParams
}
