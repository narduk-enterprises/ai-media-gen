/**
 * GET /api/runpod/active-pods
 *
 * Returns all RUNNING pods from RunPod API with live job counts from D1.
 * Used by:
 *   - Server-side smart routing (resolveApiUrl)
 *   - Frontend settings/pods pages for read-only status display
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'

interface ActivePod {
  id: string
  name: string
  url: string
  status: string
  activeJobs: number
  machineId: string
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const pods = await getRunPods()
  const db = useDatabase(event)

  // Get all processing items to count jobs per pod URL
  const processing = await db.select({ metadata: mediaItems.metadata })
    .from(mediaItems)
    .where(eq(mediaItems.status, 'processing'))

  // Count active jobs per pod URL
  const jobCountByUrl = new Map<string, number>()
  for (const item of processing) {
    if (!item.metadata) continue
    try {
      const meta = JSON.parse(item.metadata)
      const podUrl = meta.apiUrl || meta.podUrl || ''
      if (podUrl) {
        jobCountByUrl.set(podUrl, (jobCountByUrl.get(podUrl) || 0) + 1)
      }
    } catch {}
  }

  const activePods: ActivePod[] = pods
    .filter(p => p.status === 'RUNNING')
    .map(p => {
      const url = `https://${p.id}-8188.proxy.runpod.net`
      return {
        id: p.id,
        name: p.name,
        url,
        status: p.status,
        activeJobs: jobCountByUrl.get(url) || 0,
        machineId: p.machineId,
      }
    })

  return { pods: activePods }
})
