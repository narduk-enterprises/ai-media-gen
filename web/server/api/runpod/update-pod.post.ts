/**
 * POST /api/runpod/update-pod
 *
 * Pull latest code from git and restart services on a running pod.
 * Accepts { podId }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const podUrl = `https://${body.podId}-8188.proxy.runpod.net`

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
    'supervisorctl restart all',
  ].join(' && ')

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
    throw createError({ statusCode: 502, message: `Failed to reach pod: ${e?.message || 'Unknown error'}` })
  }
})
