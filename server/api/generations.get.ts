import { eq, desc } from 'drizzle-orm'
import { requireAuth } from '../utils/auth'
import { generations, mediaItems } from '../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const db = useDatabase()
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 20, 50)
  const offset = Math.max(Number(query.offset) || 0, 0)

  const gens = await db
    .select()
    .from(generations)
    .where(eq(generations.userId, user.id))
    .orderBy(desc(generations.createdAt))
    .limit(limit)
    .offset(offset)

  // Fetch media items for each generation
  const results = await Promise.all(
    gens.map(async (gen) => {
      const items = await db
        .select()
        .from(mediaItems)
        .where(eq(mediaItems.generationId, gen.id))

      // Transform base64 data URIs to serving paths to reduce payload
      const transformedItems = items.map((item) => ({
        ...item,
        url: item.url?.startsWith('data:')
          ? `/api/media/${item.id}`
          : item.url,
      }))

      return { ...gen, items: transformedItems }
    }),
  )

  return { generations: results }
})
