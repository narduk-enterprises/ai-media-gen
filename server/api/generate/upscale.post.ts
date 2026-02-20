import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl, callRunPodAsync } from '../../utils/ai'
import { useMediaBucket, readBase64FromR2 } from '../../utils/r2'
import { mediaItems, generations } from '../../database/schema'

const upscaleSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
  scale: z.number().min(2).max(4).optional().default(2),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = upscaleSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId, scale, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)
  const db = useDatabase()

  const source = await db
    .select()
    .from(mediaItems)
    .innerJoin(generations, eq(mediaItems.generationId, generations.id))
    .where(and(eq(mediaItems.id, mediaItemId), eq(generations.userId, user.id)))
    .limit(1)

  if (!source[0]) {
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  const sourceItem = source[0].media_items
  if (sourceItem.type !== 'image' || !sourceItem.url) {
    throw createError({ statusCode: 400, message: 'Source must be a completed image' })
  }

  // Read source image as base64
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

  const now = new Date().toISOString()
  const enhancedId = crypto.randomUUID()

  const runpodInput = {
    action: 'upscale' as const,
    image: imageBase64,
    scale,
  }

  // Insert as queued
  await db.insert(mediaItems).values({
    id: enhancedId,
    generationId: sourceItem.generationId,
    type: 'image',
    parentId: mediaItemId,
    prompt: sourceItem.prompt || source[0].generations.prompt || '',
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, runpodInput, isUpscale: true, scale }),
    createdAt: now,
  })

  console.log(`[Upscale] Item queued: ${enhancedId.slice(0, 8)} (${scale}x)`)

  // Submit in background
  waitUntil((async () => {
    try {
      const result = await callRunPodAsync(runpodInput, apiUrl)
      await db.update(mediaItems)
        .set({
          status: 'processing',
          runpodJobId: result.jobId,
          submittedAt: new Date().toISOString(),
          metadata: JSON.stringify({ apiUrl: result.apiUrl, runpodInput, isUpscale: true, scale }),
        })
        .where(eq(mediaItems.id, enhancedId))
      console.log(`[Upscale] ✅ Submitted ${enhancedId.slice(0, 8)} → job ${result.jobId}`)
    } catch (e: any) {
      console.warn(`[Upscale] ⚠️ Submit failed for ${enhancedId.slice(0, 8)}, cron will retry:`, e.message)
    }
  })())

  return {
    item: {
      id: enhancedId,
      generationId: sourceItem.generationId,
      type: 'image',
      parentId: mediaItemId,
      runpodJobId: null,
      status: 'queued',
      url: null,
    },
  }
})
