/**
 * POST /api/generate/dismiss
 *
 * Soft-delete items from the queue sidebar. Items stay in D1 for the gallery,
 * but get a dismissed_at timestamp so they no longer appear in /my-queue.
 *
 * Accepts: { itemIds: string[] } or { all: true } to dismiss all completed/failed.
 */
import { eq, and, or } from 'drizzle-orm'

import { mediaItems, generations } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody<{ itemIds?: string[]; all?: boolean }>(event)
  const db = useDatabase(event)
  const now = new Date().toISOString()

  if (body?.all) {
    // Get all generation IDs for this user
    const userGens = await db.select({ id: generations.id })
      .from(generations)
      .where(eq(generations.userId, user.id))

    if (userGens.length === 0) return { dismissed: 0 }

    // Find resolvable items using join + or(eq()) instead of inArray
    const resolvable = await db.select({ id: mediaItems.id }).from(mediaItems)
      .innerJoin(generations, eq(mediaItems.generationId, generations.id))
      .where(and(
        eq(generations.userId, user.id),
        or(
          eq(mediaItems.status, 'complete'),
          eq(mediaItems.status, 'failed'),
          eq(mediaItems.status, 'cancelled'),
        ),
      ))
      .then(rows => rows.map(r => (r as any).media_items ?? r))

    if (resolvable.length === 0) return { dismissed: 0 }

    // Update each item individually (avoid inArray D1 bug)
    let dismissed = 0
    for (const item of resolvable) {
      await db.update(mediaItems).set({ dismissedAt: now }).where(eq(mediaItems.id, item.id))
      dismissed++
    }

    return { dismissed }
  }

  if (!body?.itemIds?.length) {
    throw createError({ statusCode: 400, message: 'itemIds or all:true is required' })
  }

  // Verify items belong to this user — check one by one
  const userGenIds = new Set(
    (await db.select({ id: generations.id }).from(generations)
      .where(eq(generations.userId, user.id))
    ).map(g => g.id)
  )

  let dismissed = 0
  for (const itemId of body.itemIds) {
    const [item] = await db.select({ id: mediaItems.id, generationId: mediaItems.generationId })
      .from(mediaItems)
      .where(eq(mediaItems.id, itemId))
      .limit(1)

    if (item && userGenIds.has(item.generationId)) {
      await db.update(mediaItems).set({ dismissedAt: now }).where(eq(mediaItems.id, item.id))
      dismissed++
    }
  }

  return { dismissed }
})
