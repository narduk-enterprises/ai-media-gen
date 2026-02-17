import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generateAudio } from '../../utils/ai'
import { mediaItems, generations } from '../../database/schema'

const audioSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
  prompt: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = audioSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId, prompt } = parsed.data
  const db = useDatabase()

  // Verify source media belongs to user
  const source = await db
    .select()
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(and(eq(mediaItems.id, mediaItemId), eq(generations.userId, user.id)))
    .limit(1)

  if (!source[0]) {
    throw createError({ statusCode: 404, message: 'Media item not found' })
  }

  const sourceItem = source[0].media_items
  if (!sourceItem.url) {
    throw createError({ statusCode: 400, message: 'Source must be a completed media item' })
  }

  // Create audio media item
  const audioId = crypto.randomUUID()
  await db.insert(mediaItems).values({
    id: audioId,
    generationId: sourceItem.generationId,
    type: 'audio',
    parentId: mediaItemId,
    status: 'processing',
    createdAt: new Date().toISOString(),
  })

  // Generate audio
  try {
    const result = await generateAudio(prompt, sourceItem.url)
    await db.update(mediaItems)
      .set({ url: result.url, status: result.status })
      .where(eq(mediaItems.id, audioId))
  } catch (error: any) {
    await db.update(mediaItems)
      .set({ status: 'failed', error: error.message })
      .where(eq(mediaItems.id, audioId))
  }

  const item = await db.select().from(mediaItems).where(eq(mediaItems.id, audioId)).limit(1)
  return { item: item[0] }
})
