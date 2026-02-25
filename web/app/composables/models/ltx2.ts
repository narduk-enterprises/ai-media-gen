/**
 * LTX-2 19B — T2V and I2V with distilled LoRA + spatial upscaler.
 * Most feature-rich video model: audio prompts, camera LoRAs, I2V presets.
 * Supports durations up to 60 seconds (1441 frames at 24 FPS).
 */
import type { VideoModelConfig, CameraLoraDef, TextEncoderDef } from './types'

// ─── Camera LoRAs ───────────────────────────────────────────────────────────

export const LTX2_CAMERA_LORAS: CameraLoraDef[] = [
  { id: 'dolly-left', label: 'Dolly Left', filename: 'ltx-2-19b-lora-camera-control-dolly-left.safetensors' },
  { id: 'dolly-right', label: 'Dolly Right', filename: 'ltx-2-19b-lora-camera-control-dolly-right.safetensors' },
  { id: 'dolly-in', label: 'Dolly In', filename: 'ltx-2-19b-lora-camera-control-dolly-in.safetensors' },
  { id: 'dolly-out', label: 'Dolly Out', filename: 'ltx-2-19b-lora-camera-control-dolly-out.safetensors' },
  { id: 'jib-up', label: 'Jib Up', filename: 'ltx-2-19b-lora-camera-control-jib-up.safetensors' },
  { id: 'jib-down', label: 'Jib Down', filename: 'ltx-2-19b-lora-camera-control-jib-down.safetensors' },
  { id: 'static', label: 'Static', filename: 'ltx-2-19b-lora-camera-control-static.safetensors' },
]

// ─── Text Encoders ──────────────────────────────────────────────────────────

export const LTX2_TEXT_ENCODERS: TextEncoderDef[] = [
  { id: 'default', label: 'Default (FP4)', filename: '' },
  { id: 'heretic', label: 'Heretic (FP8)', filename: 'gemma_3_12B_it_heretic_fp8_e4m3fn.safetensors' },
  { id: 'sikaworld', label: 'Sikaworld HiFi', filename: 'gemma-3-12b-it-abliterated-sikaworld-high-fidelity-edition.safetensors' },
]

// ─── I2V Preset Keys (definitions live in workflow_loader.py) ───────────────

export const LTX2_I2V_PRESET_KEYS = [
  'cinematic_breathe', 'gentle_wind', 'dreamy_drift', 'natural_motion',
  'vivid_action', 'soft_focus', 'fluid_motion', 'tight_hold',
  'warm_glow', 'dynamic_subtle',
] as const

export type Ltx2I2vPreset = typeof LTX2_I2V_PRESET_KEYS[number]

// ─── Model Config ───────────────────────────────────────────────────────────

export const ltx2Video: VideoModelConfig = {
  def: {
    id: 'ltx2',
    label: 'LTX-2',
    description: '19B + upscaler, 20 steps',
    icon: 'i-lucide-film',
    capabilities: ['t2v', 'i2v'],
    defaultSteps: 20,
  },
  params: {
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
      { label: '~30s', value: 721, description: '30 seconds' },
      { label: '~45s', value: 1081, description: '45 seconds' },
      { label: '~60s', value: 1441, description: '1 minute (high VRAM)' },
    ],
    cameraLoras: LTX2_CAMERA_LORAS,
    textEncoders: LTX2_TEXT_ENCODERS,
    supportsAudio: true,
    hasI2vPresets: true,
  },
}
