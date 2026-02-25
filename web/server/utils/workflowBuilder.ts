/**
 * workflowBuilder.ts — TypeScript port of workflow_loader.py.
 *
 * Loads ComfyUI JSON templates and injects parameters.
 * Used by the CF Worker to build workflows before dispatching to pods.
 */

// ── Import all workflow templates as static JSON ────────────────
import wanT2i from './workflows/wan_t2i.json'
import wanT2v from './workflows/wan_t2v.json'
import wanI2v from './workflows/wan_i2v.json'
import wanI2i from './workflows/wan_i2i.json'
import qwenT2i from './workflows/qwen_t2i.json'
import qwenLoraT2i from './workflows/qwen_lora_t2i.json'
import flux2T2i from './workflows/flux2_t2i.json'
import flux2I2i from './workflows/flux2_i2i.json'
import zImageT2i from './workflows/z_image_t2i.json'
import zImageTurboT2i from './workflows/z_image_turbo_t2i.json'
import juggernautT2i from './workflows/juggernaut_t2i.json'
import sdxlT2i from './workflows/sdxl_t2i.json'
import ltx2T2v from './workflows/ltx2_t2v.json'
import ltx2I2v from './workflows/ltx2_i2v.json'
import upscaleTemplate from './workflows/upscale.json'

// ── Template registry ──────────────────────────────────────────
const TEMPLATES: Record<string, any> = {
  wan_t2i: wanT2i,
  wan_t2v: wanT2v,
  wan_i2v: wanI2v,
  wan_i2i: wanI2i,
  qwen_t2i: qwenT2i,
  qwen_lora_t2i: qwenLoraT2i,
  flux2_t2i: flux2T2i,
  flux2_i2i: flux2I2i,
  z_image_t2i: zImageT2i,
  z_image_turbo_t2i: zImageTurboT2i,
  juggernaut_t2i: juggernautT2i,
  sdxl_t2i: sdxlT2i,
  ltx2_t2v: ltx2T2v,
  ltx2_i2v: ltx2I2v,
  upscale: upscaleTemplate,
}

// ── Constants ──────────────────────────────────────────────────
export const DEFAULT_NEG_PROMPT =
  'worst quality, low quality, blurry, distorted, deformed, disfigured, ' +
  'bad anatomy, extra limbs, extra fingers, fused fingers, poorly drawn hands, ' +
  'poorly drawn face, mutation, mutated, ugly, watermark, text, logo, signature, ' +
  'jpeg artifacts, overexposed, underexposed, static, frozen, ' +
  'jittery, flickering, noise, grain, out of focus, bad proportions, ' +
  'cropped, frame, border, cluttered background'

export const LTX2_NEG_PROMPT =
  'blurry, low quality, still frame, watermark, overlay, titles, subtitles, text, logo'

const UPSCALE_MODEL = 'RealESRGAN_x4plus.pth'

// ── Camera LoRA registry ───────────────────────────────────────
const CAMERA_LORAS: Record<string, string> = {
  'dolly-left': 'ltx-2-19b-lora-camera-control-dolly-left.safetensors',
  'dolly-right': 'ltx-2-19b-lora-camera-control-dolly-right.safetensors',
  'dolly-in': 'ltx-2-19b-lora-camera-control-dolly-in.safetensors',
  'dolly-out': 'ltx-2-19b-lora-camera-control-dolly-out.safetensors',
  'jib-up': 'ltx-2-19b-lora-camera-control-jib-up.safetensors',
  'jib-down': 'ltx-2-19b-lora-camera-control-jib-down.safetensors',
  'static': 'ltx-2-19b-lora-camera-control-static.safetensors',
}

// ── Helpers ────────────────────────────────────────────────────

function seed(s?: number | null): number {
  if (s == null || s < 0) return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  return s
}

function loadTemplate(name: string): any {
  const t = TEMPLATES[name]
  if (!t) throw new Error(`Unknown workflow template: ${name}`)
  return structuredClone(t)
}

