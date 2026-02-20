import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPodAsync } from '../../utils/ai'
import { useMediaBucket, readBase64FromR2 } from '../../utils/r2'
import { mediaItems, generations } from '../../database/schema'

const videoSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
  model: z.enum(['wan22', 'ltx2']).optional().default('wan22'),
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

  const { mediaItemId, model, numFrames, steps, cfg, width, height, fps, loraStrength, imageStrength, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)
  const db = useDatabase()

  const source = await db
    .select()
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(and(eq(mediaItems.id, mediaItemId), eq(generations.userId, user.id)))
    .limit(1)

  if (!source[0]) {
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  const sourceItem = source[0].media_items
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

  const gen = source[0].generations
  const prompt = gen.prompt || ''
  const now = new Date().toISOString()

  const videoId = crypto.randomUUID()

  // Build model-specific RunPod input
  const isLtx2 = model === 'ltx2'
  const runpodInput: Record<string, any> = {
    action: 'image2video',
    model,
    prompt,
    image: imageBase64,
    width: width || (isLtx2 ? 768 : 768),
    height: height || (isLtx2 ? 432 : 768),
    num_frames: numFrames || (isLtx2 ? 121 : 81),
    steps: steps || 20,
  }
  if (isLtx2) {
    runpodInput.fps = fps || 24
    runpodInput.lora_strength = loraStrength ?? 0.7
    runpodInput.image_strength = imageStrength ?? 1.0
  } else {
    runpodInput.cfg = cfg || 3.5
  }

  // Insert as 'queued' — the cron will submit to RunPod
  await db.insert(mediaItems).values({
    id: videoId,
    generationId: sourceItem.generationId,
    type: 'video',
    parentId: mediaItemId,
    prompt,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, runpodInput }),
    createdAt: now,
  })

  console.log(`[I2V] Item queued: ${videoId.slice(0, 8)}`)

  // Submit to RunPod in background — response returns immediately
  waitUntil((async () => {
    try {
      const meta = { apiUrl, runpodInput }
      const result = await callRunPodAsync(runpodInput, apiUrl)
      await db.update(mediaItems)
        .set({
          status: 'processing',
          runpodJobId: result.jobId,
          submittedAt: new Date().toISOString(),
          metadata: JSON.stringify({ ...meta, apiUrl: result.apiUrl }),
        })
        .where(eq(mediaItems.id, videoId))
      console.log(`[I2V] ✅ Submitted ${videoId.slice(0, 8)} → job ${result.jobId}`)
    } catch (e: any) {
      console.warn(`[I2V] ⚠️ Submit failed for ${videoId.slice(0, 8)}, cron will retry:`, e.message)
    }
  })())

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
