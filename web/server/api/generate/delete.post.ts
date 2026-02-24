/**
 * POST /api/generate/delete
 *
 * Permanently delete media items and their parent generation (if it becomes empty).
 * Unlike dismiss (soft-delete), this is irreversible.
 *
 * Accepts: { itemIds: string[] } or { generationId: string } or { all: true }
 */
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { mediaItems, generations } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody<{ itemIds?: string[]; generationId?: string; all?: boolean }>(event)
  const db = useDatabase()

  // ─── Delete all for this user ─────────────────────────────────
  if (body?.all) {
    const userGens = await db.select({ id: generations.id })
      .from(generations)
      .where(eq(generations.userId, user.id))

    let deleted = 0
    for (const gen of userGens) {
      // Delete all media items for this generation
      const items = await db.select({ id: mediaItems.id })
        .from(mediaItems)
        .where(eq(mediaItems.generationId, gen.id))

      for (const item of items) {
        await db.delete(mediaItems).where(eq(mediaItems.id, item.id))
        deleted++
      }
      // Delete the generation itself
      await db.delete(generations).where(eq(generations.id, gen.id))
    }

    return { deleted }
  }

  // ─── Delete by generation ID ──────────────────────────────────
  if (body?.generationId) {
    // Verify ownership
    const [gen] = await db.select({ id: generations.id })
      .from(generations)
      .where(and(eq(generations.id, body.generationId), eq(generations.userId, user.id)))
      .limit(1)

    if (!gen) {
      throw createError({ statusCode: 404, message: 'Generation not found' })
    }

    // Delete all media items first
    const items = await db.select({ id: mediaItems.id })
      .from(mediaItems)
      .where(eq(mediaItems.generationId, gen.id))

    for (const item of items) {
      await db.delete(mediaItems).where(eq(mediaItems.id, item.id))
    }

    // Delete generation
    await db.delete(generations).where(eq(generations.id, gen.id))

    return { deleted: items.length, generationDeleted: true }
  }

  // ─── Delete by item IDs ───────────────────────────────────────
  if (!body?.itemIds?.length) {
    throw createError({ statusCode: 400, message: 'itemIds, generationId, or all:true is required' })
  }

  const userGenIds = new Set(
    (await db.select({ id: generations.id }).from(generations)
      .where(eq(generations.userId, user.id))
    ).map(g => g.id)
  )

  let deleted = 0
  const affectedGenerations = new Set<string>()

  for (const itemId of body.itemIds) {
    const [item] = await db.select({ id: mediaItems.id, generationId: mediaItems.generationId })
      .from(mediaItems)
      .where(eq(mediaItems.id, itemId))
      .limit(1)

    if (item && userGenIds.has(item.generationId)) {
      await db.delete(mediaItems).where(eq(mediaItems.id, item.id))
      affectedGenerations.add(item.generationId)
      deleted++
    }
  }

  // Clean up empty generations
  let generationsDeleted = 0
  for (const genId of affectedGenerations) {
    const remaining = await db.select({ id: mediaItems.id })
      .from(mediaItems)
      .where(eq(mediaItems.generationId, genId))
      .limit(1)

    if (remaining.length === 0) {
      await db.delete(generations).where(eq(generations.id, genId))
      generationsDeleted++
    }
  }

  return { deleted, generationsDeleted }
})
