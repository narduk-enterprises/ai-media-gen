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
    const response = await $fetch<{
      id: string
      status: string
      output?: any
    }>(`${llmUrl}/runsync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        input: {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Create a creative variation of this image prompt:\n\n${prompt}` },
          ],
          max_tokens: 300,
          temperature: 0.9,
        },
      },
      timeout: 60_000,
    })

    // Extract the generated text from RunPod response
    let enhancedPrompt = ''

    if (response.output) {
      // Handle various response shapes from vLLM / TGI
      if (typeof response.output === 'string') {
        enhancedPrompt = response.output
      } else if (response.output.choices?.[0]?.message?.content) {
        enhancedPrompt = response.output.choices[0].message.content
      } else if (response.output.text) {
        enhancedPrompt = response.output.text
      } else if (response.output.output) {
        enhancedPrompt = typeof response.output.output === 'string'
          ? response.output.output
          : JSON.stringify(response.output.output)
      } else {
        enhancedPrompt = JSON.stringify(response.output)
      }
    }

    enhancedPrompt = enhancedPrompt.trim().replace(/^["']|["']$/g, '')

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