/**
 * Deep-walk a workflow dict and replace {{key}} placeholders with values.
 */
function injectParams(workflow: any, params: Record<string, any>): any {
  const result = structuredClone(workflow)
  walk(result, params)
  return result
}

function walk(obj: any, params: Record<string, any>): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const val = obj[i]
      if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
        const key = val.slice(2, -2)
        if (key in params) obj[i] = params[key]
      } else if (typeof val === 'object' && val !== null) {
        walk(val, params)
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
        const paramName = val.slice(2, -2)
        if (paramName in params) obj[key] = params[paramName]
      } else if (typeof val === 'object' && val !== null) {
        walk(val, params)
      }
    }
  }
}

// =============================================================================
// Text-to-Image Builders
// =============================================================================

export interface Text2ImageOptions {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number | null
  loraStrength?: number
  samplerName?: string
  scheduler?: string
  customLoras?: Record<string, number>
}

/** Wan 2.2 T2I (single frame from T2V model). */
export function buildText2ImageWorkflow(opts: Text2ImageOptions) {
  const s = seed(opts.seed)
  const steps = opts.steps ?? 52
  const wf = injectParams(loadTemplate('wan_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1024,
    steps,
    half_steps: Math.floor(steps / 2),
    cfg: opts.cfg ?? 3.7,
    sampler_name: opts.samplerName ?? 'dpmpp_2m_sde',
    scheduler: opts.scheduler ?? 'karras',
    seed: s,
    lora_strength: opts.loraStrength ?? 1.0,
  })
  // Custom LoRA strength overrides
  if (opts.customLoras) {
    if (opts.customLoras.instareal != null) {
      for (const nodeId of ['90', '92']) {
        if (wf[nodeId]) wf[nodeId].inputs.strength_model = opts.customLoras.instareal
      }
    }
    if (opts.customLoras.detailz != null) {
      for (const nodeId of ['91', '93']) {
        if (wf[nodeId]) wf[nodeId].inputs.strength_model = opts.customLoras.detailz
      }
    }
  }
  return wf
}

/** Qwen Image T2I with optional Lightning LoRA. */
export function buildQwenImageWorkflow(opts: Text2ImageOptions) {
  const steps = opts.steps ?? 50
  return injectParams(loadTemplate('qwen_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || '',
    width: opts.width ?? 1024,
    height: opts.height ?? 1024,
    steps,
    seed: seed(opts.seed),
    use_lightning: steps <= 10,
  })
}

/** Qwen Image T2I with blondeCurlyQ LoRA. */
export function buildQwenLoraWorkflow(opts: Text2ImageOptions) {
  const s = seed(opts.seed)
  const steps = opts.steps ?? 30
  const wf = injectParams(loadTemplate('qwen_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps,
    seed: s,
    use_lightning: false,
  })
  if (wf['197:189']) {
    wf['197:189'].inputs.lora_name = 'blondeCurlyQ2512.safetensors'
    wf['197:189'].inputs.strength_model = opts.loraStrength ?? 0.75
  }
  if (wf['197:185']) {
    wf['197:185'].inputs.switch = true
    wf['197:185'].inputs.on_true = ['197:189', 0]
  }
  if (wf['197:194']) {
    wf['197:194'].inputs.cfg = opts.cfg ?? 4.0
    wf['197:194'].inputs.sampler_name = opts.samplerName ?? 'euler'
    wf['197:194'].inputs.scheduler = opts.scheduler ?? 'simple'
  }
  return wf
}

/** Flux 2 T2I (dev or turbo via LoRA). */
export function buildFlux2Text2ImageWorkflow(
  opts: Text2ImageOptions & { turbo?: boolean },
) {
  const s = seed(opts.seed)
  const turbo = opts.turbo ?? true
  const wf = injectParams(loadTemplate('flux2_t2i'), {
    prompt: opts.prompt,
    width: opts.width ?? 1024,
    height: opts.height ?? 1024,
    steps: opts.steps ?? 20,
    seed: s,
    guidance: turbo ? 3.5 : 4.0,
    guider_model_ref: turbo ? ['68:100', 0] : ['68:12', 0],
  })
  if (turbo) {
    wf['68:100'] = {
      inputs: {
        lora_name: 'Flux_2-Turbo-LoRA_comfyui.safetensors',
        strength_model: 1.0,
        model: ['68:12', 0],
      },
      class_type: 'LoraLoaderModelOnly',
      _meta: { title: 'Load Turbo LoRA' },
    }
  }
  return wf
}

