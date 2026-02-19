import { z } from 'zod'
import { requireAuth } from '../../utils/auth'
import { callRunPodAsync, resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'
import { backgroundComplete } from '../../utils/backgroundComplete'

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  prompts: z.array(z.string()).optional(),
  negativePrompt: z.string().default(''),
  count: z.number().int().min(1).max(16).default(1),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
  attributes: z.record(z.string()).optional(),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = generateSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, prompts, negativePrompt, count, steps, width, height, attributes, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)

  const settings = JSON.stringify({
    negativePrompt,
    steps,
    width,
    height,
    attributes: attributes || {},
  })
  const db = useDatabase()
  const generationId = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.insert(generations).values({
    id: generationId,
    userId: user.id,
    prompt,
    imageCount: count,
    status: 'processing',
    settings,
    createdAt: now,
  })

  // Submit all jobs to RunPod and store job IDs
  const itemIds: string[] = []
  const items = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const itemId = crypto.randomUUID()
      itemIds.push(itemId)
      const imagePrompt = prompts?.[i] || prompt
      let jobId: string | null = null

      try {
        const result = await callRunPodAsync({
          action: 'text2image',
          prompt: imagePrompt,
          negative_prompt: negativePrompt,
          width,
          height,
          steps,
        }, apiUrl)
        jobId = result.jobId
        console.log(`[Image] ${i + 1}/${count} submitted — job ${jobId}`)
      } catch (error: any) {
        console.error(`[Image] ${i + 1}/${count} submit failed:`, error.message)
      }

      await db.insert(mediaItems).values({
        id: itemId,
        generationId,
        type: 'image',
        prompt: imagePrompt,
        runpodJobId: jobId,
        status: jobId ? 'processing' : 'failed',
        error: jobId ? null : 'Failed to submit to RunPod',
        metadata: JSON.stringify({ apiUrl }),
        createdAt: now,
      })

      return { id: itemId, generationId, type: 'image', prompt: imagePrompt, runpodJobId: jobId, parentId: null, url: null, status: jobId ? 'processing' : 'failed', error: jobId ? null : 'Failed to submit to RunPod', metadata: null, createdAt: now }
    })
  )

  // Background completion — server keeps polling even if frontend disconnects
  backgroundComplete(event, itemIds)

  return {
    generation: {
      id: generationId,
      prompt,
      imageCount: count,
      status: 'processing',
      settings,
      createdAt: now,
    },
    items,
  }
})
