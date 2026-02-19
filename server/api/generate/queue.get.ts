import { eq, asc } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems, generations } from '../../database/schema'

/**
 * Queue status endpoint — returns current queue state.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDatabase()

  const queued = await db.select({
    id: mediaItems.id,
    type: mediaItems.type,
    prompt: mediaItems.prompt,
    generationId: mediaItems.generationId,
    createdAt: mediaItems.createdAt,
  })
    .from(mediaItems)
    .where(eq(mediaItems.status, 'queued'))
    .orderBy(asc(mediaItems.createdAt))

  const processing = await db.select({
    id: mediaItems.id,
    type: mediaItems.type,
    prompt: mediaItems.prompt,
    generationId: mediaItems.generationId,
    runpodJobId: mediaItems.runpodJobId,
    submittedAt: mediaItems.submittedAt,
  })
    .from(mediaItems)
    .where(eq(mediaItems.status, 'processing'))

  return {
    queued: queued.map((item, index) => ({
      ...item,
      position: index + 1,
    })),
    processing,
    counts: {
      queued: queued.length,
      processing: processing.length,
    },
  }
})
