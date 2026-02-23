/**
 * Flux 2 — Mistral CLIP encoder. Two variants: Turbo (fast LoRA) and Dev (full quality).
 * Supports T2I and I2I.
 */
import type { ImageModelConfig } from './types'

export const flux2Turbo: ImageModelConfig = {
  def: {
    id: 'flux2_turbo',
    label: 'Flux 2 Turbo',
    description: 'Fast Mistral CLIP, 4 steps',
    icon: 'i-lucide-zap',
    capabilities: ['t2i', 'i2i'],
    defaultSteps: 4,
  },
  params: {
    steps: { min: 1, max: 10, default: 4 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 720, 768, 1024, 1280, 1536, 2048],
    defaultWidth: 1280,
    defaultHeight: 720,
  },
}

export const flux2Dev: ImageModelConfig = {
  def: {
    id: 'flux2_dev',
    label: 'Flux 2 Dev',
    description: 'Full quality, 20 steps',
    icon: 'i-lucide-gem',
    capabilities: ['t2i'],
    defaultSteps: 20,
  },
  params: {
    steps: { min: 1, max: 50, default: 20 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 720, 768, 1024, 1280, 1536, 2048],
    defaultWidth: 1280,
    defaultHeight: 720,
  },
}
