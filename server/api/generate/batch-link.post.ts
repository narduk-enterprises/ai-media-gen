import { generations, mediaItems } from '../../database/schema'

/**
 * Batch insert D1 media_items for already-uploaded R2 videos.
 * Accepts an array of R2 keys and creates media_items for each.
 * No R2 operations — just D1 inserts.
 *
 * POST /api/generate/batch-link
 * Body: { keys: string[], generationId: string }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const keys: string[] = body?.keys || []
  const genId: string = body?.generationId || 'rec-batch-001'

  if (keys.length === 0) {
    return { error: 'No keys provided' }
  }

  const db = useDatabase()
  const now = new Date().toISOString()
  let success = 0

  for (const key of keys) {
    try {
      const mediaId = crypto.randomUUID()
      await db.insert(mediaItems).values({
        id: mediaId,
        generationId: genId,
        type: 'video',
        url: `/api/media/${mediaId}`,
        status: 'complete',
        metadata: JSON.stringify({ originalR2Key: key }),
        createdAt: now,
        prompt: 'Recovered video',
      })
      success++
    }
    catch {}
  }

  return { success, total: keys.length }
})
