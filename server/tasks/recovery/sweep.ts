/**
 * Nitro Scheduled Task: recovery:sweep
 *
 * Runs every 2 minutes via Cloudflare Cron Trigger.
 * Finds all media items stuck in 'processing' state and completes them.
 * This is the bulletproof fallback for when waitUntil times out (30s free tier)
 * or the browser was closed mid-generation.
 */
import { recoverOrphanedItems } from '../../utils/backgroundComplete'
import { initDatabase } from '../../utils/database'

export default defineTask({
  meta: {
    name: 'recovery:sweep',
    description: 'Recover orphaned processing items every 2 minutes',
  },
  async run() {
    console.log('[Cron] Starting scheduled recovery sweep...')

    try {
      // In cron context, the D1 middleware hasn't run — init DB directly from binding
      const env = (globalThis as any).__env__
      if (!env?.DB) {
        console.error('[Cron] No D1 binding available')
        return { result: { error: 'No D1 binding' } }
      }

      const db = initDatabase(env.DB)
      const mediaBucket: R2Bucket | null = env.MEDIA ?? null

      const result = await recoverOrphanedItems(db, mediaBucket)
      console.log(`[Cron] Sweep complete — recovered: ${result.recovered}, failed: ${result.failed}, still processing: ${result.stillProcessing}, total: ${result.total}`)

      return { result }
    } catch (e: any) {
      console.error('[Cron] Recovery sweep error:', e.message)
      return { result: { error: e.message } }
    }
  },
})
