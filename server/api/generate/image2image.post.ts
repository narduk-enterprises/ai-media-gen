import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPodAsync } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

const schema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().default(''),
  image: z.string().min(1, 'Image (base64) is required'),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
  cfg: z.number().min(1).max(20).default(3.5),
  denoise: z.number().min(0).max(1).default(0.75),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, image, steps, width, height, cfg, denoise, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)

  const db = useDatabase()
  const generationId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const now = new Date().toISOString()

  const settings = JSON.stringify({ negativePrompt, steps, width, height, cfg, denoise })

  await db.insert(generations).values({
    id: generationId,
    userId: user.id,
    prompt,
    imageCount: 1,
    status: 'processing',
    settings,
    createdAt: now,
  })

  const runpodInput = {
    action: 'image2image',
    prompt,
    negative_prompt: negativePrompt,
    image,
    width,
    height,
    steps,
    cfg,
    denoise,
  }

  await db.insert(mediaItems).values({
    id: itemId,
    generationId,
    type: 'image',
    prompt,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, runpodInput }),
    createdAt: now,
  })

  // Immediately submit to RunPod
  try {
    const result = await callRunPodAsync(runpodInput, apiUrl)
    await db.update(mediaItems)
      .set({
        status: 'processing',
        runpodJobId: result.jobId,
        submittedAt: new Date().toISOString(),
        metadata: JSON.stringify({ apiUrl: result.apiUrl, runpodInput }),
      })
      .where(eq(mediaItems.id, itemId))
    console.log(`[I2I] ✅ Submitted ${itemId.slice(0, 8)} → job ${result.jobId}`)
  } catch (e: any) {
    console.warn(`[I2I] ⚠️ Immediate submit failed, cron will retry:`, e.message)
  }

  return {
    generation: {
      id: generationId,
      prompt,
      imageCount: 1,
      status: 'processing',
      settings,
      createdAt: now,
    },
    items: [{
      id: itemId,
      generationId,
      type: 'image',
      prompt,
      runpodJobId: null,
      parentId: null,
      url: null,
      status: 'queued',
      error: null,
      metadata: null,
      createdAt: now,
    }],
  }
})