/** Z-Image Base T2I (bf16, max quality). */
export function buildZImageWorkflow(opts: Text2ImageOptions) {
  return injectParams(loadTemplate('z_image_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps: opts.steps ?? 40,
    cfg: opts.cfg ?? 3.8,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'dpmpp_2m',
    scheduler: opts.scheduler ?? 'beta',
    lora_strength: opts.loraStrength ?? 0.72,
  })
}

/** Z-Image Turbo T2I (nvfp4 + distill patch + NSFW Master LoRA). */
export function buildZImageTurboWorkflow(opts: Text2ImageOptions) {
  return injectParams(loadTemplate('z_image_turbo_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps: opts.steps ?? 28,
    cfg: opts.cfg ?? 3.5,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'dpmpp_2m',
    scheduler: opts.scheduler ?? 'beta',
  })
}

/** Juggernaut XL (SDXL checkpoint, photorealism). */
export function buildJuggernautWorkflow(opts: Text2ImageOptions) {
  return injectParams(loadTemplate('juggernaut_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps: opts.steps ?? 30,
    cfg: opts.cfg ?? 5.0,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'dpmpp_2m_sde',
    scheduler: opts.scheduler ?? 'karras',
  })
}

/** CyberRealistic Pony (SDXL checkpoint), with optional LoRA. */
export function buildCyberrealisticWorkflow(
  opts: Text2ImageOptions & { loraName?: string },
) {
  const s = seed(opts.seed)
  const wf = injectParams(loadTemplate('sdxl_t2i'), {
    checkpoint: 'cyberrealisticPony_v160.safetensors',
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps: opts.steps ?? 30,
    cfg: opts.cfg ?? 5.0,
    seed: s,
    sampler_name: opts.samplerName ?? 'dpmpp_2m_sde',
    scheduler: opts.scheduler ?? 'karras',
  })
  if (opts.loraName) {
    wf['15'] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: opts.loraName,
        strength_model: opts.loraStrength ?? 0.7,
        strength_clip: opts.loraStrength ?? 0.7,
        model: ['10', 0],
        clip: ['10', 1],
      },
    }
    wf['40'].inputs.model = ['15', 0]
    wf['20'].inputs.clip = ['15', 1]
    wf['21'].inputs.clip = ['15', 1]
  }
  return wf
}

/** epiCRealism (SD 1.5 checkpoint, photorealism). */
export function buildEpicRealismWorkflow(opts: Text2ImageOptions) {
  return injectParams(loadTemplate('sdxl_t2i'), {
    checkpoint: 'epicrealism_naturalSinRC1.safetensors',
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 512,
    height: opts.height ?? 768,
    steps: opts.steps ?? 25,
    cfg: opts.cfg ?? 7.0,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'euler_ancestral',
    scheduler: opts.scheduler ?? 'normal',
  })
}

/** Hyper Beast XXL (Hyper SD-XL checkpoint, 8-step). */
export function buildHyperBeastWorkflow(opts: Text2ImageOptions) {
  return injectParams(loadTemplate('sdxl_t2i'), {
    checkpoint: 'hyperBeastXXL.safetensors',
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps: opts.steps ?? 8,
    cfg: opts.cfg ?? 1.5,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'dpmpp_2m_sde',
    scheduler: opts.scheduler ?? 'sgm_uniform',
  })
}

