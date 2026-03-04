import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'



import { generations, mediaItems } from '../../database/schema'

const pipelineSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().optional().default(''),
  width: z.number().min(256).max(1920).optional().default(832),
  height: z.number().min(256).max(1920).optional().default(480),
  steps: z.number().min(1).max(50).optional().default(30),
  cfg: z.number().min(1).max(20).optional().default(5.0),
  seed: z.number().int().optional().default(-1),
  imageModel: z.enum(['cyberrealistic_pony', 'juggernaut', 'wan22', 'z_image', 'z_image_turbo', 'epicrealism', 'hyperbeast', 'nsfw_sdxl', 'porn_craft']).optional().default('cyberrealistic_pony'),
  samplerName: z.string().optional(),
  scheduler: z.string().optional(),
  videoPrompt: z.string().optional().default(''),
  videoModel: z.enum(['wan22', 'ltx2']).optional().default('wan22'),
  videoSteps: z.number().min(1).max(50).optional().default(20),
  videoFrames: z.number().min(25).max(721).optional().default(81),
  videoFps: z.number().min(8).max(50).optional().default(16),
  loraStrength: z.number().min(0).max(2).optional().default(1.0),
  imageStrength: z.number().min(0).max(1).optional().default(1.0),
  endpoint: z.string().optional(),
  generationId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = pipelineSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const data = parsed.data
  // Compute required model groups for model-aware routing
  const sampleInput = { action: 'text2image', model: data.imageModel, video_model: data.videoModel }
  const requiredGroups = getRequiredGroups(sampleInput)
  const apiUrl = await resolveApiUrl(data.endpoint, 'video', requiredGroups)
  const db = useDatabase(event)
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
        id: genId, userId: user.id, prompt: data.prompt,
        imageCount: 1, status: 'processing', createdAt: now,
      })
    }
  } else {
    genId = crypto.randomUUID()
    await db.insert(generations).values({
      id: genId, userId: user.id, prompt: data.prompt,
      imageCount: 1, status: 'processing', createdAt: now,
    })
  }

  const videoId = crypto.randomUUID()

  // Build the pod input — uses the text2image_then_video action
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  const inputPayload: Record<string, any> = {
    action: 'text2image_then_video',
    prompt: data.prompt,
    negative_prompt: data.negativePrompt,
    width: data.width,
    height: data.height,
    steps: data.steps,
    cfg: data.cfg,
    seed: data.seed,
    image_model: data.imageModel,
    sampler_name: data.samplerName,
    scheduler: data.scheduler,
    video_prompt: data.videoPrompt || data.prompt,
    video_model: data.videoModel,
    video_steps: data.videoSteps,
    video_frames: data.videoFrames,
    video_fps: data.videoFps,
    lora_strength: data.loraStrength,
    image_strength: data.imageStrength,
  }

  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt: data.prompt,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, comfyInput: inputPayload }),
    createdAt: now,
  })

  console.log(`[T2I→Video] Item queued: ${videoId.slice(0, 8)} → gen ${genId.slice(0, 8)}`)

 event.waitUntil(submitItemToComfyUI(db, videoId))

  return {
    generation: { id: genId, prompt: data.prompt, imageCount: 1, status: 'processing', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: 'queued', url: null },
  }
})
