/**
 * Nitro Scheduled Task: recovery:sweep
 *
 * Runs every minute via Cloudflare Cron Trigger.
 * To achieve ~20-second queue processing intervals, we run processQueue
 * 3 times per invocation with 20-second delays between them.
 *
 * Each cycle:
 *   1. Submit queued items to RunPod (up to concurrency limit)
 *   2. Poll processing items for completion
 *   3. Clean up stale items
 */
import { processQueue } from '../../utils/queueProcessor'
import { initDatabase } from '../../utils/database'

const CYCLES_PER_INVOCATION = 3
const CYCLE_DELAY_MS = 20_000 // 20 seconds between cycles

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default defineTask({
  meta: {
    name: 'recovery:sweep',
    description: 'Process the job queue ~every 20 seconds (3 cycles per minute)',
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

      const results: any[] = []

      for (let cycle = 0; cycle < CYCLES_PER_INVOCATION; cycle++) {
        if (cycle > 0) await sleep(CYCLE_DELAY_MS)

        console.log(`[Cron] Cycle ${cycle + 1}/${CYCLES_PER_INVOCATION} starting...`)
        const result = await processQueue(db, mediaBucket)
        console.log(`[Cron] Cycle ${cycle + 1} — submitted: ${result.submitted}, completed: ${result.completed}, failed: ${result.failed}, processing: ${result.stillProcessing}, queued: ${result.queuedRemaining}`)
        results.push(result)
      }

      return { result: { cycles: results.length, last: results[results.length - 1] } }
    } catch (e: any) {
      console.error('[Cron] Queue processing error:', e.message)
      return { result: { error: e.message } }
    }
  },
})