/** NSFW SDXL (Z-Image Turbo fine-tune, needs Qwen text encoder). */
export function buildNsfwSdxlWorkflow(opts: Text2ImageOptions) {
  const wf = injectParams(loadTemplate('z_image_turbo_t2i'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1536,
    steps: opts.steps ?? 28,
    cfg: opts.cfg ?? 3.5,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'dpmpp_2m',
    scheduler: opts.scheduler ?? 'beta',
  })
  // Override diffusion model to the NSFW SDXL checkpoint
  if (wf['11']) wf['11'].inputs.unet_name = 'nsfwSdxl_v2602.safetensors'
  return wf
}

/** Porn Craft (Illustrious SDXL checkpoint). */
export function buildPornCraftWorkflow(opts: Text2ImageOptions) {
  return injectParams(loadTemplate('sdxl_t2i'), {
    checkpoint: 'pornCraftByStableYogi_v50FP32.safetensors',
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 896,
    height: opts.height ?? 1152,
    steps: opts.steps ?? 27,
    cfg: opts.cfg ?? 7.0,
    seed: seed(opts.seed),
    sampler_name: opts.samplerName ?? 'dpmpp_2m',
    scheduler: opts.scheduler ?? 'karras',
  })
}

// =============================================================================
// Image-to-Image Builders
// =============================================================================

export interface Image2ImageOptions {
  imageFilename: string
  prompt?: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  shift?: number
  denoise?: number
  seed?: number | null
}

/** Wan 2.2 I2I (single frame from I2V model). */
export function buildImage2ImageWorkflow(opts: Image2ImageOptions) {
  const steps = opts.steps ?? 20
  return injectParams(loadTemplate('wan_i2i'), {
    image_filename: opts.imageFilename,
    prompt: opts.prompt || 'high quality image, detailed',
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 1024,
    height: opts.height ?? 1024,
    steps,
    half_steps: Math.floor(steps / 2),
    cfg: opts.cfg ?? 3.5,
    shift: opts.shift ?? 8.0,
    seed: seed(opts.seed),
    // Default to high-noise model (low-noise requires filesystem check)
    i2v_low_noise_model: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
  })
}

/** Flux 2 Turbo I2I. */
export function buildFlux2TurboI2iWorkflow(opts: Image2ImageOptions) {
  return injectParams(loadTemplate('flux2_i2i'), {
    image_filename: opts.imageFilename,
    prompt: opts.prompt || '',
    steps: opts.steps ?? 20,
    seed: seed(opts.seed),
  })
}

// =============================================================================
// Text-to-Video Builders
// =============================================================================

export interface Text2VideoOptions {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  frames?: number
  steps?: number
  seed?: number | null
  loraStrength?: number
  fps?: number
  cameraLora?: string | null
  audioPrompt?: string | null
}

/** Wan 2.2 T2V with LightX2V 4-step LoRAs (fast mode). */
export function buildText2VideoWorkflow(opts: Text2VideoOptions) {
  const steps = opts.steps ?? 4
  // Auto quality mode: if steps > 4, use base model without distilled LoRAs
  if (steps > 4) return buildWan22QualityT2vWorkflow(opts)
  return injectParams(loadTemplate('wan_t2v'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 832,
    height: opts.height ?? 480,
    frames: opts.frames ?? 81,
    steps,
    half_steps: Math.floor(steps / 2),
    seed: seed(opts.seed),
    lora_strength: opts.loraStrength ?? 1.0,
  })
}

/** Wan 2.2 T2V quality mode — base model, no distilled LoRAs, more steps. */
function buildWan22QualityT2vWorkflow(opts: Text2VideoOptions) {
  const steps = opts.steps ?? 25
  return injectParams(loadTemplate('wan_t2v_quality'), {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: opts.width ?? 832,
    height: opts.height ?? 480,
    frames: opts.frames ?? 81,
    steps,
    half_steps: Math.floor(steps / 2),
    cfg: 4.0,
    sampler_name: 'dpmpp_2m_sde',
    scheduler: 'karras',
    seed: seed(opts.seed),
  })
}

