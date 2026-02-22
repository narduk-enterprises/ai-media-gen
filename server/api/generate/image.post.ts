import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { submitItemToRunPod } from '../../utils/submitItem'
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
  model: z.enum(['wan22', 'qwen_image', 'flux2_dev', 'flux2_turbo']).default('wan22'),
  seed: z.number().int().default(-1),
  attributes: z.record(z.string()).optional(),
  sweepId: z.string().optional(),
  sweepLabel: z.string().optional(),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = generateSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, prompts, negativePrompt, count, steps, width, height, loraStrength, model, seed, attributes, sweepId, sweepLabel, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)

  const settingsObj: Record<string, any> = {
    negativePrompt, steps, width, height, seed, model, loraStrength,
    attributes: attributes || {},
  }
  if (sweepId) { settingsObj.sweepId = sweepId; settingsObj.sweepLabel = sweepLabel || '' }
  const settings = JSON.stringify(settingsObj)
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

  const items = Array.from({ length: count }, (_, i) => {
    const itemId = crypto.randomUUID()
    const imagePrompt = prompts?.[i] || prompt
    const itemSeed = seed < 0 ? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) : seed

    return {
      id: itemId,
      generationId,
      type: 'image' as const,
      prompt: imagePrompt,
      status: 'queued' as const,
      metadata: JSON.stringify({
        apiUrl,
        seed: itemSeed,
        runpodInput: {
          action: 'text2image',
          prompt: imagePrompt,
          negative_prompt: negativePrompt,
          width, height, steps,
          lora_strength: loraStrength,
          model,
          seed: itemSeed,
        },
      }),
      createdAt: now,
    }
  })

  for (const item of items) {
    await db.insert(mediaItems).values(item)
  }

  console.log(`[Image] ${count} items queued for generation ${generationId.slice(0, 8)}`)

  // Submit to RunPod in background — response returns immediately
  waitUntil((async () => {
    for (const item of items) {
      await submitItemToRunPod(db, item.id)
    }
  })())

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
