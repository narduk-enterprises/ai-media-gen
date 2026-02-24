import { z } from 'zod'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { generations, mediaItems } from '../../database/schema'

const segmentSchema = z.object({
  prompt: z.string().min(1),
  image: z.string().optional(),
  frames: z.number().min(25).max(721).optional(),
  steps: z.number().min(1).max(50).optional(),
  seed: z.number().optional(),
  camera_lora: z.string().optional(),
  preset: z.string().optional(),
})

const bodySchema = z.object({
  segments: z.array(segmentSchema).min(1).max(20),
  targetDuration: z.number().min(5).max(120).optional().default(30),
  audioPrompt: z.string().optional().default(''),
  negativePrompt: z.string().optional().default(''),
  model: z.enum(['ltx2', 'wan22']).optional().default('ltx2'),
  width: z.number().min(256).max(1920).optional().default(1280),
  height: z.number().min(256).max(1920).optional().default(720),
  fps: z.number().min(8).max(60).optional().default(24),
  steps: z.number().min(1).max(50).optional().default(20),
  loraStrength: z.number().min(0).max(2).optional().default(0.7),
  imageStrength: z.number().min(0).max(1).optional().default(1.0),
  preset: z.string().optional().default(''),
  transition: z.enum(['crossfade', 'cut']).optional().default('crossfade'),
  transitionDuration: z.number().min(0).max(2).optional().default(0.5),
  characterMode: z.enum(['shared_hero', 'independent', 'chain_last_frame']).optional().default('shared_hero'),
  characterPrompt: z.string().optional().default(''),
  heroImage: z.string().optional().default(''),
  endpoint: z.string().optional(),
})

/**
 * POST /api/generate/multi-image-video
 *
 * Universal multi-shot video generator. Each segment can be:
 * - prompt only → T2V (text-to-video generation)
 * - prompt + image → I2V (image-to-video, real AI motion from the image)
 * - prompt + "auto" image → uses last frame of previous segment
 *
 * All clips get full AI generation (not a slideshow), then stitched into
 * one seamless video with audio. Accepts raw JSON for easy automation.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const {
    segments: inputSegments, targetDuration, audioPrompt, negativePrompt,
    model, width, height, fps, steps: globalSteps, loraStrength, imageStrength,
    preset: globalPreset, transition, transitionDuration,
    characterMode, characterPrompt, heroImage, endpoint,
  } = parsed.data

  const apiUrl = await resolveApiUrl(endpoint, 'video')
  const db = useDatabase()
  const now = new Date().toISOString()

  const numSegments = inputSegments.length
  const isLtx2 = model === 'ltx2'

  // Auto-distribute frames to hit target duration (unless segments specify their own)
  const overlapFrames = transition === 'crossfade'
    ? Math.round(transitionDuration * fps * Math.max(0, numSegments - 1))
    : 0
  const totalFramesNeeded = Math.round(targetDuration * fps) + overlapFrames
  const rawPerSegment = Math.round(totalFramesNeeded / numSegments)
  const autoFrames = isLtx2
    ? Math.max(33, Math.round((rawPerSegment - 1) / 8) * 8 + 1)
    : Math.max(41, rawPerSegment)

  // Build segments for the GPU pod's multi-segment pipeline
  const segments = inputSegments.map((seg, i) => {
    const hasImage = seg.image && seg.image !== 'auto' && seg.image.length > 100
    const isAuto = seg.image === 'auto'
    return {
      type: hasImage ? 'image2video' : (isAuto ? 'image2video' : 'text2video'),
      prompt: seg.prompt,
      frames: seg.frames || autoFrames,
      steps: seg.steps || globalSteps,
      seed: seg.seed ?? -1,
      ...(hasImage ? { image: seg.image } : {}),
      ...(isAuto ? { image: 'auto' } : {}),
      ...(seg.camera_lora ? { camera_lora: seg.camera_lora } : {}),
      ...(seg.preset || globalPreset ? { preset: seg.preset || globalPreset } : {}),
    }
  })

  const actualTotalFrames = segments.reduce((sum, s) => sum + s.frames, 0)
  const effectiveDuration = Math.round((actualTotalFrames - overlapFrames) / fps * 10) / 10

  const comfyInput: Record<string, any> = {
    action: 'multi_segment_video',
    model,
    width,
    height,
    transition,
    transition_duration: transitionDuration,
    character_mode: characterMode,
    segments,
  }

  if (characterPrompt) comfyInput.character_prompt = characterPrompt
  if (heroImage) comfyInput.hero_image = heroImage

  if (isLtx2) {
    comfyInput.fps = fps
    comfyInput.lora_strength = loraStrength
    comfyInput.image_strength = imageStrength
    if (audioPrompt) comfyInput.audio_prompt = audioPrompt
  }
  if (negativePrompt) comfyInput.negative_prompt = negativePrompt

  const genId = crypto.randomUUID()
  const videoId = crypto.randomUUID()
  const firstPrompt = inputSegments[0]!.prompt
  const promptLabel = firstPrompt.slice(0, 80) + (firstPrompt.length > 80 ? '...' : '')

  await db.insert(generations).values({
    id: genId,
    userId: user.id,
    prompt: `${numSegments}-shot (~${targetDuration}s): ${promptLabel}`,
    imageCount: 1,
    status: 'processing',
    createdAt: now,
  })

  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt: promptLabel,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, comfyInput }),
    createdAt: now,
  })

  const t2vCount = segments.filter(s => s.type === 'text2video').length
  const i2vCount = segments.filter(s => s.type === 'image2video').length
  console.log(`[MultiVideo] Queued ${numSegments}-shot video (~${effectiveDuration}s): ${videoId.slice(0, 8)} [${t2vCount} T2V, ${i2vCount} I2V]`)

 event.waitUntil(submitItemToComfyUI(db, videoId))

  return {
    generation: { id: genId, prompt: promptLabel, imageCount: 1, status: 'processing', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: 'queued', url: null },
    meta: { numSegments, autoFrames, effectiveDuration, t2vCount, i2vCount },
  }
})