/** LTX-2 19B T2V with distilled LoRA + spatial upscaler. */
export function buildLtx2T2vWorkflow(opts: Text2VideoOptions) {
  const s = seed(opts.seed)
  const fps = opts.fps ?? 24
  let fullPrompt = opts.prompt
  if (opts.audioPrompt) fullPrompt = `${opts.prompt}. Audio: ${opts.audioPrompt}`

  const wf = injectParams(loadTemplate('ltx2_t2v'), {
    prompt: fullPrompt,
    negative_prompt: opts.negativePrompt || LTX2_NEG_PROMPT,
    width: opts.width ?? 1280,
    height: opts.height ?? 720,
    frames: opts.frames ?? 97,
    steps: opts.steps ?? 20,
    seed: s,
    fps,
    fps_int: Math.floor(fps),
    lora_strength: opts.loraStrength ?? 1.0,
  })

  // Optional camera motion LoRA
  if (opts.cameraLora && CAMERA_LORAS[opts.cameraLora]) {
    wf['92:200'] = {
      inputs: {
        lora_name: CAMERA_LORAS[opts.cameraLora],
        strength_model: Math.min(opts.loraStrength ?? 1.0, 0.8),
        model: ['92:68', 0],
      },
      class_type: 'LoraLoaderModelOnly',
      _meta: { title: `Camera LoRA (${opts.cameraLora})` },
    }
    wf['92:82'].inputs.model = ['92:200', 0]
  }

  return wf
}

// =============================================================================
// Image-to-Video Builders
// =============================================================================

export interface Image2VideoOptions {
  imageFilename: string
  prompt?: string
  negativePrompt?: string
  width?: number
  height?: number
  frames?: number
  steps?: number
  seed?: number | null
  fps?: number
  loraStrength?: number
  imageStrength?: number
  cameraLora?: string | null
  audioPrompt?: string | null
  preset?: string | null
  cfg?: number
  shift?: number
  upscale?: number | null
  model?: string
}

/** LTX-2 19B I2V with distilled LoRA + spatial upscaler. */
export function buildLtx2I2vWorkflow(opts: Image2VideoOptions) {
  const s = seed(opts.seed)
  const fps = opts.fps ?? 24
  const fullPrompt = opts.prompt || 'smooth natural motion, cinematic quality'

  const wf = injectParams(loadTemplate('ltx2_i2v'), {
    image_filename: opts.imageFilename,
    prompt: fullPrompt,
    negative_prompt: opts.negativePrompt || LTX2_NEG_PROMPT,
    width: opts.width ?? 1280,
    height: opts.height ?? 720,
    frames: opts.frames ?? 97,
    steps: opts.steps ?? 20,
    seed: s,
    fps,
    fps_int: Math.floor(fps),
    lora_strength: opts.loraStrength ?? 1.0,
    image_strength: opts.imageStrength ?? 1.0,
  })

  // Apply I2V preset
  if (opts.preset) applyI2vPreset(wf, opts.preset)

  // Optional camera motion LoRA
  if (opts.cameraLora && CAMERA_LORAS[opts.cameraLora]) {
    wf['92:200'] = {
      inputs: {
        lora_name: CAMERA_LORAS[opts.cameraLora],
        strength_model: Math.min(opts.loraStrength ?? 1.0, 0.8),
        model: ['92:68', 0],
      },
      class_type: 'LoraLoaderModelOnly',
      _meta: { title: `Camera LoRA (${opts.cameraLora})` },
    }
    wf['92:82'].inputs.model = ['92:200', 0]
  }

  return wf
}

