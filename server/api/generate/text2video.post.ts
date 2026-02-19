import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPodAsync } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

const text2videoSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().optional().default(''),
  width: z.number().min(256).max(1280).optional().default(832),
  height: z.number().min(256).max(1280).optional().default(480),
  numFrames: z.number().min(41).max(201).optional().default(81),
  steps: z.number().min(1).max(20).optional().default(4),
  loraStrength: z.number().min(0).max(2).optional().default(1.0),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = text2videoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, width, height, numFrames, steps, loraStrength, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)
  const db = useDatabase()
  const now = new Date().toISOString()

  const genId = crypto.randomUUID()
  await db.insert(generations).values({
    id: genId,
    userId: user.id,
    prompt,
    imageCount: 1,
    status: 'processing',
    createdAt: now,
  })

  const videoId = crypto.randomUUID()

  // Insert as 'queued' — the cron will submit to RunPod
  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt,
    status: 'queued',
    metadata: JSON.stringify({
      apiUrl,
      runpodInput: {
        action: 'text2video',
        prompt,
        negative_prompt: negativePrompt,
        width,
        height,
        num_frames: numFrames,
        steps,
        lora_strength: loraStrength,
      },
    }),
    createdAt: now,
  })

  console.log(`[T2V] Item queued: ${videoId.slice(0, 8)}`)

  // Immediately submit to RunPod (fire-and-forget — cron is safety net)
  let submittedJobId: string | null = null
  try {
    const meta = { apiUrl, runpodInput: { action: 'text2video', prompt, negative_prompt: negativePrompt, width, height, num_frames: numFrames, steps, lora_strength: loraStrength } }
    const result = await callRunPodAsync(meta.runpodInput, apiUrl)
    await db.update(mediaItems)
      .set({
        status: 'processing',
        runpodJobId: result.jobId,
        submittedAt: new Date().toISOString(),
        metadata: JSON.stringify({ ...meta, apiUrl: result.apiUrl }),
      })
      .where(eq(mediaItems.id, videoId))
    submittedJobId = result.jobId
    console.log(`[T2V] ✅ Immediately submitted ${videoId.slice(0, 8)} → job ${result.jobId}`)
  } catch (e: any) {
    console.warn(`[T2V] ⚠️ Immediate submit failed for ${videoId.slice(0, 8)}, cron will retry:`, e.message)
  }

  return {
    generation: { id: genId, prompt, imageCount: 1, status: 'processing', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: 'queued', url: null },
  }
})
