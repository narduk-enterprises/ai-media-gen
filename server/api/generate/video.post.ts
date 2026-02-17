import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { generateVideo } from '../../utils/ai'
import { mediaItems, generations } from '../../database/schema'

const videoSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = videoSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId } = parsed.data
  const db = useDatabase()

  // Verify source image belongs to user
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

  // Create video media item
  const videoId = crypto.randomUUID()
  await db.insert(mediaItems).values({
    id: videoId,
    generationId: sourceItem.generationId,
    type: 'video',
    parentId: mediaItemId,
    status: 'processing',
    createdAt: new Date().toISOString(),
  })

  // Generate video
  try {
    const result = await generateVideo(sourceItem.url)
    await db.update(mediaItems)
      .set({ url: result.url, status: result.status })
      .where(eq(mediaItems.id, videoId))
  } catch (error: any) {
    await db.update(mediaItems)
      .set({ status: 'failed', error: error.message })
      .where(eq(mediaItems.id, videoId))
  }

  const item = await db.select().from(mediaItems).where(eq(mediaItems.id, videoId)).limit(1)
  return { item: item[0] }
})