/** Wan 2.2 I2V with optional RealESRGAN upscale. */
export function buildImage2VideoWorkflow(opts: Image2VideoOptions) {
  const s = seed(opts.seed)
  const steps = opts.steps ?? 20
  let genWidth = opts.width ?? 768
  let genHeight = opts.height ?? 768
  const upscale = opts.upscale

  if (upscale && upscale > 1) {
    genWidth = Math.max(128, Math.floor(genWidth / upscale / 16) * 16)
    genHeight = Math.max(128, Math.floor(genHeight / upscale / 16) * 16)
  }

  const wf = injectParams(loadTemplate('wan_i2v'), {
    image_filename: opts.imageFilename,
    prompt: opts.prompt || 'smooth natural motion, cinematic quality',
    negative_prompt: opts.negativePrompt || DEFAULT_NEG_PROMPT,
    width: genWidth,
    height: genHeight,
    frames: opts.frames ?? 81,
    steps,
    half_steps: Math.floor(steps / 2),
    cfg: opts.cfg ?? 3.5,
    shift: opts.shift ?? 8.0,
    seed: s,
    i2v_low_noise_model: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
  })

  // Optional upscale nodes
  if (upscale && upscale > 1) {
    const targetWidth = opts.width ?? 768
    const targetHeight = opts.height ?? 768
    wf['90'] = {
      inputs: { model_name: UPSCALE_MODEL },
      class_type: 'UpscaleModelLoader',
      _meta: { title: 'Load Upscale Model' },
    }
    wf['91'] = {
      inputs: { upscale_model: ['90', 0], image: ['8', 0] },
      class_type: 'ImageUpscaleWithModel',
      _meta: { title: 'Upscale Frames (RealESRGAN 4x)' },
    }
    let videoSource: [string, number]
    if (upscale !== 4) {
      wf['92'] = {
        inputs: {
          upscale_method: 'lanczos',
          width: targetWidth,
          height: targetHeight,
          crop: 'disabled',
          image: ['91', 0],
        },
        class_type: 'ImageScale',
        _meta: { title: `Resize to ${targetWidth}x${targetHeight}` },
      }
      videoSource = ['92', 0]
    } else {
      videoSource = ['91', 0]
    }
    wf['11'].inputs.images = videoSource
  }

  return wf
}

// =============================================================================
// Standalone Upscale
// =============================================================================

export interface UpscaleOptions {
  imageFilename: string
  scale?: number
}

/** Standalone RealESRGAN upscale for images. */
export function buildUpscaleWorkflow(opts: UpscaleOptions) {
  const scale = opts.scale ?? 2
  const wf = loadTemplate('upscale')
  wf['2'].inputs.image = opts.imageFilename

  if (scale === 4) {
    // Skip resize — use RealESRGAN output directly
    wf['5'].inputs.images = ['3', 0]
    delete wf['4']
  } else {
    // scale=2: RealESRGAN 4x then resize to 50%
    wf['4'] = {
      inputs: {
        upscale_method: 'lanczos',
        scale_by: 0.5,
        image: ['3', 0],
      },
      class_type: 'ImageScaleBy',
      _meta: { title: 'Scale to 2x' },
    }
  }

  return wf
}

// =============================================================================
// I2V Preset System
// =============================================================================

interface I2vPreset {
  desc: string
  cfg_1: number
  cfg_2: number
  max_shift: number
  base_shift: number
  terminal: number
  sampler_1: string
  sampler_2: string
  image_strength: number
}

