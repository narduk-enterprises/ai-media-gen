/**
 * Shared video defaults — presets, constants, and reactive video settings factory.
 * Eliminates duplication across CreateTextToVideoTab, CreateImageToVideoTab, and CreateAutoVideoTab.
 */

// ─── Preset Constants ────────────────────────────────────────

export const DIRECTION_PRESETS = [
  { label: '🎬 Cinematic', prompt: 'Cinematic motion, smooth camera movements, dramatic lighting, film grain' },
  { label: '🎵 Music Video', prompt: 'Dynamic cuts, vibrant colors, rhythmic camera movement, music video energy' },
  { label: '🌊 Dreamy', prompt: 'Ethereal, slow motion, soft focus transitions, dreamlike atmosphere' },
  { label: '🎥 Documentary', prompt: 'Naturalistic, handheld camera, candid moments, observational style' },
  { label: '⚡ Action', prompt: 'Fast-paced, dynamic tracking shots, intense movement, high energy' },
  { label: '🌅 Timelapse', prompt: 'Slow timelapse feel, gradual changes in lighting, clouds moving, passage of time' },
] as const

export const AUDIO_PRESETS = [
  { label: '🎵 Upbeat', prompt: 'upbeat electronic music, positive energy, rhythmic beats' },
  { label: '🎻 Orchestral', prompt: 'cinematic orchestral score, strings, dramatic crescendo' },
  { label: '🌿 Ambient', prompt: 'ambient nature sounds, gentle wind, birds chirping, peaceful' },
  { label: '🔇 Silent', prompt: '' },
  { label: '🏙️ Urban', prompt: 'city ambience, distant traffic, footsteps, urban atmosphere' },
  { label: '🌊 Ocean', prompt: 'ocean waves crashing, seagulls, coastal breeze, water sounds' },
] as const

export const RESOLUTION_PRESETS = [
  { label: '768×512', w: 768, h: 512, tag: 'Fast' },
  { label: '1280×720', w: 1280, h: 720, tag: 'HD' },
  { label: '512×768', w: 512, h: 768, tag: 'Portrait' },
  { label: '720×1280', w: 720, h: 1280, tag: 'HD Port.' },
  { label: '768×768', w: 768, h: 768, tag: 'Square' },
] as const

export const FIDELITY_PRESETS = [
  { label: 'Creative', value: 0.7 },
  { label: 'Balanced', value: 0.85 },
  { label: 'Faithful', value: 0.95 },
  { label: 'Exact', value: 1.0 },
] as const

export const DEFAULT_NEGATIVE_PROMPT = 'worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo'

// ─── I2V Workflow Presets (matched with workflow_loader.py) ──

export const I2V_PRESETS = [
  // Research-backed quality presets
  { key: 'quality_res2s', label: '🏆 Quality (res2s)', desc: 'Official best: res2_s + LoRA 0.60', color: 'yellow' },
  { key: 'quality_euler', label: '🎯 Quality (Euler)', desc: 'High quality euler + LoRA 0.80', color: 'lime' },
  { key: 'photorealistic', label: '📸 Photorealistic', desc: 'Optimized for photorealism, higher CFG', color: 'sky' },
  { key: 'max_fidelity', label: '💎 Max Fidelity', desc: 'Maximum quality, slow, best for hero shots', color: 'indigo' },
  // Motion-focused presets
  { key: 'cinematic_breathe', label: '🎬 Cinematic Breathe', desc: 'Subtle breathing/living motion, very faithful', color: 'violet' },
  { key: 'gentle_wind', label: '🌿 Gentle Wind', desc: 'Soft environmental motion, gentle breeze', color: 'emerald' },
  { key: 'dreamy_drift', label: '🌊 Dreamy Drift', desc: 'Dreamlike subtle movement, very smooth', color: 'blue' },
  { key: 'natural_motion', label: '🌲 Natural Motion', desc: 'Realistic natural movement, balanced', color: 'green' },
  { key: 'vivid_action', label: '⚡ Vivid Action', desc: 'More dynamic motion, slightly creative', color: 'amber' },
  { key: 'soft_focus', label: '📷 Soft Focus', desc: 'Soft cinematic feel, gentle transitions', color: 'rose' },
  { key: 'fluid_motion', label: '💧 Fluid Motion', desc: 'Smooth, flowing like water or silk', color: 'cyan' },
  { key: 'tight_hold', label: '🔒 Tight Hold', desc: 'Max fidelity, minimal but precise motion', color: 'slate' },
  { key: 'warm_glow', label: '🔥 Warm Glow', desc: 'Warm living quality, gentle light shifts', color: 'orange' },
  { key: 'dynamic_subtle', label: '✨ Dynamic Subtle', desc: 'Balanced between faithful and interesting', color: 'purple' },
] as const

/** Motion-only subset (excludes the 4 quality-focused presets) */
export const I2V_MOTION_PRESETS = I2V_PRESETS.filter(p =>
  !['quality_res2s', 'quality_euler', 'photorealistic', 'max_fidelity'].includes(p.key)
)

// ─── Reactive Video Settings Factory ─────────────────────────

export function useVideoSettings(defaults?: {
  steps?: number
  numFrames?: number
  width?: number
  height?: number
  imageStrength?: number
  fps?: number
  cfg?: number
  seed?: number
}) {
  const steps = ref(defaults?.steps ?? 20)
  const numFrames = ref(defaults?.numFrames ?? 241)
  const width = ref(defaults?.width ?? 768)
  const height = ref(defaults?.height ?? 512)
  const imageStrength = ref(defaults?.imageStrength ?? 1.0)
  const fps = ref(defaults?.fps ?? 24)
  const cfg = ref(defaults?.cfg ?? 3.5)
  const seed = ref(defaults?.seed ?? -1)
  const loraStrength = ref(1.0)

  const negativePrompt = ref(DEFAULT_NEGATIVE_PROMPT)
  const audioPrompt = ref('')
  const basePrompt = ref('')

  return {
    steps, numFrames, width, height, imageStrength,
    fps, cfg, seed, loraStrength,
    negativePrompt, audioPrompt, basePrompt,
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Pick a random audio preset (excluding Silent) and return its prompt */
export function randomAudioPrompt(): string {
  const withAudio = AUDIO_PRESETS.filter(p => p.prompt)
  const pick = withAudio[Math.floor(Math.random() * withAudio.length)]
  return pick?.prompt ?? ''
}
