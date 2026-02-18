import { eq, and, inArray } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { callRunPodAsync, resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

/**
 * Requeue stuck "processing" media items by re-submitting them to the pod.
 * POST /api/generate/requeue
 * Body: { generationIds?: string[] }  — if omitted, requeues ALL stuck items
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event) || {}
  const db = useDatabase()

  // Find all stuck processing image items
  let stuckItems
  if (body.generationIds?.length) {
    stuckItems = await db.select().from(mediaItems)
      .where(and(
        eq(mediaItems.status, 'processing'),
        eq(mediaItems.type, 'image'),
        inArray(mediaItems.generationId, body.generationIds),
      ))
  } else {
    stuckItems = await db.select().from(mediaItems)
      .where(and(
        eq(mediaItems.status, 'processing'),
        eq(mediaItems.type, 'image'),
      ))
  }

  if (stuckItems.length === 0) {
    return { requeued: 0, failed: 0, message: 'No stuck items found' }
  }

  // Gather generation settings so we know width/height/steps/negativePrompt
  const genIds = [...new Set(stuckItems.map(i => i.generationId))]
  const gens = await db.select().from(generations).where(inArray(generations.id, genIds))
  const genSettingsMap = new Map<string, any>()
  for (const g of gens) {
    try {
      genSettingsMap.set(g.id, JSON.parse(g.settings || '{}'))
    } catch {
      genSettingsMap.set(g.id, {})
    }
  }

  // Figure out which apiUrl to use — prefer pod URL from metadata
  const podApiUrl = resolveApiUrl()
  let requeued = 0
  let failed = 0

  // Process in batches of 4 to avoid hammering the pod
  const batchSize = 4
  for (let i = 0; i < stuckItems.length; i += batchSize) {
    const batch = stuckItems.slice(i, i + batchSize)
    await Promise.all(batch.map(async (item) => {
      const settings = genSettingsMap.get(item.generationId) || {}
      const itemApiUrl = item.metadata ? JSON.parse(item.metadata).apiUrl : podApiUrl

      try {
        const result = await callRunPodAsync({
          action: 'text2image',
          prompt: item.prompt || 'image',
          negative_prompt: settings.negativePrompt || '',
          width: settings.width || 1024,
          height: settings.height || 1024,
          steps: settings.steps || 20,
        }, itemApiUrl)

        await db.update(mediaItems)
          .set({
            runpodJobId: result.jobId,
            status: 'processing',
            error: null,
            metadata: JSON.stringify({ apiUrl: itemApiUrl }),
          })
          .where(eq(mediaItems.id, item.id))

        requeued++
        console.log(`[Requeue] ✅ ${item.id.slice(0, 8)} -> job ${result.jobId}`)
      } catch (error: any) {
        failed++
        console.error(`[Requeue] ❌ ${item.id.slice(0, 8)}: ${error.message}`)
      }
    }))
  }

  // Reset generation statuses back to processing
  for (const genId of genIds) {
    await db.update(generations)
      .set({ status: 'processing' })
      .where(eq(generations.id, genId))
  }

  return {
    requeued,
    failed,
    total: stuckItems.length,
    message: `Requeued ${requeued}/${stuckItems.length} items (${failed} failed)`,
  }
})
