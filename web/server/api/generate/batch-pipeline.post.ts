import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems, users } from '../../database/schema'

const BATCH_KEY = 'overnight-batch-2026'

const schema = z.object({
  mode: z.enum(['pipeline', 't2v']).optional().default('pipeline'),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional().default(''),
  width: z.number().optional().default(832),
  height: z.number().optional().default(480),
  steps: z.number().optional().default(30),
  cfg: z.number().optional().default(5.0),
  seed: z.number().optional().default(-1),
  // Pipeline (T2I→I2V) fields
  imageModel: z.string().optional().default('cyberrealistic_pony'),
  videoPrompt: z.string().optional().default(''),
  videoModel: z.string().optional().default('wan22'),
  videoSteps: z.number().optional().default(20),
  videoFrames: z.number().optional().default(241),
  videoFps: z.number().optional().default(16),
  loraName: z.string().optional(),
  loraStrength: z.number().optional().default(0.7),
  // T2V fields
  numFrames: z.number().optional().default(81),
  model: z.string().optional().default('wan22'),
  audioPrompt: z.string().optional().default(''),
  endpoint: z.string().optional(),
  generationId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-batch-key')
  if (key !== BATCH_KEY) {
    throw createError({ statusCode: 401, message: 'Invalid batch key' })
  }

  const db = useDatabase()
  const batchUser = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, 'narduk@mac.com')).limit(1).get()
  if (!batchUser) {
    throw createError({ statusCode: 500, message: 'Batch user not found' })
  }

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const data = parsed.data
  const now = new Date().toISOString()

  // Create or reuse generation record
  let genId: string
  if (data.generationId) {
    const existing = await db.select({ id: generations.id }).from(generations)
      .where(eq(generations.id, data.generationId)).get()
    if (existing) {
      genId = data.generationId
      await db.update(generations)
        .set({ imageCount: sql`${generations.imageCount} + 1` })
        .where(eq(generations.id, genId))
    } else {
      genId = crypto.randomUUID()
      await db.insert(generations).values({
        id: genId, userId: batchUser.id, prompt: data.prompt,
        imageCount: 1, status: 'processing', createdAt: now,
      })
    }
  } else {
    genId = crypto.randomUUID()
    await db.insert(generations).values({
      id: genId, userId: batchUser.id, prompt: data.prompt,
      imageCount: 1, status: 'processing', createdAt: now,
    })
  }

  const videoId = crypto.randomUUID()

  // Build the appropriate payload based on mode
  let inputPayload: Record<string, any>

  if (data.mode === 't2v') {
    inputPayload = {
      action: 'text2video',
      prompt: data.prompt,
      negative_prompt: data.negativePrompt,
      width: data.width,
      height: data.height,
      num_frames: data.numFrames,
      steps: data.steps,
      model: data.model,
      seed: data.seed,
      ...(data.audioPrompt ? { audio_prompt: data.audioPrompt } : {}),
    }
  } else {
    inputPayload = {
      action: 'text2image_then_video',
      prompt: data.prompt,
      negative_prompt: data.negativePrompt,
      width: data.width,
      height: data.height,
      steps: data.steps,
      cfg: data.cfg,
      seed: data.seed,
      image_model: data.imageModel,
      video_prompt: data.videoPrompt || data.prompt,
      video_model: data.videoModel,
      video_steps: data.videoSteps,
      video_frames: data.videoFrames,
      video_fps: data.videoFps,
    }
    if (data.loraName) {
      inputPayload.lora_name = data.loraName
      inputPayload.lora_strength = data.loraStrength
    }
  }

  // Resolve the pod URL — from request body or env fallback
  const apiUrl = resolveApiUrl(data.endpoint, 'video')

  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt: data.prompt,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, comfyInput: inputPayload }),
    createdAt: now,
  })

  console.log(`[Batch ${data.mode}] Queued: ${videoId.slice(0, 8)} → gen ${genId.slice(0, 8)}`)

 event.waitUntil(submitItemToComfyUI(db, videoId))

  return {
    generation: { id: genId },
    item: { id: videoId, status: 'queued' },
  }
})
