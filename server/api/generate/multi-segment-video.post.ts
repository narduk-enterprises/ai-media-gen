import { z } from 'zod'
import { waitUntil } from 'cloudflare:workers'
import { requireAuth } from '../../utils/auth'
import { resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems } from '../../database/schema'
import { submitItemToComfyUI } from '../../utils/submitItem'

const segmentSchema = z.object({
  type: z.enum(['text2video', 'image2video']),
  prompt: z.string(),
  frames: z.number().min(25).max(721).optional().default(121),
  steps: z.number().min(1).max(50).optional().default(20),
  camera_lora: z.string().optional(),
  preset: z.string().optional(),
  image: z.string().optional(), // 'auto' for frame continuity
})

const bodySchema = z.object({
  segments: z.array(segmentSchema).min(1).max(10),
  width: z.number().min(256).max(1920).optional().default(1280),
  height: z.number().min(256).max(1920).optional().default(720),
  fps: z.number().min(8).max(60).optional().default(24),
  transition: z.enum(['crossfade', 'cut']).optional().default('crossfade'),
  transitionDuration: z.number().min(0).max(2).optional().default(0.5),
  endpoint: z.string().optional(),
})

/**
 * POST /api/generate/multi-segment-video
 *
 * Submits a multi-segment video job to the GPU pod.
 * This action requires `handler.py` on the pod (ffmpeg + sequential generation).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { segments, width, height, fps, transition, transitionDuration, endpoint } = parsed.data
  const apiUrl = resolveApiUrl(endpoint)
  const db = useDatabase()
  const now = new Date().toISOString()

  // Create a generation record
  const genId = crypto.randomUUID()
  const firstPrompt = segments[0]!.prompt.slice(0, 120) + (segments[0]!.prompt.length > 120 ? '…' : '')
  await db.insert(generations).values({
    id: genId,
    userId: user.id,
    prompt: `Multi-segment (${segments.length} clips): ${firstPrompt}`,
    imageCount: 1,
    status: 'processing',
    createdAt: now,
  })

  const videoId = crypto.randomUUID()

  // Build the RunPod input — multi-segment runs on the GPU pod
  const comfyInput = {
    action: 'multi_segment_video',
    width, height, fps,
    transition, transition_duration: transitionDuration,
    segments: segments.map(s => ({
      type: s.type,
      prompt: s.prompt,
      frames: s.frames,
      steps: s.steps,
      ...(s.camera_lora ? { camera_lora: s.camera_lora } : {}),
      ...(s.preset ? { preset: s.preset } : {}),
      ...(s.image ? { image: s.image } : {}),
    })),
  }

  await db.insert(mediaItems).values({
    id: videoId,
    generationId: genId,
    type: 'video',
    prompt: firstPrompt,
    status: 'queued',
    metadata: JSON.stringify({ apiUrl, comfyInput }),
    createdAt: now,
  })

  console.log(`[MultiSeg] Queued ${segments.length}-segment video: ${videoId.slice(0, 8)}`)

  waitUntil(submitItemToComfyUI(db, videoId))

  return {
    generation: { id: genId, prompt: firstPrompt, imageCount: 1, status: 'processing', createdAt: now },
    item: { id: videoId, generationId: genId, type: 'video', status: 'queued', url: null },
  }
})
