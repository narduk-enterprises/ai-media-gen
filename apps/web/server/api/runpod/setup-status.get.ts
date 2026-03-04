/**
 * GET /api/runpod/setup-status?podId=xxx
 *
 * Check if a pod's setup is complete by probing its admin health endpoint.
 * Used by the frontend to show setup progress after deploy.
 */
export default defineEventHandler(async (event): Promise<{ podId: string; status: string; message: string; vram?: unknown; version?: unknown }> => {
  await requireAdmin(event)

  const query = getQuery(event)
  const podId = query.podId as string

  if (!podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const url = `https://${podId}-8188.proxy.runpod.net`

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
    const health = await $fetch<any>(`${url}/health`, {
      timeout: 5_000,
    })

    if (health?.status === 'ok' || health?.ok) {
      return {
        podId,
        status: 'ready' as const,
        message: 'Pod is ready to accept jobs',
        vram: health.vram_free || health.vram || null,
        version: health.version || null,
      }
    }

    return {
      podId,
      status: 'installing' as const,
      message: 'Admin server responded but not fully ready',
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (e: any) {
    // If the pod is RUNNING but admin doesn't respond, setup is still in progress
    try {
      const pods = await getRunPods()
      const pod = pods.find(p => p.id === podId)

      if (!pod) {
        return { podId, status: 'not_found' as const, message: 'Pod not found' }
      }

      if (pod.status === 'RUNNING') {
        return {
          podId,
          status: 'installing' as const,
          message: 'Pod is running, setup in progress...',
        }
      }

      return {
        podId,
        status: 'starting' as const,
        message: `Pod status: ${pod.status}`,
      }
    } catch {
      return {
        podId,
        status: 'unreachable' as const,
        message: e?.message || 'Cannot reach pod',
      }
    }
  }
})
