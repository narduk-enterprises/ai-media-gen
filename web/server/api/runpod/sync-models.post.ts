/**
 * POST /api/runpod/sync-models
 *
 * Trigger on-demand model sync on a running pod.
 * Accepts { podId, groups: string[] }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }
  const groups: string[] = body.groups || []

  const podUrl = `https://${body.podId}-8188.proxy.runpod.net`

  // Trigger sync_models.py on the pod via admin server
  const groupsArg = groups.length > 0 ? `--groups ${groups.join(',')}` : ''
  const response = await $fetch<{ output: string }>(`${podUrl}/run-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      command: `cd /workspace && python3 -u sync_models.py ${groupsArg} 2>&1 | tee /workspace/logs/sync_models.log`,
      background: true,
    },
    timeout: 10_000,
  })

  return { success: true, message: `Model sync started for groups: ${groups.join(', ') || 'all'}` }
})
