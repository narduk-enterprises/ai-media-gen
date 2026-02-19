import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { callRunPodAsync, resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'
import { backgroundComplete } from '../../utils/backgroundComplete'
import { useMediaBucket } from '../../utils/r2'

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
  let jobId: string | null = null

  try {
    const result = await callRunPodAsync({
      action: 'text2video',
      prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      num_frames: numFrames,
      steps,
    }, apiUrl)
    jobId = result.jobId
    console.log(`[T2V] Submitted job ${jobId}`)
  } catch (error: any) {
    console.error(`[T2V] Submit failed:`, error.message)
  }

  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt,
    runpodJobId: jobId,
    status: jobId ? 'processing' : 'failed',
    error: jobId ? null : 'Failed to submit to RunPod',
    metadata: JSON.stringify({ apiUrl }),
    createdAt: now,
  })

  if (!jobId) {
    await db.update(generations).set({ status: 'failed' }).where(eq(generations.id, genId))
  }

  // Background completion — server keeps polling even if frontend disconnects
  if (jobId) {
    const cf = (event.context as any).cloudflare
    const mediaBucket = useMediaBucket(event)
    if (cf?.context?.waitUntil) {
      console.log(`[T2V] Scheduling background completion via waitUntil`)
      cf.context.waitUntil(backgroundComplete(db, mediaBucket, [videoId]))
    }
  }

  return {
    generation: { id: genId, prompt, imageCount: 1, status: jobId ? 'processing' : 'failed', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: jobId ? 'processing' : 'failed', url: null },
  }
})
