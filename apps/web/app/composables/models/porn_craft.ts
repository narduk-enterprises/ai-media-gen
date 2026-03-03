/**
 * Porn Craft by Stable Yogi — Illustrious (SDXL) checkpoint.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 * CivitAI model version 2663626.
 *
 * Recommended: 27 steps, DPM++ 2M, Karras, CFG 7, clip skip 2.
 */
import type { ImageModelConfig } from './types'

const SAMPLERS = ['dpmpp_2m', 'dpmpp_2m_sde', 'euler', 'euler_ancestral', 'dpmpp_sde', 'uni_pc']
const SCHEDULERS = ['karras', 'normal', 'simple', 'exponential', 'sgm_uniform']

export const pornCraft: ImageModelConfig = {
  def: {
    id: 'porn_craft',
    label: 'Porn Craft',
    description: 'Illustrious NSFW, 27 steps',
    icon: 'i-lucide-sparkles',
    capabilities: ['t2i'],
    defaultSteps: 27,
  },
  params: {
    steps: { min: 1, max: 50, default: 27 },
    cfg: { min: 1, max: 15, default: 7.0, step: 0.5 },
    sampler: {
      options: SAMPLERS,
      default: 'dpmpp_2m',
    },
    scheduler: {
      options: SCHEDULERS,
      default: 'karras',
    },
    sizes: [512, 768, 832, 896, 1024, 1152],
    defaultWidth: 896,
    defaultHeight: 1152,
  },
}
