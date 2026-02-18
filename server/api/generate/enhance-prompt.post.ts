import { z } from 'zod'
import { requireAuth } from '../../utils/auth'

const enhanceSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const body = await readBody(event)
  const parsed = enhanceSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt } = parsed.data
  const config = useRuntimeConfig()
  const apiKey = config.aiApiKey

  const llmUrl = config.llmApiUrl
  if (!apiKey || !llmUrl) {
    throw createError({ statusCode: 503, message: 'AI service not configured' })
  }

  const systemPrompt = `You are a creative AI image prompt engineer. Given a user's image generation prompt, create a variation that is visually distinct but thematically related. Make it more vivid, detailed, and cinematic. Add interesting artistic styles, lighting, color palettes, composition details, and atmosphere. Keep the core subject but transform the scene into something fresh and stunning. Output ONLY the new prompt, nothing else. No explanations, no quotes, no prefixes.`

  try {
    // Use RunPod vLLM OpenAI-compatible endpoint directly
    const response = await $fetch<{
      choices: Array<{
        message: { content: string }
        finish_reason: string
      }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }>(`${llmUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: 'Qwen/Qwen2.5-3B-Instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Create a creative variation of this image prompt:\n\n${prompt}` },
        ],
        max_tokens: 300,
        temperature: 0.9,
      },
      timeout: 60_000,
    })

    const enhancedPrompt = response.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '')

    if (!enhancedPrompt) {
      throw new Error('No prompt returned from LLM')
    }

    return { prompt: enhancedPrompt }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({
      statusCode: 502,
      message: `Prompt enhancement failed: ${error.message}`,
    })
  }
})