export const I2V_PRESETS: Record<string, I2vPreset> = {
  cinematic_breathe: {
    desc: 'Subtle breathing/living motion, very faithful to source',
    cfg_1: 1.0, cfg_2: 1.0, max_shift: 2.05, base_shift: 0.95, terminal: 0.1,
    sampler_1: 'euler_ancestral', sampler_2: 'euler_ancestral', image_strength: 1.0,
  },
  gentle_wind: {
    desc: 'Soft environmental motion like gentle breeze',
    cfg_1: 1.0, cfg_2: 1.0, max_shift: 1.8, base_shift: 0.85, terminal: 0.08,
    sampler_1: 'euler', sampler_2: 'euler', image_strength: 1.0,
  },
  dreamy_drift: {
    desc: 'Dreamlike subtle movement, very smooth',
    cfg_1: 0.8, cfg_2: 0.8, max_shift: 2.2, base_shift: 1.0, terminal: 0.12,
    sampler_1: 'euler', sampler_2: 'euler', image_strength: 1.0,
  },
  natural_motion: {
    desc: 'Realistic natural movement, balanced',
    cfg_1: 1.2, cfg_2: 1.0, max_shift: 2.0, base_shift: 0.9, terminal: 0.1,
    sampler_1: 'euler_ancestral', sampler_2: 'euler_ancestral', image_strength: 0.95,
  },
  vivid_action: {
    desc: 'More dynamic motion, slightly more creative',
    cfg_1: 1.5, cfg_2: 1.0, max_shift: 2.1, base_shift: 0.95, terminal: 0.1,
    sampler_1: 'euler_ancestral', sampler_2: 'euler_ancestral', image_strength: 0.9,
  },
  soft_focus: {
    desc: 'Soft, cinematic feel with gentle transitions',
    cfg_1: 0.9, cfg_2: 0.9, max_shift: 1.9, base_shift: 0.88, terminal: 0.09,
    sampler_1: 'euler', sampler_2: 'euler', image_strength: 1.0,
  },
  fluid_motion: {
    desc: 'Smooth, flowing movement like water or silk',
    cfg_1: 1.0, cfg_2: 1.0, max_shift: 2.3, base_shift: 1.05, terminal: 0.15,
    sampler_1: 'euler', sampler_2: 'euler', image_strength: 0.95,
  },
  tight_hold: {
    desc: 'Maximum image fidelity, minimal but precise movement',
    cfg_1: 0.8, cfg_2: 0.8, max_shift: 1.7, base_shift: 0.8, terminal: 0.06,
    sampler_1: 'euler', sampler_2: 'euler', image_strength: 1.0,
  },
  warm_glow: {
    desc: 'Warm, living quality with gentle light shifts',
    cfg_1: 1.1, cfg_2: 1.0, max_shift: 2.0, base_shift: 0.92, terminal: 0.1,
    sampler_1: 'euler_ancestral', sampler_2: 'euler', image_strength: 0.98,
  },
  dynamic_subtle: {
    desc: 'Balanced between faithful and interesting motion',
    cfg_1: 1.3, cfg_2: 1.0, max_shift: 2.15, base_shift: 0.98, terminal: 0.11,
    sampler_1: 'euler_ancestral', sampler_2: 'euler_ancestral', image_strength: 0.92,
  },
}

/** Apply an I2V parameter preset to a built LTX-2 I2V workflow. */
export function applyI2vPreset(wf: any, presetName: string): void {
  if (presetName === 'random') {
    const keys = Object.keys(I2V_PRESETS)
    presetName = keys[Math.floor(Math.random() * keys.length)]!
  }

  const preset = I2V_PRESETS[presetName]
  if (!preset) {
    console.warn(`[Workflow] Unknown I2V preset '${presetName}', skipping`)
    return
  }

  console.log(`[Workflow] Applying I2V preset '${presetName}': ${preset.desc}`)

  // First-pass CFGGuider (92:47)
  if (wf['92:47']) wf['92:47'].inputs.cfg = preset.cfg_1
  // Second-pass CFGGuider (92:82)
  if (wf['92:82']) wf['92:82'].inputs.cfg = preset.cfg_2
  // Scheduler (92:9)
  if (wf['92:9']) {
    wf['92:9'].inputs.max_shift = preset.max_shift
    wf['92:9'].inputs.base_shift = preset.base_shift
    wf['92:9'].inputs.terminal = preset.terminal
  }
  // First-pass sampler (92:8)
  if (wf['92:8']) wf['92:8'].inputs.sampler_name = preset.sampler_1
  // Second-pass sampler (92:66)
  if (wf['92:66']) wf['92:66'].inputs.sampler_name = preset.sampler_2
  // Image strength override (92:121)
  if (wf['92:121']) wf['92:121'].inputs.strength = preset.image_strength
}

// =============================================================================
// Model-to-Builder Dispatch
// =============================================================================

/**
 * Build a workflow by model name + action. Convenience dispatcher.
 */
