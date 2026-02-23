/**
 * Z-Image — Qwen 3 4B text encoder. Two variants: Base (max quality) and Turbo (fast).
 * T2I only. Uses AuraFlow sampling with ae.safetensors (Flux 1) VAE.
 */
import type { ImageModelConfig } from './types'

const Z_IMAGE_SAMPLERS = ['dpmpp_2m', 'euler', 'euler_ancestral', 'dpmpp_sde', 'dpmpp_2s_ancestral', 'uni_pc']
const Z_IMAGE_SCHEDULERS = ['beta', 'simple', 'normal', 'karras', 'sgm_uniform']

export const zImageBase: ImageModelConfig = {
  def: {
    id: 'z_image',
    label: 'Z-Image',
    description: 'Max quality (bf16), 40 steps',
    icon: 'i-lucide-star',
    capabilities: ['t2i'],
    defaultSteps: 40,
  },
  params: {
    steps: { min: 1, max: 80, default: 40 },
    cfg: { min: 0, max: 10, default: 3.8, step: 0.1 },
    lora: { min: 0, max: 2, default: 0.72, step: 0.01 },
    sampler: { options: Z_IMAGE_SAMPLERS, default: 'dpmpp_2m' },
    scheduler: { options: Z_IMAGE_SCHEDULERS, default: 'beta' },
    sizes: [512, 720, 768, 1024, 1280, 1536, 2048],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}

export const zImageTurbo: ImageModelConfig = {
  def: {
    id: 'z_image_turbo',
    label: 'Z-Image Turbo',
    description: 'Turbo nvfp4 + NSFW Master LoRA, 28 steps',
    icon: 'i-lucide-bolt',
    capabilities: ['t2i'],
    defaultSteps: 28,
  },
  params: {
    steps: { min: 1, max: 50, default: 28 },
    cfg: { min: 0, max: 10, default: 3.5, step: 0.5 },
    sampler: { options: Z_IMAGE_SAMPLERS, default: 'dpmpp_2m' },
    scheduler: { options: Z_IMAGE_SCHEDULERS, default: 'beta' },
    lora: { min: 0, max: 2, default: 1.0, step: 0.05 },
    sizes: [512, 720, 768, 1024, 1280, 1536, 2048],
    defaultWidth: 1024,
    defaultHeight: 1536,
  },
}
