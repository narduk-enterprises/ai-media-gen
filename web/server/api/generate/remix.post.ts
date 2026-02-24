import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import type { EndpointType } from '../../utils/ai'

/**
 * POST /api/generate/remix
 *
 * Server-side prompt remix using the GPU pod's LLM.
 * Calls the pod's /generate/remix endpoint which uses Qwen2.5-3B-Instruct.
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
  const apiUrl = await resolveApiUrl(body.endpoint, 'video')

  try {
    const response = await $fetch<{ prompts: string[]; elapsed_seconds: number }>(`${apiUrl}/generate/remix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        prompt: body.prompt,
        count,
        temperature,
      },
      timeout: 120_000,
    })

    if (response?.prompts?.length) {
      return { prompts: response.prompts, elapsed: response.elapsed_seconds }
    }

    throw createError({
      statusCode: 502,
      message: 'No prompts returned from remix',
    })
  } catch (e: any) {
    // Re-throw our own validation errors (400)
    if (e.statusCode && e.statusCode < 500) throw e
    // Wrap pod errors as 502 with a user-friendly message
    const podMsg = e?.data?.error || e?.data?.message || e?.message || 'Unknown error'
    const isModelMissing = podMsg.includes('FileNotFoundError') || podMsg.includes('No such file')
    throw createError({
      statusCode: 502,
      message: isModelMissing
        ? 'AI Remix model not installed on pod. Sync the "AI Remix + Caption" group first.'
        : `Remix failed: ${podMsg.slice(0, 200)}`,
    })
  }
})
