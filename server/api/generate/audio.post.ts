import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { callRunPodAsync, resolveApiUrl } from '../../utils/ai'
import { useMediaBucket, readBase64FromR2 } from '../../utils/r2'
import { mediaItems, generations } from '../../database/schema'
import { backgroundComplete } from '../../utils/backgroundComplete'

const audioSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
  prompt: z.string().max(500).optional(),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = audioSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId, prompt, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)
  const db = useDatabase()

  const source = await db
    .select()
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(and(eq(mediaItems.id, mediaItemId), eq(generations.userId, user.id)))
    .limit(1)

  if (!source[0]) {
    throw createError({ statusCode: 404, message: 'Media item not found' })
  }

  const sourceItem = source[0].media_items
  if (sourceItem.type !== 'image' || !sourceItem.url) {
    throw createError({ statusCode: 400, message: 'Source must be a completed image' })
  }

  // Read source image as base64 — supports both R2 paths and legacy data URIs
  let imageBase64: string | null = null
  const base64Match = sourceItem.url.match(/^data:image\/\w+;base64,(.+)$/)
  if (base64Match) {
    imageBase64 = base64Match[1]!
  } else {
    const bucket = useMediaBucket(event)
    if (bucket) {
      imageBase64 = await readBase64FromR2(bucket, mediaItemId)
    }
  }

  if (!imageBase64) {
    throw createError({ statusCode: 400, message: 'Could not read source image data' })
  }

  const gen = source[0].generations
  const videoPrompt = prompt || gen.prompt || ''
  const now = new Date().toISOString()

  const itemId = crypto.randomUUID()
  let jobId: string | null = null

  try {
    const result = await callRunPodAsync({
      action: 'image2video_audio',
      prompt: videoPrompt,
      image: imageBase64,
      width: 768,
      height: 768,
      num_frames: 81,
      steps: 20,
      cfg: 3.5,
    }, apiUrl)
    jobId = result.jobId
    console.log(`[I2V+Audio] Submitted job ${jobId}`)
  } catch (error: any) {
    console.error(`[I2V+Audio] Submit failed:`, error.message)
  }

  await db.insert(mediaItems).values({
    id: itemId,
    generationId: sourceItem.generationId,
    type: 'video',
    parentId: mediaItemId,
    prompt: videoPrompt,
    runpodJobId: jobId,
    status: jobId ? 'processing' : 'failed',
    error: jobId ? null : 'Failed to submit to RunPod',
    metadata: JSON.stringify({ apiUrl }),
    createdAt: now,
  })

  // Background completion — server keeps polling even if frontend disconnects
  if (jobId) {
    const cf = (event.context as any).cloudflare
    const mediaBucket = useMediaBucket(event)
    if (cf?.context?.waitUntil) {
      console.log(`[I2V+Audio] Scheduling background completion via waitUntil`)
      cf.context.waitUntil(backgroundComplete(db, mediaBucket, [itemId]))
    }
  }

  return {
    item: {
      id: itemId,
      generationId: sourceItem.generationId,
      type: 'video',
      parentId: mediaItemId,
      status: jobId ? 'processing' : 'failed',
      url: null,
    },
  }
})
