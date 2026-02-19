import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPodAsync } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  prompts: z.array(z.string()).optional(),
  negativePrompt: z.string().default(''),
  count: z.number().int().min(1).max(16).default(1),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
  loraStrength: z.number().min(0).max(2).default(1.0),
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

  const { prompt, prompts, negativePrompt, count, steps, width, height, loraStrength, attributes, endpoint } = parsed.data
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

  // Insert all items as 'queued' — the cron will submit them to RunPod
  const items = Array.from({ length: count }, (_, i) => {
    const itemId = crypto.randomUUID()
    const imagePrompt = prompts?.[i] || prompt

    return {
      id: itemId,
      generationId,
      type: 'image' as const,
      prompt: imagePrompt,
      status: 'queued' as const,
      metadata: JSON.stringify({
        apiUrl,
        runpodInput: {
          action: 'text2image',
          prompt: imagePrompt,
          negative_prompt: negativePrompt,
          width,
          height,
          steps,
          lora_strength: loraStrength,
        },
      }),
      createdAt: now,
    }
  })

  // Batch insert
  for (const item of items) {
    await db.insert(mediaItems).values(item)
  }

  console.log(`[Image] ${count} items queued for generation ${generationId.slice(0, 8)}`)

  // Immediately submit to RunPod (fire-and-forget — cron is safety net)
  for (const item of items) {
    try {
      const meta = JSON.parse(item.metadata!)
      const result = await callRunPodAsync(meta.runpodInput, meta.apiUrl)
      await db.update(mediaItems)
        .set({
          status: 'processing',
          runpodJobId: result.jobId,
          submittedAt: new Date().toISOString(),
          metadata: JSON.stringify({ ...meta, apiUrl: result.apiUrl }),
        })
        .where(eq(mediaItems.id, item.id))
      console.log(`[Image] ✅ Immediately submitted ${item.id.slice(0, 8)} → job ${result.jobId}`)
    } catch (e: any) {
      console.warn(`[Image] ⚠️ Immediate submit failed for ${item.id.slice(0, 8)}, cron will retry:`, e.message)
    }
  }

  return {
    generation: {
      id: generationId,
      prompt,
      imageCount: count,
      status: 'processing',
      settings,
      createdAt: now,
    },
    items: items.map(item => ({
      id: item.id,
      generationId,
      type: 'image',
      prompt: item.prompt,
      runpodJobId: null,
      parentId: null,
      url: null,
      status: 'queued',
      error: null,
      metadata: null,
      createdAt: now,
    })),
  }
})
