import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { submitItemToPod } from '../../utils/submitItem'
import { resolveApiUrl } from '../../utils/ai'
import { generations, mediaItems, users } from '../../database/schema'

const video2PromptSchema = z.object({
  videoData: z.string().describe('Base64-encoded source video'),
  frames: z.number().default(16).describe('Number of frames to sample'),
  customSystemPrompt: z.string().optional().describe('Optional custom instructions for Qwen2.5-VL'),
  targetModel: z.string().default('Qwen2.5-VL-7B-Instruct-AWQ').describe('Model to use for extraction'),
  
  // Optional override for the target machine endpoint
  endpointOverride: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b) => video2PromptSchema.parse(b))
  
  const db = useDatabase()
  
  // Get the default user for now since auth might not be fully wired in this context
  const batchUser = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, 'narduk@mac.com')).limit(1).get()
  
  if (!batchUser) {
    throw createError({ statusCode: 500, message: 'Default user not found' })
  }

  const now = new Date().toISOString()
  
  // 1. Resolve which machine to use.
  const apiUrl = await resolveApiUrl(body.endpointOverride, 'video')
  if (!apiUrl) {
    throw createError({ statusCode: 503, message: 'No available machines for video processing' })
  }

  try {
    const genId = crypto.randomUUID()
    const itemId = crypto.randomUUID()
    
    // Create the generation record
    await db.insert(generations).values({
      id: genId,
      userId: batchUser.id,
      prompt: body.customSystemPrompt || 'Auto-generate prompt',
      imageCount: 1,
      status: 'processing',
      createdAt: now,
    })
    
    // Prepare the unified payload the worker expects
    const inputPayload = {
      action: 'video2prompt',
      video: body.videoData,
      frames: body.frames,
      custom_system_prompt: body.customSystemPrompt,
      target_model: body.targetModel,
    }

    await db.insert(mediaItems).values({
      id: itemId,
      generationId: genId,
      type: 'text', // it returns a text prompt
      prompt: body.customSystemPrompt || 'Auto-generate prompt',
      status: 'queued',
      metadata: JSON.stringify({ apiUrl, comfyInput: inputPayload }),
      createdAt: now,
    })

    console.log(`[video2prompt] Queued generation ${genId.slice(0, 8)} -> Item ${itemId.slice(0, 8)}`)

    // Background submit
    event.waitUntil(submitItemToPod(db, itemId))

    return {
      success: true,
      jobId: genId,
      itemId,
      status: 'queued',
    }
  } catch (error: any) {
    console.error('[video2prompt] Error queues job:', error.message)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to queue video2prompt job',
    })
  }
})
