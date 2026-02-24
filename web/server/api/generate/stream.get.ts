/**
 * GET /api/generate/stream
 *
 * SSE endpoint for real-time queue updates.
 * The client connects and receives events as items are submitted, completed, or failed.
 *
 * Events:
 *   - snapshot: initial full queue state on connect
 *   - item:submitted: new item added to queue
 *   - item:completed: item finished successfully
 *   - item:failed: item failed
 *   - item:progress: segment progress update
 *   - ping: keepalive heartbeat (every 30s)
 */
import { eq } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'
import { registerConnection, removeConnection } from '../../utils/sseBroadcast'

export default defineEventHandler(async (event) => {
  // ── Auth ──────────────────────────────────────────────────────
  const user = event.context._authUser
  if (!user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const userId = user.id

  // ── Set SSE headers ──────────────────────────────────────────
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  })

  // ── Create SSE stream ────────────────────────────────────────
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Helper to send SSE event
  const sendEvent = (eventName: string, data: any) => {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
    writer.write(encoder.encode(message)).catch(() => {})
  }

  // ── Send initial snapshot ────────────────────────────────────
  try {
    const db = useDatabase()
    const items = await db.select({
      id: mediaItems.id,
      generationId: mediaItems.generationId,
      type: mediaItems.type,
      status: mediaItems.status,
      prompt: mediaItems.prompt,
      url: mediaItems.url,
      error: mediaItems.error,
      createdAt: mediaItems.createdAt,
      submittedAt: mediaItems.submittedAt,
    }).from(mediaItems)
      .where(eq(mediaItems.dismissedAt, ''))
      .limit(100)

    sendEvent('snapshot', { items })
  } catch (e: any) {
    console.warn(`[SSE] Snapshot failed: ${e.message}`)
  }

  // ── Register connection ──────────────────────────────────────
  const conn = registerConnection(userId, writer)

  // ── Heartbeat ────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    try {
      writer.write(encoder.encode('event: ping\ndata: {}\n\n')).catch(() => {
        clearInterval(heartbeat)
      })
    } catch {
      clearInterval(heartbeat)
    }
  }, 30_000)

  // ── Cleanup on close ─────────────────────────────────────────
  event.node?.req?.on?.('close', () => {
    clearInterval(heartbeat)
    removeConnection(userId, conn)
    writer.close().catch(() => {})
  })

  return readable
})
