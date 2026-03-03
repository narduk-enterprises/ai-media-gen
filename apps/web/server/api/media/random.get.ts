import { sql, eq, and } from 'drizzle-orm'

import { mediaItems } from '../../database/schema'

/**
 * GET /api/media/random?count=10
 * Returns N random completed images from the database.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const query = getQuery(event)
  const count = Math.min(Math.max(Number(query.count) || 10, 1), 100)
  const db = useDatabase(event)

  const items = await db
    .select({ id: mediaItems.id, url: mediaItems.url, prompt: mediaItems.prompt })
    .from(mediaItems)
    .where(and(eq(mediaItems.type, 'image'), eq(mediaItems.status, 'complete')))
    .orderBy(sql`RANDOM()`)
    .limit(count)

  return { items }
})
