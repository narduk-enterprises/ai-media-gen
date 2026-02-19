/**
 * Nitro Scheduled Task: recovery:sweep
 *
 * Runs every 2 minutes via Cloudflare Cron Trigger.
 * Processes the server-side job queue:
 *   1. Submit queued items to RunPod (up to concurrency limit)
 *   2. Poll processing items for completion
 *   3. Clean up stale items
 */
import { processQueue } from '../../utils/queueProcessor'
import { initDatabase } from '../../utils/database'

export default defineTask({
  meta: {
    name: 'recovery:sweep',
    description: 'Process the job queue every 2 minutes',
  },
  async run(): Promise<{ result: Record<string, any> }> {
    console.log('[Cron] Starting queue processing...')

    try {
      // In cron context, the D1 middleware hasn't run — init DB directly from binding
      const env = (globalThis as any).__env__
      if (!env?.DB) {
        console.error('[Cron] No D1 binding available')
        return { result: { error: 'No D1 binding' } }
      }

      const db = initDatabase(env.DB)
      const mediaBucket: R2Bucket | null = env.MEDIA ?? null

      const result = await processQueue(db, mediaBucket)
      console.log(`[Cron] Queue processed — submitted: ${result.submitted}, completed: ${result.completed}, failed: ${result.failed}, processing: ${result.stillProcessing}, queued: ${result.queuedRemaining}`)

      return { result }
    } catch (e: any) {
      console.error('[Cron] Queue processing error:', e.message)
      return { result: { error: e.message } }
    }
  },
})
