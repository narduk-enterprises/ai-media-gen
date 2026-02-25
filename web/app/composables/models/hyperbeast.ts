/**
 * Hyper Beast XXL — Fast SDXL checkpoint optimised for 10-step generation.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 * CivitAI model version 2712294.
 *
 * Recommended: 10 steps, Euler Ancestral / Normal.
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
    defaultSteps: 10,
  },
  params: {
    steps: { min: 1, max: 30, default: 10 },
    cfg: { min: 1, max: 15, default: 5.0, step: 0.5 },
    sampler: {
      options: SAMPLERS,
      default: 'euler_ancestral',
    },
    scheduler: {
      options: SCHEDULERS,
      default: 'normal',
    },
    sizes: [512, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
