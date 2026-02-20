/**
 * POST /api/generate/dismiss
 *
 * Soft-delete items from the queue sidebar. Items stay in D1 for the gallery,
 * but get a dismissed_at timestamp so they no longer appear in /my-queue.
 *
 * Accepts: { itemIds: string[] } or { all: true } to dismiss all completed/failed.
 */
import { eq, and, inArray, or } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems, generations } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody<{ itemIds?: string[]; all?: boolean }>(event)
  const db = useDatabase()
  const now = new Date().toISOString()

  if (body?.all) {
    // Dismiss all completed/failed/cancelled items for this user
    const userGens = await db.select({ id: generations.id })
      .from(generations)
      .where(eq(generations.userId, user.id))

    if (userGens.length === 0) return { dismissed: 0 }

    const genIds = userGens.map(g => g.id)
    const resolvable = await db.select({ id: mediaItems.id }).from(mediaItems)
      .where(and(
        inArray(mediaItems.generationId, genIds),
        or(
          eq(mediaItems.status, 'complete'),
          eq(mediaItems.status, 'failed'),
          eq(mediaItems.status, 'cancelled'),
        ),
      ))

    if (resolvable.length === 0) return { dismissed: 0 }

    await db.update(mediaItems)
      .set({ dismissedAt: now })
      .where(inArray(mediaItems.id, resolvable.map(r => r.id)))

    return { dismissed: resolvable.length }
  }

  if (!body?.itemIds?.length) {
    throw createError({ statusCode: 400, message: 'itemIds or all:true is required' })
  }

  // Verify items belong to this user
  const items = await db.select({
    id: mediaItems.id,
    generationId: mediaItems.generationId,
  }).from(mediaItems)
    .where(inArray(mediaItems.id, body.itemIds))

  const userGenIds = new Set(
    (await db.select({ id: generations.id }).from(generations)
      .where(eq(generations.userId, user.id))
    ).map(g => g.id)
  )

  const ownedIds = items
    .filter(i => userGenIds.has(i.generationId))
    .map(i => i.id)

  if (ownedIds.length === 0) return { dismissed: 0 }

  await db.update(mediaItems)
    .set({ dismissedAt: now })
    .where(inArray(mediaItems.id, ownedIds))

  return { dismissed: ownedIds.length }
})
