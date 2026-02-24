import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { generations, mediaItems } from '../../database/schema'

const text2videoSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().optional().default(''),
  width: z.number().min(256).max(1280).optional().default(832),
  height: z.number().min(256).max(1280).optional().default(480),
  numFrames: z.number().min(41).max(721).optional().default(81),
  steps: z.number().min(1).max(50).optional().default(4),
  loraStrength: z.number().min(0).max(2).optional().default(1.0),
  model: z.enum(['wan22', 'ltx2']).optional().default('wan22'),
  seed: z.number().int().optional().default(-1),
  audioPrompt: z.string().optional().default(''),
  endpoint: z.string().optional(),
  // Optional: reuse an existing generation to group batch items together
  generationId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = text2videoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, width, height, numFrames, steps, loraStrength, model, seed, audioPrompt, endpoint, generationId } = parsed.data
  const apiUrl = await resolveApiUrl(endpoint, 'video')
  const db = useDatabase()
  const now = new Date().toISOString()

  // Either reuse existing generation or create a new one
  let genId: string
  if (generationId) {
    // Verify the generation belongs to this user
    const existing = await db.select({ id: generations.id }).from(generations)
      .where(eq(generations.id, generationId)).get()
    if (existing) {
      genId = generationId
      // Increment imageCount
      await db.update(generations)
        .set({ imageCount: sql`${generations.imageCount} + 1` })
        .where(eq(generations.id, genId))
    } else {
      // Generation not found — create a new one
      genId = crypto.randomUUID()
      const settings = JSON.stringify({ negativePrompt, model, steps, width, height, numFrames, loraStrength, seed, audioPrompt })
      await db.insert(generations).values({
        id: genId, userId: user.id, prompt,
        imageCount: 1, status: 'processing', settings, createdAt: now,
      })
    }
  } else {
    genId = crypto.randomUUID()
    const settings = JSON.stringify({ negativePrompt, model, steps, width, height, numFrames, loraStrength, seed, audioPrompt })
    await db.insert(generations).values({
      id: genId, userId: user.id, prompt,
      imageCount: 1, status: 'processing', settings, createdAt: now,
    })
  }

  const videoId = crypto.randomUUID()

  // Insert as 'queued' — the cron/background will submit
  const isLtx2 = model === 'ltx2'
  const inputPayload: Record<string, any> = {
    action: 'text2video',
    prompt,
    negative_prompt: negativePrompt,
    width, height,
    num_frames: numFrames,
    steps,
    lora_strength: loraStrength,
    model, seed,
    ...(audioPrompt ? { audio_prompt: audioPrompt } : {}),
    ...(body.cameraLora ? { camera_lora: body.cameraLora } : {}),
  }

  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, comfyInput: inputPayload }),
    createdAt: now,
  })

  console.log(`[T2V] Item queued: ${videoId.slice(0, 8)} → gen ${genId.slice(0, 8)}`)

  // Submit to ComfyUI in background
 event.waitUntil(submitItemToComfyUI(db, videoId))

  return {
    generation: { id: genId, prompt, imageCount: 1, status: 'processing', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: 'queued', url: null },
  }
})
