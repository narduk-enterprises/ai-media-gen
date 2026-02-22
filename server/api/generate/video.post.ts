import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { useMediaBucket, readBase64FromR2 } from '../../utils/r2'
import { mediaItems, generations } from '../../database/schema'

const videoSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
  model: z.enum(['wan22', 'ltx2']).optional().default('wan22'),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional().default(''),
  numFrames: z.number().min(41).max(721).optional(),
  steps: z.number().min(1).max(50).optional(),
  cfg: z.number().min(1).max(10).optional(),
  width: z.number().min(256).max(1920).optional(),
  height: z.number().min(256).max(1920).optional(),
  fps: z.number().min(8).max(50).optional(),
  loraStrength: z.number().min(0).max(2).optional(),
  imageStrength: z.number().min(0).max(1).optional(),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = videoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId, model, prompt: customPrompt, negativePrompt, numFrames, steps, cfg, width, height, fps, loraStrength, imageStrength, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)
  const db = useDatabase()

  // Fetch media item
  const [sourceItem] = await db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1)

  if (!sourceItem) {
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  // Verify user owns this generation
  const [gen] = await db.select().from(generations).where(eq(generations.id, sourceItem.generationId)).limit(1)

  if (!gen || gen.userId !== user.id) {
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  if (sourceItem.type !== 'image' || !sourceItem.url) {
    throw createError({ statusCode: 400, message: 'Source must be a completed image' })
  }

  // Read source image as base64 — supports both R2 paths and legacy data URIs
  let imageBase64: string | null = null
  const base64Match = sourceItem.url.match(/^data:image\/\w+;base64,(.+)$/)
  if (base64Match) {
    imageBase64 = base64Match[1]!
  } else {
    const bucket = useMediaBucket(event)
    if (bucket) {
      imageBase64 = await readBase64FromR2(bucket, mediaItemId)
    }
  }

  if (!imageBase64) {
    throw createError({ statusCode: 400, message: 'Could not read source image data' })
  }

  const prompt = customPrompt || gen.prompt || ''
  const now = new Date().toISOString()

  const videoId = crypto.randomUUID()

  // Build model-specific input payload
  const isLtx2 = model === 'ltx2'
  const inputPayload: Record<string, any> = {
    action: 'image2video',
    model,
    prompt,
    negative_prompt: negativePrompt,
    image: imageBase64,
    width: width || (isLtx2 ? 1280 : 768),
    height: height || (isLtx2 ? 720 : 768),
    num_frames: numFrames || (isLtx2 ? 121 : 81),
    steps: steps || 20,
  }
  if (isLtx2) {
    inputPayload.fps = fps || 24
    inputPayload.lora_strength = loraStrength ?? 0.7
    inputPayload.image_strength = imageStrength ?? 1.0
    if (body.preset) inputPayload.preset = body.preset
    if (body.audioPrompt) inputPayload.audio_prompt = body.audioPrompt
    if (body.cameraLora) inputPayload.camera_lora = body.cameraLora
  } else {
    inputPayload.cfg = cfg || 3.5
  }

  // Insert as 'queued'
  await db.insert(mediaItems).values({
    id: videoId,
    generationId: sourceItem.generationId,
    type: 'video',
    parentId: mediaItemId,
    prompt,
    status: 'queued',
    metadata: JSON.stringify({ comfyInput: inputPayload }),
    createdAt: now,
  })

  console.log(`[I2V] Item queued: ${videoId.slice(0, 8)}`)

  // Submit to ComfyUI in background
  waitUntil(submitItemToComfyUI(db, videoId))

  return {
    item: {
      id: videoId,
      generationId: sourceItem.generationId,
      type: 'video',
      parentId: mediaItemId,
      runpodJobId: null,
      status: 'queued',
      url: null,
    },
  }
})
