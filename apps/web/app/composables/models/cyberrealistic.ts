/**
 * CyberRealistic Pony — SDXL-based photorealistic checkpoint.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 * CivitAI model version 2581228.
 */
import type { ImageModelConfig } from './types'

const CR_SAMPLERS = ['dpmpp_2m_sde', 'dpmpp_2m', 'euler', 'euler_ancestral', 'dpmpp_sde', 'uni_pc']
const CR_SCHEDULERS = ['karras', 'normal', 'simple', 'exponential', 'sgm_uniform']

export const cyberRealisticPony: ImageModelConfig = {
  def: {
    id: 'cyberrealistic_pony',
    label: 'CyberRealistic Pony',
    description: 'SDXL Pony photorealism, 30 steps',
    icon: 'i-lucide-horse',
    capabilities: ['t2i'],
    defaultSteps: 30,
  },
  params: {
    steps: { min: 1, max: 80, default: 30 },
    cfg: { min: 1, max: 15, default: 5.0, step: 0.5 },
    sampler: {
      options: CR_SAMPLERS,
      default: 'dpmpp_sde',
    },
    scheduler: {
      options: CR_SCHEDULERS,
      default: 'karras',
    },
    sizes: [512, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
