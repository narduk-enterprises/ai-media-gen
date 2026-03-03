



/**
 * POST /api/generate/recover
 *
 * Manually triggers a queue processing cycle (same as the cron does).
 * Submits queued items, polls processing items, cleans up stale ones.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const db = useDatabase(event)
  const mediaBucket = useMediaBucket(event)

  console.log('[Recovery] Manual queue processing triggered...')
  const result = await processQueue(db, mediaBucket)
  console.log(`[Recovery] Done — submitted: ${result.submitted}, completed: ${result.completed}, failed: ${result.failed}`)

  return result
})
