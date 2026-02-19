import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPod } from '../../utils/ai'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const body = await readBody<{
    prompt_id: string
    endpoint?: string
  }>(event)

  if (!body?.prompt_id) {
    throw createError({ statusCode: 400, message: 'prompt_id is required' })
  }

  const apiUrl = resolveApiUrl(body.endpoint)

  try {
    const response = await callRunPod({
      action: 'delete_queue_item',
      prompt_id: body.prompt_id,
    }, apiUrl)

    return {
      deleted: response.output?.deleted ?? false,
      prompt_id: body.prompt_id,
    }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({
      statusCode: 502,
      message: `Delete queue item failed: ${e.message}`,
    })
  }
})
