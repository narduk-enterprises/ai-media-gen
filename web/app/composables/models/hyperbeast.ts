/**
 * Hyper Beast XXL — Fast SDXL checkpoint optimised for 10-step generation.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 * CivitAI model version 2712294.
 *
 * Recommended: 8 steps, DPM++ 2M SDE / SGM Uniform, CFG 1.5.
 */
import type { ImageModelConfig } from './types'

const SAMPLERS = ['euler_ancestral', 'euler', 'dpmpp_2m_sde', 'dpmpp_2m', 'dpmpp_sde', 'uni_pc']
const SCHEDULERS = ['normal', 'karras', 'simple', 'exponential', 'sgm_uniform']

export const hyperBeast: ImageModelConfig = {
  def: {
    id: 'hyperbeast',
    label: 'Hyper Beast XXL',
    description: 'Fast SDXL, 10 steps',
    icon: 'i-lucide-zap',
    capabilities: ['t2i'],
    defaultSteps: 8,
  },
  params: {
    steps: { min: 1, max: 30, default: 8 },
    cfg: { min: 1, max: 2.0, default: 1.5, step: 0.1 },
    sampler: {
      options: SAMPLERS,
      default: 'dpmpp_2m_sde',
    },
    scheduler: {
      options: SCHEDULERS,
      default: 'sgm_uniform',
    },
    sizes: [512, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
