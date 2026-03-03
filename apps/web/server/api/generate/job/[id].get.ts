/**
 * GET /api/generate/job/[id]
 *
 * Returns full details for a single media item, including its parent generation
 * settings and the parent media item (if any, e.g. the source image for a video).
 */
import { eq } from 'drizzle-orm'

import { generations, mediaItems } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Item ID is required' })
  }

  const db = useDatabase(event)

  // Get the media item
  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)
  if (!item) {
    throw createError({ statusCode: 404, message: 'Item not found' })
  }

  // Get the parent generation (verify ownership)
  const [generation] = await db.select().from(generations).where(eq(generations.id, item.generationId)).limit(1)
  if (!generation || generation.userId !== user.id) {
    throw createError({ statusCode: 404, message: 'Item not found' })
  }

  // If there's a parent media item (e.g. source image for video), fetch it
  let parent = null
  if (item.parentId) {
    const [p] = await db.select().from(mediaItems).where(eq(mediaItems.id, item.parentId)).limit(1)
    if (p) {
      parent = {
        id: p.id,
        type: p.type,
        url: p.url?.startsWith('data:') ? `/api/media/${p.id}` : p.url,
        prompt: p.prompt,
        status: p.status,
      }
    }
  }

  // Parse metadata
  let metadata = null
  try { metadata = item.metadata ? JSON.parse(item.metadata) : null } catch {}

  // Parse generation settings
  let settings = null
  try { settings = generation.settings ? JSON.parse(generation.settings) : null } catch {}

  return {
    item: {
      id: item.id,
      generationId: item.generationId,
      type: item.type,
      status: item.status,
      prompt: item.prompt || generation.prompt,
      url: item.url?.startsWith('data:') ? `/api/media/${item.id}` : item.url,
      error: item.error,
      runpodJobId: item.runpodJobId,
      qualityScore: item.qualityScore,
      parentId: item.parentId,
      submittedAt: item.submittedAt,
      dismissedAt: item.dismissedAt,
      createdAt: item.createdAt,
      metadata,
    },
    generation: {
      id: generation.id,
      prompt: generation.prompt,
      imageCount: generation.imageCount,
      status: generation.status,
      settings,
      createdAt: generation.createdAt,
    },
    parent,
  }
})
