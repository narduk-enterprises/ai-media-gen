/**
 * Nitro Scheduled Task: recovery:sweep
 *
 * Runs every 2 minutes via Cloudflare Cron Trigger.
 * Finds all media items stuck in 'processing' state and completes them.
 * This is the bulletproof fallback for when waitUntil is unavailable
 * or the browser was closed mid-generation.
 */
import { recoverOrphanedItems } from '../../utils/backgroundComplete'
import { initDatabase } from '../../database'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../database/schema'

export default defineTask({
  meta: {
    name: 'recovery:sweep',
    description: 'Recover orphaned processing items every 2 minutes',
  },
  async run({ payload, context }) {
    console.log('[Cron] Starting scheduled recovery sweep...')

    try {
      // Get the database — it should already be initialized by the DB middleware
      const db = useDatabase()

      // For cron triggers we don't have a traditional request event,
      // so we access the R2 bucket directly from the Cloudflare env if available
      let mediaBucket: R2Bucket | null = null
      try {
        // In Nitro tasks on cloudflare_module, env bindings may be available via globalThis.__env__
        const env = (globalThis as any).__env__ || (globalThis as any).process?.env
        if (env?.MEDIA) {
          mediaBucket = env.MEDIA as R2Bucket
        }
      } catch {
        console.warn('[Cron] Could not access R2 bucket binding in cron context')
      }

      const result = await recoverOrphanedItems(db, mediaBucket)
      console.log(`[Cron] Sweep complete — recovered: ${result.recovered}, failed: ${result.failed}, still processing: ${result.stillProcessing}, total: ${result.total}`)

      return { result }
    } catch (e: any) {
      console.error('[Cron] Recovery sweep error:', e.message)
      return { result: { error: e.message } }
    }
  },
})
