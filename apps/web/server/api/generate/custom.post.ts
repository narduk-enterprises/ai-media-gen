import { z } from 'zod'



import { generations, mediaItems } from '../../database/schema'

const schema = z.object({
  workflow: z.record(z.string(), z.any()),
  label: z.string().default('Custom Workflow'),
  expectVideo: z.boolean().default(false),
  endpoint: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid input' })
  }

  const { workflow, label, expectVideo, endpoint } = parsed.data
  const apiUrl = await resolveApiUrl(endpoint, 'video')

  const db = useDatabase(event)
  const generationId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const now = new Date().toISOString()
  const mediaType = expectVideo ? 'video' : 'image'

  const settings = JSON.stringify({ label, expectVideo, workflow })

  await db.insert(generations).values({
    id: generationId,
    userId: user.id,
    prompt: label,
    imageCount: 1,
    status: 'processing',
    settings,
    createdAt: now,
  })

  await db.insert(mediaItems).values({
    id: itemId,
    generationId,
    type: mediaType,
    prompt: label,
    status: 'queued',
    metadata: JSON.stringify({
      apiUrl,
      comfyInput: {
        action: 'custom_workflow',
        workflow,
        expect_video: expectVideo,
      },
    }),
    createdAt: now,
  })

  console.log(`[Custom] Item queued: ${itemId.slice(0, 8)}`)

  event.waitUntil(submitItemToComfyUI(db, itemId))

  return {
    generation: { id: generationId, prompt: label, imageCount: 1, status: 'processing', settings, createdAt: now },
    items: [{
      id: itemId, generationId, type: mediaType, prompt: label,
      runpodJobId: null, parentId: null, url: null,
      status: 'queued', error: null, metadata: null, createdAt: now,
    }],
  }
})
