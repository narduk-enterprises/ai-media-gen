import { eq, and, sql } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems, generations } from '../../database/schema'

/**
 * GET /api/feed/post?id=<mediaItemId>
 *
 * Returns full details for a single media item including its parent
 * generation context, settings, and sibling media items.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDatabase()
  const query = getQuery(event)
  const id = String(query.id || '')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media item ID required' })
  }

  // Fetch the media item joined with its generation
  const [item] = await db
    .select({
      id: mediaItems.id,
      url: mediaItems.url,
      type: mediaItems.type,
      status: mediaItems.status,
      parentId: mediaItems.parentId,
      qualityScore: mediaItems.qualityScore,
      metadata: mediaItems.metadata,
      itemPrompt: mediaItems.prompt,
      createdAt: mediaItems.createdAt,
      generationId: mediaItems.generationId,
      genPrompt: generations.prompt,
      genSettings: generations.settings,
      genImageCount: generations.imageCount,
      genCreatedAt: generations.createdAt,
    })
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(eq(mediaItems.id, id))
    .limit(1)

  if (!item) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  // Fetch sibling media (other items from the same generation)
  const siblings = await db
    .select({
      id: mediaItems.id,
      url: mediaItems.url,
      type: mediaItems.type,
      status: mediaItems.status,
      qualityScore: mediaItems.qualityScore,
    })
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.generationId, item.generationId),
        eq(mediaItems.status, 'complete'),
        sql`${mediaItems.url} IS NOT NULL`,
        sql`${mediaItems.url} != ''`,
        sql`${mediaItems.id} != ${id}`
      )
    )

  // Fetch parent image if this is a video derived from an image
  let parentImage = null
  if (item.parentId) {
    const [parent] = await db
      .select({
        id: mediaItems.id,
        url: mediaItems.url,
        type: mediaItems.type,
      })
      .from(mediaItems)
      .where(eq(mediaItems.id, item.parentId))
      .limit(1)
    parentImage = parent ?? null
  }

  return {
    post: {
      id: item.id,
      url: item.url,
      type: item.type,
      status: item.status,
      qualityScore: item.qualityScore,
      prompt: item.itemPrompt || item.genPrompt,
      generationPrompt: item.genPrompt,
      settings: item.genSettings,
      metadata: item.metadata,
      parentId: item.parentId,
      parentImage,
      createdAt: item.createdAt,
      generationId: item.generationId,
      generationCreatedAt: item.genCreatedAt,
      imageCount: item.genImageCount,
    },
    siblings,
  }
})
