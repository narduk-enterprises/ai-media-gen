import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { generations, mediaItems } from '../../database/schema'

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  prompts: z.array(z.string()).optional(),
  negativePrompt: z.string().default(''),
  count: z.number().int().min(1).max(16).default(1),
  steps: z.number().int().min(1).max(80).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
  loraStrength: z.number().min(0).max(2).default(1.0),
  model: z.enum(['wan22', 'qwen_image', 'qwen_lora', 'flux2_dev', 'flux2_turbo', 'z_image', 'z_image_turbo', 'juggernaut', 'cyberrealistic_pony']).default('wan22'),
  seed: z.number().int().default(-1),
  cfg: z.number().min(0).max(20).optional(),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  customLoras: z.record(z.number()).optional(),
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

  const { prompt, prompts, negativePrompt, count, steps, width, height, loraStrength, cfg, sampler, scheduler, customLoras, model, seed, attributes, sweepId, sweepLabel, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)

  const settingsObj: Record<string, any> = {
    negativePrompt, steps, width, height, seed, model, loraStrength,
    attributes: attributes || {},
  }
  if (cfg != null) settingsObj.cfg = cfg
  if (sampler) settingsObj.sampler = sampler
  if (scheduler) settingsObj.scheduler = scheduler
  if (customLoras) settingsObj.customLoras = customLoras
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
        comfyInput: {
          action: 'text2image',
          prompt: imagePrompt,
          negative_prompt: negativePrompt,
          width, height, steps,
          lora_strength: loraStrength,
          model,
          cfg: cfg ?? undefined,
          sampler_name: sampler ?? undefined,
          scheduler: scheduler ?? undefined,
          custom_loras: customLoras ?? undefined,
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

  // Submit to ComfyUI in background
  waitUntil((async () => {
    for (const item of items) {
      await submitItemToComfyUI(db, item.id)
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
