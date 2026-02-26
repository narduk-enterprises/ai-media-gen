/**
 * Nitro Scheduled Task: recovery:sweep
 *
 * Runs every minute via Cloudflare Cron Trigger.
 *
 * With the webhook system, this cron is now a SAFETY NET:
 *   1. Submit any queued items to the pod
 *   2. Poll processing items that haven't received a webhook (>1h old)
 *   3. Clean up truly stale items (>24h)
 *
 * The primary completion path is: pod → webhook → completeMediaItem.
 * This cron catches items where the webhook failed or the pod crashed.
 */
import { processQueue } from '../../utils/queueProcessor'
import { initDatabase } from '../../utils/database'

export default defineTask({
  meta: {
    name: 'recovery:sweep',
    description: 'Safety-net queue processor — submits queued items, catches missed webhooks',
  },
  async run(): Promise<{ result: Record<string, any> }> {
    try {
      // In cron context, the D1 middleware hasn't run — init DB directly from binding
      const env = (globalThis as any).__env__
      if (!env?.DB) {
        console.error('[Cron] No D1 binding available')
        return { result: { error: 'No D1 binding' } }
      }

      const db = initDatabase(env.DB)
      const mediaBucket: R2Bucket | null = env.MEDIA ?? null

      // Single cycle per invocation (webhook handles completion in real-time)
      const result = await processQueue(db, mediaBucket)
      console.log(`[Cron] submitted: ${result.submitted}, completed: ${result.completed}, failed: ${result.failed}, processing: ${result.stillProcessing}, queued: ${result.queuedRemaining}`)

      // ── Prompt cache warming ──────────────────────────────────
      try {
        const { autoRefillCache } = await import('../../utils/promptGenerator')
        await autoRefillCache(db, null)
      } catch (e: any) {
        // Non-fatal — don't let cache warming break the cron
        if (!e.message?.includes('already full') && !e.message?.includes('already refilling')) {
          console.warn(`[Cron] Cache warm failed: ${e.message}`)
        }
      }

      return { result }
    } catch (e: any) {
      console.error('[Cron] Queue processing error:', e.message)
      return { result: { error: e.message } }
    }
  },
})
