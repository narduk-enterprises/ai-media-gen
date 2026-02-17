import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generateImages } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().default(''),
  count: z.number().int().min(1).max(16).default(1),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = generateSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, count, steps, width, height } = parsed.data
  const db = useDatabase()
  const generationId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Create generation record
  await db.insert(generations).values({
    id: generationId,
    userId: user.id,
    prompt,
    imageCount: count,
    status: 'processing',
    createdAt: now,
  })

  // Create placeholder media items
  const itemIds: string[] = []
  for (let i = 0; i < count; i++) {
    const itemId = crypto.randomUUID()
    itemIds.push(itemId)
    await db.insert(mediaItems).values({
      id: itemId,
      generationId,
      type: 'image',
      status: 'processing',
      createdAt: now,
    })
  }

  // Generate images (mock or real API)
  try {
    const result = await generateImages(prompt, count, { negativePrompt, steps, width, height })

    // Update media items with image data
    for (let i = 0; i < result.images.length && i < itemIds.length; i++) {
      const img = result.images[i]!
      const url = `data:image/png;base64,${img.data}`
      await db.update(mediaItems)
        .set({ url, status: 'complete' })
        .where(eq(mediaItems.id, itemIds[i]!))
    }

    // Mark generation complete
    await db.update(generations)
      .set({ status: 'complete' })
      .where(eq(generations.id, generationId))

  } catch (error: any) {
    // Mark failed
    await db.update(generations)
      .set({ status: 'failed', error: error.message })
      .where(eq(generations.id, generationId))

    for (const itemId of itemIds) {
      await db.update(mediaItems)
        .set({ status: 'failed', error: error.message })
        .where(eq(mediaItems.id, itemId))
    }
  }

  // Return generation with items
  const gen = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1)
  const items = await db.select().from(mediaItems).where(eq(mediaItems.generationId, generationId))

  return {
    generation: gen[0],
    items,
  }
})
