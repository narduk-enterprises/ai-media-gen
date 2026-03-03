/**
 * POST /api/runpod/update-pod
 *
 * Pull latest code from git, copy files to workspace, and rerun setup.
 * Does NOT reboot or restart the pod — just updates code in-place and
 * kicks off /workspace/run-setup.sh in the background.
 * Accepts { podId }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const podId = body.podId
  const podUrl = `https://${podId}-8188.proxy.runpod.net`

  // Step 1: Pull latest code and copy files to workspace locations
  // Step 2: Rerun setup script in background (installs deps, custom nodes, etc.)
  // No service restart or pod reboot — setup script handles everything.
  const updateScript = [
    // Pull latest repo code
    'cd /workspace/_repo && git pull --ff-only',
    // Copy all admin / script files to workspace
    'cp /workspace/_repo/pod/admin/server.py /workspace/admin/server.py',
    'cp /workspace/_repo/pod/admin/index.html /workspace/admin/index.html',
    'cp /workspace/_repo/pod/admin/workflow_loader.py /workspace/admin/workflow_loader.py',
    'cp -r /workspace/_repo/pod/admin/workflows/* /workspace/admin/workflows/',
    'cp /workspace/_repo/pod/scripts/manage-pod.sh /workspace/manage.sh && chmod +x /workspace/manage.sh',
    'cp /workspace/_repo/pod/scripts/sync_models.py /workspace/sync_models.py',
    'cp /workspace/_repo/pod/scripts/supervisord.conf /workspace/supervisord.conf',
    // Re-generate the on-pod setup script from the repo copy
    '[ -f /workspace/_repo/pod/scripts/setup-machine.sh ] && cp /workspace/_repo/pod/scripts/setup-machine.sh /workspace/ || true',
    // Kick off setup in background (nohup so it survives)
    // Use ; instead of && for the background command since & terminates the && chain
    'nohup bash /workspace/run-setup.sh </dev/null >/workspace/logs/setup.log 2>&1 & echo "Setup started in background (PID $!)"',
  ].join(' && ')

  try {
    const result = await $fetch<{ status: string; exit_code?: number; stdout?: string }>(`${podUrl}/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { command: updateScript, background: false },
      timeout: 120_000,
    })
    return {
      success: result.exit_code === 0,
      message: result.exit_code === 0
        ? 'Code updated — setup rerunning in background. Check pod logs for progress.'
        : `Update failed (exit ${result.exit_code})`,
      output: result.stdout,
    }
  } catch (e: any) {
    throw createError({
      statusCode: 502,
      message: `Failed to reach pod: ${e?.message || 'Unknown error'}. Make sure the pod is running and the admin server is reachable.`,
    })
  }
})
