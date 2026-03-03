/**
 * NSFW SDXL — Photorealistic SDXL checkpoint focused on NSFW quality.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 * CivitAI model version 2668773.
 */
import type { ImageModelConfig } from './types'

const SAMPLERS = ['dpmpp_2m_sde', 'dpmpp_2m', 'euler', 'euler_ancestral', 'dpmpp_sde', 'uni_pc']
const SCHEDULERS = ['karras', 'normal', 'simple', 'exponential', 'sgm_uniform']

export const nsfwSdxl: ImageModelConfig = {
  def: {
    id: 'nsfw_sdxl',
    label: 'NSFW SDXL',
    description: 'SDXL photorealism (NSFW), 30 steps',
    icon: 'i-lucide-flame',
    capabilities: ['t2i'],
    defaultSteps: 30,
  },
  params: {
    steps: { min: 1, max: 50, default: 30 },
    cfg: { min: 1, max: 15, default: 5.0, step: 0.5 },
    sampler: {
      options: SAMPLERS,
      default: 'dpmpp_2m_sde',
    },
    scheduler: {
      options: SCHEDULERS,
      default: 'karras',
    },
    sizes: [512, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
