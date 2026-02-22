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
