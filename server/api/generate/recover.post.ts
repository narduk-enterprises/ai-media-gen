import { requireAuth } from '../../utils/auth'
import { recoverOrphanedItems } from '../../utils/backgroundComplete'

/**
 * POST /api/generate/recover
 *
 * Finds all media items stuck in 'processing' status and tries to
 * complete them by checking their RunPod job. This recovers any
 * generations that were lost because the browser was closed before
 * the result came back.
 *
 * Returns a summary of what was recovered.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)

  console.log('[Recovery] Starting recovery scan...')
  const result = await recoverOrphanedItems(event)
  console.log(`[Recovery] Done — recovered: ${result.recovered}, failed: ${result.failed}, still processing: ${result.stillProcessing}`)

  return result
})
