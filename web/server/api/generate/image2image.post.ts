import { z } from 'zod'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { generations, mediaItems } from '../../database/schema'

const schema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  negativePrompt: z.string().default(''),
  image: z.string().min(1, 'Image (base64) is required'),
  model: z.enum(['wan22', 'flux2_turbo', 'z_image', 'z_image_turbo']).default('wan22'),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
  cfg: z.number().min(1).max(20).default(7.0),
  denoise: z.number().min(0).max(1).default(0.75),
  seed: z.number().int().default(-1),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, negativePrompt, image, model, steps, width, height, cfg, denoise, seed } = parsed.data
  const apiUrl = resolveApiUrl(undefined, 'image')

  const db = useDatabase()
  const generationId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const now = new Date().toISOString()

  const settings = JSON.stringify({ negativePrompt, model, steps, width, height, cfg, denoise, seed })

  await db.insert(generations).values({
    id: generationId,
    userId: user.id,
    prompt,
    imageCount: 1,
    status: 'processing',
    settings,
    createdAt: now,
  })

  await db.insert(mediaItems).values({
    id: itemId,
    generationId,
    type: 'image',
    prompt,
    status: 'queued',
    metadata: JSON.stringify({
      apiUrl,
      comfyInput: {
        action: 'image2image',
        prompt, negative_prompt: negativePrompt, image, model,
        width, height, steps, cfg, denoise, seed,
      },
    }),
    createdAt: now,
  })

  console.log(`[I2I] Item queued: ${itemId.slice(0, 8)}`)

 event.waitUntil(submitItemToComfyUI(db, itemId))

  return {
    generation: { id: generationId, prompt, imageCount: 1, status: 'processing', settings, createdAt: now },
    items: [{
      id: itemId, generationId, type: 'image', prompt,
      runpodJobId: null, parentId: null, url: null,
      status: 'queued', error: null, metadata: null, createdAt: now,
    }],
  }
})
