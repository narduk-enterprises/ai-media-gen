import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { callRunPod } from '../../utils/ai'
import { useMediaBucket, uploadImageToR2 } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  prompts: z.array(z.string()).optional(), // per-image prompts for "Vary per Image" mode
  negativePrompt: z.string().default(''),
  count: z.number().int().min(1).max(16).default(1),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = generateSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, prompts, negativePrompt, count, steps, width, height } = parsed.data
  const db = useDatabase()
  const generationId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Create generation record
  await db.insert(generations).values({
    id: generationId,
    userId: user.id,
    prompt,
    imageCount: count,
    status: 'processing',
    createdAt: now,
  })

  // Create placeholder media items
  const itemIds: string[] = []
  for (let i = 0; i < count; i++) {
    const itemId = crypto.randomUUID()
    itemIds.push(itemId)
    await db.insert(mediaItems).values({
      id: itemId,
      generationId,
      type: 'image',
      status: 'processing',
      createdAt: now,
    })
  }

  // Get R2 bucket for media storage (may be null in local dev)
  const mediaBucket = useMediaBucket(event)

  // Fire off each image generation in the background.
  // CRITICAL: Use waitUntil() so Cloudflare keeps the worker alive after response is sent.
  const backgroundWork = Promise.all(
    Array.from({ length: count }, (_, i) => {
      const itemId = itemIds[i]!
      const imagePrompt = prompts?.[i] || prompt
      return callRunPod({
        action: 'text2image',
        prompt: imagePrompt,
        negative_prompt: negativePrompt,
        width,
        height,
        steps,
      })
        .then(async (response) => {
          if (response.output?.output?.data) {
            const base64Data = response.output.output.data
            let url: string

            // Upload to R2 if available, otherwise fall back to base64 in D1
            if (mediaBucket) {
              url = await uploadImageToR2(mediaBucket, itemId, base64Data)
              console.log(`[Image] ✅ Item ${i + 1}/${count} uploaded to R2 (${itemId.slice(0, 8)})`)
            } else {
              url = `data:image/png;base64,${base64Data}`
              console.log(`[Image] ✅ Item ${i + 1}/${count} stored as base64 (${itemId.slice(0, 8)})`)
            }

            await db.update(mediaItems)
              .set({ url, status: 'complete' })
              .where(eq(mediaItems.id, itemId))
          } else {
            await db.update(mediaItems)
              .set({ status: 'failed', error: 'No output data returned' })
              .where(eq(mediaItems.id, itemId))
            console.warn(`[Image] ⚠️ Item ${i + 1}/${count} — no output`)
          }
        })
        .catch(async (error: any) => {
          console.error(`[Image] ❌ Item ${i + 1}/${count} failed:`, error.message)
          await db.update(mediaItems)
            .set({ status: 'failed', error: error.message })
            .where(eq(mediaItems.id, itemId))
        })
    })
  ).then(async () => {
    // All items done — update generation status
    const allItems = await db.select().from(mediaItems)
      .where(eq(mediaItems.generationId, generationId))
    const anyFailed = allItems.some(item => item.status === 'failed')
    const allFailed = allItems.every(item => item.status === 'failed')
    await db.update(generations)
      .set({ status: allFailed ? 'failed' : anyFailed ? 'partial' : 'complete' })
      .where(eq(generations.id, generationId))
    console.log(`[Image] Generation ${generationId.slice(0, 8)} finished — ${allFailed ? 'FAILED' : anyFailed ? 'PARTIAL' : 'COMPLETE'}`)
  })

  // Keep Cloudflare Worker alive for background work
  const cfCtx = (event.context as any).cloudflare?.context
  if (cfCtx?.waitUntil) {
    cfCtx.waitUntil(backgroundWork)
  }

  // Return immediately with placeholder items (all status: 'processing')
  const items = await db.select().from(mediaItems).where(eq(mediaItems.generationId, generationId))

  return {
    generation: {
      id: generationId,
      prompt,
      imageCount: count,
      status: 'processing',
      createdAt: now,
    },
    items,
  }
})
