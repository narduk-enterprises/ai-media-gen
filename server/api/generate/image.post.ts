import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { callRunPodAsync, pollRunPodJob } from '../../utils/ai'
import { useMediaBucket, uploadImageToR2 } from '../../utils/r2'
import { generations, mediaItems } from '../../database/schema'

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  prompts: z.array(z.string()).optional(),
  negativePrompt: z.string().default(''),
  count: z.number().int().min(1).max(16).default(1),
  steps: z.number().int().min(1).max(50).default(20),
  width: z.number().int().min(512).max(2048).default(1024),
  height: z.number().int().min(512).max(2048).default(1024),
  attributes: z.record(z.string()).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = generateSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { prompt, prompts, negativePrompt, count, steps, width, height, attributes } = parsed.data

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

  const itemIds: string[] = []
  for (let i = 0; i < count; i++) {
    const itemId = crypto.randomUUID()
    itemIds.push(itemId)
    const imagePrompt = prompts?.[i] || prompt
    await db.insert(mediaItems).values({
      id: itemId,
      generationId,
      type: 'image',
      prompt: imagePrompt,
      status: 'processing',
      createdAt: now,
    })
  }

  const mediaBucket = useMediaBucket(event)

  // Fire off each image generation in the background.
  // Uses async /run endpoint so we get the RunPod job ID immediately and persist
  // it before waiting — stale items can be recovered via the job ID later.
  const backgroundWork = Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const itemId = itemIds[i]!
      const imagePrompt = prompts?.[i] || prompt

      try {
        const { jobId } = await callRunPodAsync({
          action: 'text2image',
          prompt: imagePrompt,
          negative_prompt: negativePrompt,
          width,
          height,
          steps,
        })

        await db.update(mediaItems)
          .set({ runpodJobId: jobId })
          .where(eq(mediaItems.id, itemId))
        console.log(`[Image] Item ${i + 1}/${count} submitted — job ${jobId} (${itemId.slice(0, 8)})`)

        const response = await pollRunPodJob(jobId)

        if (response.output?.output?.data) {
          const base64Data = response.output.output.data
          let url: string

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
      } catch (error: any) {
        console.error(`[Image] ❌ Item ${i + 1}/${count} failed:`, error.message)
        await db.update(mediaItems)
          .set({ status: 'failed', error: error.message })
          .where(eq(mediaItems.id, itemId))
      }
    })
  ).then(async () => {
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

  const items = await db.select().from(mediaItems).where(eq(mediaItems.generationId, generationId))

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
