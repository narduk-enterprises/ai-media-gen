/**
 * Wan 2.2 — 14B dual-UNET. Most versatile model: T2I, I2I, T2V, I2V.
 */
import type { ImageModelConfig, VideoModelConfig } from './types'

export const wan22Image: ImageModelConfig = {
  def: {
    id: 'wan22',
    label: 'Wan 2.2',
    description: '14B dual-UNET, DPM++ 2M SDE / Karras',
    icon: 'i-lucide-brain',
    capabilities: ['t2i', 'i2i'],
    defaultSteps: 52,
  },
  params: {
    steps: { min: 1, max: 80, default: 52 },
    cfg: { min: 0, max: 15, default: 3.7, step: 0.1 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    customLoras: [
      { id: 'instareal', label: 'Instareal', default: 0.65, min: 0, max: 1.5, step: 0.05 },
      { id: 'detailz', label: 'Detailz', default: 0.60, min: 0, max: 1.5, step: 0.05 },
    ],
    sampler: {
      options: ['dpmpp_2m_sde', 'dpmpp_2m', 'dpmpp_2s_ancestral', 'euler', 'euler_ancestral'],
      default: 'dpmpp_2m_sde',
    },
    scheduler: {
      options: ['karras', 'beta', 'simple', 'normal', 'sgm_uniform'],
      default: 'karras',
    },
    sizes: [512, 720, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
  i2iParams: {
    cfg: { min: 1, max: 15, default: 3.5, step: 0.5 },
    denoise: { min: 0, max: 1, default: 0.75, step: 0.05 },
  },
}

export const wan22Video: VideoModelConfig = {
  def: {
    id: 'wan22',
    label: 'Wan 2.2',
    description: '14B LightX2V, 4 steps',
    icon: 'i-lucide-brain',
    capabilities: ['t2v', 'i2v'],
    defaultSteps: 4,
  },
  params: {
    steps: { min: 1, max: 50, default: 4, hint: '4 = fast (distilled). 20-30 = quality (base model)' },
    cfg: { min: 1, max: 15, default: 4.0, step: 0.5, hint: 'Only used in quality mode (>4 steps)' },
    resolutions: [
      { label: '640 × 640', w: 640, h: 640 },
      { label: '512 × 512', w: 512, h: 512 },
      { label: '768 × 512', w: 768, h: 512 },
      { label: '512 × 768', w: 512, h: 768 },
      { label: '832 × 480', w: 832, h: 480 },
      { label: '480 × 832', w: 480, h: 832 },
      { label: '1024 × 576', w: 1024, h: 576 },
      { label: '576 × 1024', w: 576, h: 1024 },
    ],
    durations: [
      { label: '~1.7s', value: 41, description: 'Quick' },
      { label: '~3.4s', value: 81, description: 'Standard' },
      { label: '~5s', value: 121, description: 'Long' },
      { label: '~6.7s', value: 161, description: 'Extended' },
      { label: '~8.4s', value: 201, description: 'Maximum' },
    ],
  },
}
