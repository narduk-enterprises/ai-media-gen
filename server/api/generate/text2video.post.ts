import { z } from 'zod'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

const text2videoSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().optional().default(''),
  width: z.number().min(256).max(1280).optional().default(832),
  height: z.number().min(256).max(1280).optional().default(480),
  numFrames: z.number().min(41).max(201).optional().default(81),
  steps: z.number().min(1).max(20).optional().default(4),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = text2videoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, width, height, numFrames, steps, endpoint } = parsed.data
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
      },
    }),
    createdAt: now,
  })

  console.log(`[T2V] Item queued: ${videoId.slice(0, 8)}`)

  return {
    generation: { id: genId, prompt, imageCount: 1, status: 'processing', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: 'queued', url: null },
  }
})
