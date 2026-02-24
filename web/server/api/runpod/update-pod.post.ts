/**
 * POST /api/runpod/update-pod
 *
 * Pull latest code from git and restart services on a running pod.
 * Falls back to a full pod restart (stop+start) if /run-command isn't available.
 * Accepts { podId }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const podId = body.podId
  const podUrl = `https://${podId}-8188.proxy.runpod.net`

  // Pull latest code, copy files to workspace, restart services via supervisorctl
  const updateScript = [
    'cd /workspace/_repo && git pull --ff-only',
    'cp /workspace/_repo/pod/admin/server.py /workspace/admin/server.py',
    'cp /workspace/_repo/pod/admin/index.html /workspace/admin/index.html',
    'cp /workspace/_repo/pod/admin/workflow_loader.py /workspace/admin/workflow_loader.py',
    'cp /workspace/_repo/pod/admin/workflows/* /workspace/admin/workflows/',
    'cp /workspace/_repo/pod/scripts/manage-pod.sh /workspace/manage.sh',
    'cp /workspace/_repo/pod/scripts/sync_models.py /workspace/sync_models.py',
    'cp /workspace/_repo/pod/scripts/supervisord.conf /workspace/supervisord.conf',
    'supervisorctl -c /workspace/supervisord.conf restart all',
  ].join(' && ')

  // Try the fast path: /run-command endpoint
  try {
    const result = await $fetch<{ status: string; exit_code?: number; stdout?: string }>(`${podUrl}/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { command: updateScript, background: false },
      timeout: 30_000,
    })
    return {
      success: result.exit_code === 0,
      message: result.exit_code === 0 ? 'Pod updated and services restarted' : `Update failed (exit ${result.exit_code})`,
      output: result.stdout,
    }
  } catch (e: any) {
    // /run-command not available — fall back to full pod restart
    const statusCode = e?.statusCode || e?.status || 0
    if (statusCode === 404 || statusCode === 502 || statusCode === 503 || e?.message?.includes('fetch failed')) {
      console.log(`[update-pod] /run-command not available on ${podId} (${statusCode}), falling back to restart`)
      try {
        await stopRunPod(podId)
        // Wait for pod to stop
        const maxWait = 60_000
        const start = Date.now()
        while (Date.now() - start < maxWait) {
          await new Promise(r => setTimeout(r, 3000))
          const pods = await getRunPods()
          const pod = pods.find((p: any) => p.id === podId)
          if (!pod || pod.status === 'EXITED' || pod.status === 'STOPPED') break
        }
        await new Promise(r => setTimeout(r, 2000))
        await startRunPod(podId)
        return {
          success: true,
          message: 'Pod restarting — will auto-update code and verify models on boot (takes ~2 min)',
        }
      } catch (restartErr: any) {
        throw createError({ statusCode: 502, message: `Failed to restart pod: ${restartErr?.message || 'Unknown error'}` })
      }
    }
    throw createError({ statusCode: 502, message: `Failed to reach pod: ${e?.message || 'Unknown error'}` })
  }
})
