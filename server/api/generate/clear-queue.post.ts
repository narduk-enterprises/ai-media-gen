import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPod } from '../../utils/ai'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const body = await readBody<{ endpoint?: string }>(event) || {}
  const apiUrl = resolveApiUrl(body.endpoint)

  try {
    const response = await callRunPod({ action: 'clear_queue' }, apiUrl)

    return {
      cleared: response.output?.instances_cleared ?? 0,
      interrupted: response.output?.instances_interrupted ?? 0,
    }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({
      statusCode: 502,
      message: `Clear queue failed: ${e.message}`,
    })
  }
})
