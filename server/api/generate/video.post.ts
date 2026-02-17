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

  // Extract base64 data from data URI
  const base64Match = sourceItem.url.match(/^data:image\/\w+;base64,(.+)$/)
  if (!base64Match) {
    throw createError({ statusCode: 400, message: 'Image data is not in expected base64 format' })
  }
  const imageBase64 = base64Match[1]

  // Get the prompt from the parent generation
  const gen = source[0].generations
  const prompt = gen.prompt || ''

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

  // Generate video (async — can take minutes)
  try {
    const result = await generateVideo(prompt, { imageBase64 })

    if (result.status === 'complete' && result.data) {
      const videoUrl = `data:video/mp4;base64,${result.data}`
      await db.update(mediaItems)
        .set({ url: videoUrl, status: 'complete' })
        .where(eq(mediaItems.id, videoId))
    } else {
      await db.update(mediaItems)
        .set({ status: 'failed', error: result.error || 'Generation failed' })
        .where(eq(mediaItems.id, videoId))
    }
  } catch (error: any) {
    await db.update(mediaItems)
      .set({ status: 'failed', error: error.message })
      .where(eq(mediaItems.id, videoId))
  }

  const item = await db.select().from(mediaItems).where(eq(mediaItems.id, videoId)).limit(1)
  return { item: item[0] }
})
