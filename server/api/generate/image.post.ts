import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { callRunPod } from '../../utils/ai'
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

  // Fire off each image generation independently (no await — runs in background)
  for (let i = 0; i < count; i++) {
    const itemId = itemIds[i]!
    // Each request runs independently and updates its own DB row when done
    const imagePrompt = prompts?.[i] || prompt
    callRunPod({
      action: 'text2image',
      prompt: imagePrompt,
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
    })
      .then(async (response) => {
        if (response.output?.output?.data) {
          const url = `data:image/png;base64,${response.output.output.data}`
          await db.update(mediaItems)
            .set({ url, status: 'complete' })
            .where(eq(mediaItems.id, itemId))
          console.log(`[Image] ✅ Item ${i + 1}/${count} complete (${itemId.slice(0, 8)})`)
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
      .finally(async () => {
        // Check if all items for this generation are done
        const allItems = await db.select().from(mediaItems)
          .where(eq(mediaItems.generationId, generationId))
        const allDone = allItems.every(item => item.status === 'complete' || item.status === 'failed')
        if (allDone) {
          const anyFailed = allItems.some(item => item.status === 'failed')
          const allFailed = allItems.every(item => item.status === 'failed')
          await db.update(generations)
            .set({ status: allFailed ? 'failed' : anyFailed ? 'partial' : 'complete' })
            .where(eq(generations.id, generationId))
          console.log(`[Image] Generation ${generationId.slice(0, 8)} finished — ${allFailed ? 'FAILED' : anyFailed ? 'PARTIAL' : 'COMPLETE'}`)
        }
      })
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
