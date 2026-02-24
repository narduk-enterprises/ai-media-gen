/**
 * Qwen 2.5 VL 7B — T2I only. Lightning LoRA auto-enabled at ≤10 steps.
 */
import type { ImageModelConfig } from './types'

export const qwenImage: ImageModelConfig = {
  def: {
    id: 'qwen_image',
    label: 'Qwen 2.5',
    description: 'VL 7B, 50 steps (4 with Lightning)',
    icon: 'i-lucide-sparkles',
    capabilities: ['t2i'],
    defaultSteps: 50,
  },
  params: {
    steps: { min: 1, max: 50, default: 50 },
    cfg: { min: 1, max: 15, default: 7.0, step: 0.5 },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 720, 768, 1024, 1280, 1536],
    defaultWidth: 1280,
    defaultHeight: 720,
  },
}

export const qwenLora: ImageModelConfig = {
  def: {
    id: 'qwen_lora',
    label: 'Qwen 2.5 + LoRA',
    description: 'VL 7B + blondeCurlyQ2512, 30 steps',
    icon: 'i-lucide-sparkles',
    capabilities: ['t2i'],
    defaultSteps: 30,
  },
  params: {
    steps: { min: 1, max: 50, default: 30 },
    cfg: { min: 0, max: 15, default: 4.0, step: 0.5 },
    lora: { min: 0, max: 2, default: 0.75, step: 0.05 },
    sampler: {
      options: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde'],
      default: 'euler',
    },
    scheduler: {
      options: ['simple', 'beta', 'karras', 'normal'],
      default: 'simple',
    },
    sizes: [512, 720, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
