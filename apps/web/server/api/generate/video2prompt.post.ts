import { eq } from 'drizzle-orm'


import { generations, mediaItems, users } from '../../database/schema'

/**
 * POST /api/generate/video2prompt
 *
 * Accepts a multipart form upload with:
 *   - video: File (the video binary)
 *   - frames: number (optional, default 16)
 *   - customSystemPrompt: string (optional)
 *   - targetModel: string (optional)
 *   - endpointOverride: string (optional)
 *
 * Uploads the video to R2, then queues a video2prompt job
 * that passes the R2 URL to the pod (no base64 in the payload).
 */
export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form || form.length === 0) {
    throw createError({ statusCode: 400, message: 'Multipart form data required. Send the video as a file field named "video".' })
  }

  // Parse fields from multipart data
  let videoFile: { data: Buffer; filename?: string; type?: string } | null = null
  const fields: Record<string, string> = {}

  for (const part of form) {
    if (part.name === 'video' && part.data && part.data.length > 1000) {
      videoFile = { data: part.data, filename: part.filename, type: part.type }
    } else if (part.name && part.data) {
      fields[part.name] = part.data.toString('utf-8')
    }
  }

  if (!videoFile) {
    throw createError({ statusCode: 400, message: 'No video file found in the upload. Include a file field named "video".' })
  }

  const framesVal = Number.parseInt(fields.frames || '16', 10) || 16
  const customSystemPrompt = fields.customSystemPrompt || ''
  const targetModel = fields.targetModel || 'Qwen2.5-VL-7B-Instruct-AWQ'
  const endpointOverride = fields.endpointOverride || undefined

  const db = useDatabase(event)

  // Get default user
  const batchUser = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, 'narduk@mac.com')).limit(1).get()

  if (!batchUser) {
    throw createError({ statusCode: 500, message: 'Default user not found' })
  }

  // Upload video to R2 with a temporary key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  const cf = (event.context as any).cloudflare?.env
  const bucket: R2Bucket | null = cf?.MEDIA ?? null
  if (!bucket) {
    throw createError({ statusCode: 500, message: 'R2 storage not available' })
  }

  const videoId = crypto.randomUUID()
  const r2Key = `tmp/video2prompt/${videoId}.mp4`

  await bucket.put(r2Key, new Uint8Array(videoFile.data).buffer as ArrayBuffer, {
    httpMetadata: {
      contentType: videoFile.type || 'video/mp4',
    },
  })

  // Build a public URL the pod can download from
  const config = useRuntimeConfig()
  const appUrl = config.public?.appUrl || config.public?.siteUrl || ''
  const videoUrl = `${appUrl}/api/media/${r2Key}`

  const now = new Date().toISOString()

  // Resolve which machine to use
  const apiUrl = await resolveApiUrl(endpointOverride, 'video')
  if (!apiUrl) {
    throw createError({ statusCode: 503, message: 'No available machines for video processing' })
  }

  try {
    const genId = crypto.randomUUID()
    const itemId = crypto.randomUUID()

    await db.insert(generations).values({
      id: genId,
      userId: batchUser.id,
      prompt: customSystemPrompt || 'Auto-generate prompt',
      imageCount: 1,
      status: 'processing',
      createdAt: now,
    })

    // Payload uses video_url instead of base64 — the pod will download it
    const inputPayload = {
      action: 'video2prompt',
      video_url: videoUrl,
      frames: framesVal,
      custom_system_prompt: customSystemPrompt,
      target_model: targetModel,
    }

    await db.insert(mediaItems).values({
      id: itemId,
      generationId: genId,
      type: 'text',
      prompt: customSystemPrompt || 'Auto-generate prompt',
      status: 'queued',
      metadata: JSON.stringify({ apiUrl, comfyInput: inputPayload, r2Key }),
      createdAt: now,
    })

    console.log(`[video2prompt] Queued generation ${genId.slice(0, 8)} -> Item ${itemId.slice(0, 8)} (video: ${(videoFile.data.length / 1048576).toFixed(1)}MB -> R2 ${r2Key})`)

    // Background submit
    event.waitUntil(submitItemToPod(db, itemId))

    return {
      success: true,
      jobId: genId,
      itemId,
      status: 'queued',
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (error: any) {
    console.error('[video2prompt] Error queuing job:', error.message)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to queue video2prompt job',
    })
  }
})
