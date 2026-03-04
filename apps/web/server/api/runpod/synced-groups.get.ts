/**
 * GET /api/runpod/synced-groups?podId=xxx
 *
 * Check which model groups are already synced on a running pod.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const podId = query.podId as string
  if (!podId) {
    throw createError({ statusCode: 400, message: 'podId query param is required' })
  }

  const podUrl = `https://${podId}-8188.proxy.runpod.net`

  try {
    const result = await $fetch<Record<string, { synced: boolean; partial: boolean; files_present: number; files_total: number; size_mb: number }>>(`${podUrl}/synced-groups`, {
      timeout: 10_000,
    })
    return result
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (e: any) {
    // Pod may not have the endpoint yet — return empty
    console.warn(`[synced-groups] Failed for pod ${podId}: ${e?.message}`)
    return {}
  }
})
