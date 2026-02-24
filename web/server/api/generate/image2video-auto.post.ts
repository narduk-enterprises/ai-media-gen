import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPod } from '../../utils/ai'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { useMediaBucket, readBase64FromR2 } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

const autoVideoSchema = z.object({
  image: z.string().min(100).optional(),
  mediaItemId: z.string().uuid().optional(),
  basePrompt: z.string().optional().default(''),
  audioPrompt: z.string().optional().default(''),
  negativePrompt: z.string().optional().default(''),
  count: z.number().min(1).max(10).optional().default(1),
  steps: z.number().min(1).max(50).optional().default(20),
  numFrames: z.number().min(25).max(721).optional().default(241),
  width: z.number().min(256).max(1920).optional().default(1280),
  height: z.number().min(256).max(1080).optional().default(720),
  fps: z.number().min(8).max(50).optional().default(24),
  loraStrength: z.number().min(0).max(2).optional().default(1.0),
  imageStrength: z.number().min(0).max(1).optional().default(1.0),
  endpoint: z.string().optional(),
}).refine(d => d.image || d.mediaItemId, { message: 'Either image (base64) or mediaItemId is required' })

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = autoVideoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId, basePrompt, audioPrompt, negativePrompt, count, steps, numFrames, width, height, fps, loraStrength, imageStrength, endpoint } = parsed.data
  let image = parsed.data.image || ''

  // If mediaItemId provided, read image from R2 and get the original prompt
  let originalPrompt = ''
  if (mediaItemId && !image) {
    const db = useDatabase()
    const item = await db.select({ url: mediaItems.url, prompt: mediaItems.prompt }).from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get()
    if (!item?.url) throw createError({ statusCode: 404, message: 'Image not found' })
    originalPrompt = item.prompt || ''

    const base64Match = item.url.match(/^data:image\/\w+;base64,(.+)$/)
    if (base64Match) {
      image = base64Match[1]!
    } else {
      const bucket = useMediaBucket(event)
      if (bucket) {
        image = await readBase64FromR2(bucket, mediaItemId) || ''
      }
    }
  }

  if (!image) throw createError({ statusCode: 400, message: 'Image is required' })
  const apiUrl = await resolveApiUrl(endpoint, 'video')
  const db = useDatabase()
  const now = new Date().toISOString()

  // Create parent generation record
  const genId = crypto.randomUUID()
  await db.insert(generations).values({
    id: genId,
    userId: user.id,
    prompt: basePrompt || 'Auto video from image',
    imageCount: count,
    status: 'processing',
    createdAt: now,
  })

  console.log(`[AutoVideo] Starting pipeline for gen ${genId.slice(0, 8)}, count=${count}`)

  try {
    // ── Phase 1: Call pod synchronously for caption + prompt generation ──
    const captionInput = {
      action: 'image2video_auto',
      image,
      base_prompt: basePrompt,
      original_prompt: originalPrompt,
      audio_prompt: audioPrompt,
      negative_prompt: negativePrompt,
      count,
      steps,
      num_frames: numFrames,
      width, height, fps,
      lora_strength: loraStrength,
    }

    const result = await callRunPod(captionInput, apiUrl)

    if (result.error) {
      await db.update(generations).set({ status: 'failed' }).where(eq(generations.id, genId))
      throw createError({ statusCode: 500, message: result.error })
    }

    const rawOutput = result.output || {}
    const output = rawOutput.output || rawOutput
    const prompts: string[] = output.prompts || []
    const caption: string = output.caption || ''

    if (prompts.length === 0) {
      await db.update(generations).set({ status: 'failed' }).where(eq(generations.id, genId))
      throw createError({ statusCode: 500, message: 'No prompts generated' })
    }

    // ── Phase 2: Submit each prompt as a proper async I2V job ──
    // This follows the same pattern as video.post.ts so the cron can track them
    const items: any[] = []
    for (const prompt of prompts) {
      const videoId = crypto.randomUUID()
      const i2vInput = {
        action: 'image2video' as const,
        model: 'ltx2',
        prompt,
        negative_prompt: negativePrompt,
        image,
        width, height,
        num_frames: numFrames,
        steps,
        fps,
        lora_strength: loraStrength,
        image_strength: imageStrength,
        audio_prompt: audioPrompt || undefined,
        preset: 'random',
      }

      await db.insert(mediaItems).values({
        id: videoId,
        generationId: genId,
        type: 'video',
        prompt,
        status: 'queued',
        metadata: JSON.stringify({ apiUrl, comfyInput: i2vInput, autoGenerated: true, caption }),
        createdAt: now,
      })

      items.push({
        id: videoId,
        generationId: genId,
        type: 'video',
        prompt,
        status: 'queued',
        runpodJobId: null,
        url: null,
      })
    }

    console.log(`[AutoVideo] ✅ ${items.length} items created for gen ${genId.slice(0, 8)}`)

    // Submit each job asynchronously in the background
   event.waitUntil((async () => {
      for (const item of items) {
        await submitItemToComfyUI(db, item.id)
      }
    })())

    return {
      generation: { id: genId, status: 'processing', imageCount: count },
      items,
      caption,
      prompts,
      timing: {
        captionSeconds: output.caption_seconds,
        promptSeconds: output.prompt_seconds,
        totalSeconds: output.elapsed_seconds,
      },
    }
  } catch (e: any) {
    if (e.statusCode) throw e
    console.error(`[AutoVideo] Pipeline error:`, e)
    await db.update(generations).set({ status: 'failed' }).where(eq(generations.id, genId))
    throw createError({ statusCode: 500, message: e.message || 'Auto video pipeline failed' })
  }
})
