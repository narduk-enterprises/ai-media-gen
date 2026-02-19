import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPod } from '../../utils/ai'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const query = getQuery(event) as { endpoint?: string }
  const apiUrl = resolveApiUrl(query.endpoint)

  try {
    const response = await callRunPod({ action: 'get_queue' }, apiUrl)

    return {
      running: response.output?.running ?? [],
      pending: response.output?.pending ?? [],
      total: response.output?.total ?? 0,
    }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({
      statusCode: 502,
      message: `Get queue failed: ${e.message}`,
    })
  }
})
