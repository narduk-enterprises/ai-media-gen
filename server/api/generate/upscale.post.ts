import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { submitItemToComfyUI } from '../../utils/submitItem'
import { useMediaBucket, readBase64FromR2 } from '../../utils/r2'
import { mediaItems, generations } from '../../database/schema'

const upscaleSchema = z.object({
  mediaItemId: z.string().uuid('Invalid media item ID'),
  scale: z.number().min(2).max(4).optional().default(2),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = upscaleSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { mediaItemId, scale } = parsed.data
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
  const isVideo = sourceItem.type === 'video'

  if (!sourceItem.url) {
    throw createError({ statusCode: 400, message: 'Source must be a completed media item with a URL' })
  }

  // Read source media as base64
  let mediaBase64: string | null = null

  if (!isVideo) {
    const base64Match = sourceItem.url.match(/^data:image\/\w+;base64,(.+)$/)
    if (base64Match) {
      mediaBase64 = base64Match[1]!
    } else {
      const bucket = useMediaBucket(event)
      if (bucket) {
        mediaBase64 = await readBase64FromR2(bucket, mediaItemId)
      }
    }
  } else {
    try {
      const resp = await fetch(sourceItem.url)
      if (resp.ok) {
        const buf = await resp.arrayBuffer()
        const uint8 = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]!)
        mediaBase64 = btoa(binary)
      }
    } catch (e: any) {
      console.warn(`[Upscale] Failed to fetch video: ${e.message}`)
    }
  }

  if (!mediaBase64) {
    throw createError({ statusCode: 400, message: `Could not read source ${isVideo ? 'video' : 'image'} data` })
  }

  const now = new Date().toISOString()
  const enhancedId = crypto.randomUUID()

  const comfyInput = isVideo
    ? { action: 'upscale_video' as const, video: mediaBase64, scale, fps: 24 }
    : { action: 'upscale' as const, image: mediaBase64, scale }

  await db.insert(mediaItems).values({
    id: enhancedId,
    generationId: sourceItem.generationId,
    type: isVideo ? 'video' : 'image',
    parentId: mediaItemId,
    prompt: sourceItem.prompt || source[0].generations.prompt || '',
    status: 'queued',
    metadata: JSON.stringify({ comfyInput, isUpscale: true, scale }),
    createdAt: now,
  })

  console.log(`[Upscale] Item queued: ${enhancedId.slice(0, 8)} (${scale}x ${isVideo ? 'video' : 'image'})`)

  waitUntil(submitItemToComfyUI(db, enhancedId))

  return {
    item: {
      id: enhancedId,
      generationId: sourceItem.generationId,
      type: isVideo ? 'video' : 'image',
      parentId: mediaItemId,
      runpodJobId: null,
      status: 'queued',
      url: null,
    },
  }
})
