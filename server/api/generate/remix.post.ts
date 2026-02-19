import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPod } from '../../utils/ai'
import type { EndpointType } from '../../utils/ai'

/**
 * POST /api/generate/remix
 *
 * Server-side prompt remix using the GPU pod's LLM.
 * Uses Qwen2.5-3B-Instruct running on the pod for fast, high-quality remixes.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const body = await readBody<{
    prompt: string
    count?: number
    temperature?: number
    endpoint?: EndpointType | string
  }>(event)

  if (!body?.prompt) {
    throw createError({ statusCode: 400, message: 'prompt is required' })
  }

  const count = Math.min(Math.max(body.count || 1, 1), 10)
  const temperature = body.temperature ?? 0.9
  const apiUrl = resolveApiUrl(body.endpoint)

  try {
    const response = await callRunPod({
      action: 'prompt_remix',
      prompt: body.prompt,
      count,
      temperature,
    }, apiUrl)

    if (response.output?.prompts) {
      return {
        prompts: response.output.prompts,
        elapsed: response.output.elapsed_seconds,
      }
    }

    throw createError({
      statusCode: 502,
      message: response.error || 'No prompts returned from remix',
    })
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({
      statusCode: 502,
      message: `Remix failed: ${e.message}`,
    })
  }
})
