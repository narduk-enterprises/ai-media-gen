import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generateText2Video } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

const text2videoSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().optional().default(''),
  width: z.number().min(256).max(1280).optional().default(640),
  height: z.number().min(256).max(1280).optional().default(640),
  numFrames: z.number().min(41).max(201).optional().default(81),
  steps: z.number().min(1).max(20).optional().default(4),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = text2videoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, width, height, numFrames, steps } = parsed.data
  const db = useDatabase()

  // Create generation record
  const genId = crypto.randomUUID()
  await db.insert(generations).values({
    id: genId,
    userId: user.id,
    prompt,
    imageCount: 1,
    status: 'processing',
    createdAt: new Date().toISOString(),
  })

  // Create video media item
  const videoId = crypto.randomUUID()
  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    status: 'processing',
    createdAt: new Date().toISOString(),
  })

  // Generate video in background — don't block the response
  generateText2Video(prompt, { width, height, numFrames, steps })
    .then(async (result) => {
      const url = result.data ? `data:video/mp4;base64,${result.data}` : null
      await db.update(mediaItems)
        .set({ url, status: result.status })
        .where(eq(mediaItems.id, videoId))
      await db.update(generations)
        .set({ status: 'complete' })
        .where(eq(generations.id, genId))
    })
    .catch(async (error: any) => {
      await db.update(mediaItems)
        .set({ status: 'failed', error: error.message })
        .where(eq(mediaItems.id, videoId))
      await db.update(generations)
        .set({ status: 'failed' })
        .where(eq(generations.id, genId))
    })

  return {
    generation: {
      id: genId,
      prompt,
      imageCount: 1,
      status: 'processing',
      createdAt: new Date().toISOString(),
    },
    item: {
      id: videoId,
      generationId: genId,
      type: 'video',
      status: 'processing',
      url: null,
    },
  }
})
