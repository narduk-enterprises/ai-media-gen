/**
 * epiCRealism — SD 1.5 photorealistic checkpoint.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 * CivitAI model version 94744.
 */
import type { ImageModelConfig } from './types'

const SAMPLERS = ['euler_ancestral', 'euler', 'dpmpp_2m_sde', 'dpmpp_2m', 'dpmpp_sde', 'uni_pc']
const SCHEDULERS = ['normal', 'karras', 'simple', 'exponential', 'sgm_uniform']

export const epicRealism: ImageModelConfig = {
  def: {
    id: 'epicrealism',
    label: 'epiCRealism',
    description: 'SD 1.5 photorealism, 25 steps',
    icon: 'i-lucide-camera',
    capabilities: ['t2i'],
    defaultSteps: 25,
  },
  params: {
    steps: { min: 1, max: 50, default: 25 },
    cfg: { min: 1, max: 15, default: 7.0, step: 0.5 },
    sampler: {
      options: SAMPLERS,
      default: 'euler_ancestral',
    },
    scheduler: {
      options: SCHEDULERS,
      default: 'normal',
    },
    sizes: [512, 576, 640, 704, 768],
    defaultWidth: 512,
    defaultHeight: 768,
  },
}
