/**
 * Juggernaut XL — SDXL checkpoint, photorealism focused.
 * Uses CheckpointLoaderSimple (includes CLIP + VAE).
 */
import type { ImageModelConfig } from './types'

const JUGGERNAUT_SAMPLERS = ['dpmpp_2m_sde', 'dpmpp_2m', 'euler', 'euler_ancestral', 'dpmpp_sde', 'uni_pc']
const JUGGERNAUT_SCHEDULERS = ['karras', 'normal', 'simple', 'exponential', 'sgm_uniform']

export const juggernautXL: ImageModelConfig = {
  def: {
    id: 'juggernaut',
    label: 'Juggernaut XL',
    description: 'SDXL photorealism, 30 steps',
    icon: 'i-lucide-shield',
    capabilities: ['t2i'],
    defaultSteps: 30,
  },
  params: {
    steps: { min: 1, max: 50, default: 30 },
    cfg: { min: 1, max: 15, default: 5.0, step: 0.5 },
    sampler: {
      options: JUGGERNAUT_SAMPLERS,
      default: 'dpmpp_2m_sde',
    },
    scheduler: {
      options: JUGGERNAUT_SCHEDULERS,
      default: 'karras',
    },
    sizes: [512, 768, 832, 1024, 1152, 1216, 1280, 1536],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
