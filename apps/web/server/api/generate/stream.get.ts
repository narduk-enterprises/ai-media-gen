/**
 * GET /api/generate/stream
 *
 * SSE endpoint for real-time queue updates.
 * Polls the DB every 5s within this isolate and pushes diffs to the client.
 *
 * On Cloudflare Workers, each request runs in its own isolate so we can't
 * rely on cross-isolate broadcast from the webhook handler. Instead, this
 * endpoint does its own lightweight DB polling and pushes state changes.
 *
 * Events:
 *   - snapshot: initial full queue state on connect
 *   - item:completed / item:failed: individual item status changes
 *   - ping: keepalive heartbeat (every 30s)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { eq, and, ne } from 'drizzle-orm'
import { mediaItems } from '../../database/schema'

const POLL_INTERVAL_MS = 5_000

export default defineEventHandler(async (event) => {
  // ── Auth ──────────────────────────────────────────────────────
  const _user = await requireAuth(event)

  // ── Set SSE headers ──────────────────────────────────────────
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // ── Create SSE stream ────────────────────────────────────────
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
      const send = (eventName: string, data: any) => {
        try {
          const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(message))
        } catch {
          /* stream closed */
        }
      }

      // ── Fetch current state ────────────────────────────────
      const db = useDatabase(event)
      const lastKnownStatuses: Record<string, string> = {}

      try {
        const items = await db
          .select({
            id: mediaItems.id,
            generationId: mediaItems.generationId,
            type: mediaItems.type,
            status: mediaItems.status,
            prompt: mediaItems.prompt,
            url: mediaItems.url,
            error: mediaItems.error,
            createdAt: mediaItems.createdAt,
            submittedAt: mediaItems.submittedAt,
          })
          .from(mediaItems)
          .where(and(ne(mediaItems.dismissedAt, '')))
          .limit(100)

        // Track initial statuses
        for (const item of items) {
          lastKnownStatuses[item.id] = item.status
        }

        send('snapshot', { items })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
      } catch (e: any) {
        console.warn(`[SSE] Snapshot failed: ${e.message}`)
      }

      // ── Poll for changes ───────────────────────────────────
      let pollCount = 0
      const maxPolls = 60 // ~5 min then close (client reconnects)

      const pollInterval = setInterval(async () => {
        pollCount++
        if (pollCount > maxPolls) {
          clearInterval(pollInterval)
          try {
            controller.close()
          } catch {}
          return
        }

        try {
          const currentItems = await db
            .select({
              id: mediaItems.id,
              status: mediaItems.status,
              url: mediaItems.url,
              error: mediaItems.error,
            })
            .from(mediaItems)
            .where(and(ne(mediaItems.dismissedAt, '')))
            .limit(100)

          // Diff against last known state
          for (const item of currentItems) {
            const prevStatus = lastKnownStatuses[item.id]

            if (!prevStatus) {
              // New item
              send('item:submitted', { itemId: item.id, status: item.status })
              lastKnownStatuses[item.id] = item.status
            } else if (prevStatus !== item.status) {
              // Status changed
              if (item.status === 'complete') {
                send('item:completed', { itemId: item.id, url: item.url })
              } else if (item.status === 'failed') {
                send('item:failed', { itemId: item.id, error: item.error })
              } else {
                send('item:progress', { itemId: item.id, status: item.status })
              }
              lastKnownStatuses[item.id] = item.status
            }
          }
        } catch {
          // DB query failed — skip this cycle
        }
      }, POLL_INTERVAL_MS)

      // ── Heartbeat ──────────────────────────────────────────
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))
        } catch {
          clearInterval(heartbeat)
          clearInterval(pollInterval)
        }
      }, 30_000)

      // Cleanup when request ends
      event.node?.req?.on?.('close', () => {
        clearInterval(pollInterval)
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
})
