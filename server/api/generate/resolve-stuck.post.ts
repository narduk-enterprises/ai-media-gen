import { requireAuth } from '../../utils/auth'
import { processQueue } from '../../utils/queueProcessor'
import { useMediaBucket } from '../../utils/r2'

/**
 * POST /api/generate/resolve-stuck
 *
 * Same as /api/generate/recover — manually trigger queue processing.
 * Kept for backwards compatibility.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const db = useDatabase()
  const mediaBucket = useMediaBucket(event)

  console.log('[Resolve] Manual queue processing triggered...')
  const result = await processQueue(db, mediaBucket)
  console.log(`[Resolve] Done — submitted: ${result.submitted}, completed: ${result.completed}, failed: ${result.failed}`)

  return result
})