export function buildWorkflow(
  action: string,
  model: string,
  params: Record<string, any>,
): any {
  switch (action) {
    case 'text2image':
      return buildText2ImageByModel(model, params)
    case 'image2image':
      return buildImage2ImageByModel(model, params)
    case 'text2video':
      return buildText2VideoByModel(model, params)
    case 'image2video':
      return buildImage2VideoByModel(model, params)
    case 'upscale':
      return buildUpscaleWorkflow(params as UpscaleOptions)
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

function buildText2ImageByModel(model: string, p: Record<string, any>) {
  const opts: Text2ImageOptions = {
    prompt: p.prompt,
    negativePrompt: p.negative_prompt,
    width: p.width,
    height: p.height,
    steps: p.steps,
    cfg: p.cfg,
    seed: p.seed,
    loraStrength: p.lora_strength,
    samplerName: p.sampler_name,
    scheduler: p.scheduler,
    customLoras: p.custom_loras,
  }
  switch (model) {
    case 'wan22': return buildText2ImageWorkflow(opts)
    case 'qwen_image': return buildQwenImageWorkflow(opts)
    case 'qwen_lora': return buildQwenLoraWorkflow(opts)
    case 'flux2_dev': return buildFlux2Text2ImageWorkflow({ ...opts, turbo: false })
    case 'flux2_turbo': return buildFlux2Text2ImageWorkflow({ ...opts, turbo: true })
    case 'z_image': return buildZImageWorkflow(opts)
    case 'z_image_turbo': return buildZImageTurboWorkflow(opts)
    case 'juggernaut': return buildJuggernautWorkflow(opts)
    case 'cyberrealistic_pony': return buildCyberrealisticWorkflow({ ...opts, loraName: p.lora_name })
    case 'epicrealism': return buildEpicRealismWorkflow(opts)
    case 'hyperbeast': return buildHyperBeastWorkflow(opts)
    case 'nsfw_sdxl': return buildNsfwSdxlWorkflow(opts)
    case 'porn_craft': return buildPornCraftWorkflow(opts)
    default: return buildText2ImageWorkflow(opts)
  }
}

function buildImage2ImageByModel(model: string, p: Record<string, any>) {
  const opts: Image2ImageOptions = {
    imageFilename: p.image_filename,
    prompt: p.prompt,
    negativePrompt: p.negative_prompt,
    width: p.width,
    height: p.height,
    steps: p.steps,
    cfg: p.cfg,
    shift: p.shift,
    denoise: p.denoise,
    seed: p.seed,
  }
  switch (model) {
    case 'flux2_turbo': return buildFlux2TurboI2iWorkflow(opts)
    default: return buildImage2ImageWorkflow(opts)
  }
}

function buildText2VideoByModel(model: string, p: Record<string, any>) {
  const opts: Text2VideoOptions = {
    prompt: p.prompt,
    negativePrompt: p.negative_prompt,
    width: p.width,
    height: p.height,
    frames: p.frames,
    steps: p.steps,
    seed: p.seed,
    loraStrength: p.lora_strength,
    fps: p.fps,
    cameraLora: p.camera_lora,
    audioPrompt: p.audio_prompt,
  }
  switch (model) {
    case 'ltx2': return buildLtx2T2vWorkflow(opts)
    default: return buildText2VideoWorkflow(opts)
  }
}

function buildImage2VideoByModel(model: string, p: Record<string, any>) {
  const opts: Image2VideoOptions = {
    imageFilename: p.image_filename,
    prompt: p.prompt,
    negativePrompt: p.negative_prompt,
    width: p.width,
    height: p.height,
    frames: p.frames,
    steps: p.steps,
    seed: p.seed,
    fps: p.fps,
    loraStrength: p.lora_strength,
    imageStrength: p.image_strength,
    cameraLora: p.camera_lora,
    audioPrompt: p.audio_prompt,
    preset: p.preset,
    cfg: p.cfg,
    shift: p.shift,
    upscale: p.upscale,
    model: model,
  }
  switch (model) {
    case 'ltx2': return buildLtx2I2vWorkflow(opts)
    default: return buildImage2VideoWorkflow(opts)
  }
}
