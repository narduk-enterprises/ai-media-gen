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

  try {
    await $fetch(`${podUrl}/sync-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { groups },
      timeout: 10_000,
    })
    return { success: true, message: `Model sync started for groups: ${groups.join(', ') || 'all'}` }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `Failed to reach pod: ${e?.message || 'Unknown error'}` })
  }
})
