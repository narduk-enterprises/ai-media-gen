/**
 * sseBroadcast.ts — In-memory SSE connection registry.
 *
 * Manages per-user SSE connections and broadcasts events to all
 * connected clients for a given user (identified by generationId → userId).
 *
 * Note: On Cloudflare Workers, each isolate has its own connection map.
 * This works well for single-instance deployments. For multi-instance,
 * the cron/polling fallback ensures eventual consistency.
 */

interface SSEConnection {
  writer: WritableStreamDefaultWriter
  userId: string
}

// generationId or userId → set of writers
const _connections = new Map<string, Set<SSEConnection>>()

/**
 * Register an SSE connection for a user.
 */
export function registerConnection(userId: string, writer: WritableStreamDefaultWriter) {
  const conn: SSEConnection = { writer, userId }
  if (!_connections.has(userId)) {
    _connections.set(userId, new Set())
  }
  _connections.get(userId)!.add(conn)
  console.log(`[SSE] Connected: ${userId.slice(0, 8)} (${_connections.get(userId)!.size} total)`)
  return conn
}

/**
 * Remove an SSE connection.
 */
export function removeConnection(userId: string, conn: SSEConnection) {
  const set = _connections.get(userId)
  if (set) {
    set.delete(conn)
    if (set.size === 0) _connections.delete(userId)
  }
}

/**
 * Broadcast an SSE event to all connections for a user.
 * Silently drops connections that have closed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
export function broadcast(userId: string, event: string, data: any) {
  // Try by userId directly
  const set = _connections.get(userId)
  if (!set || set.size === 0) return

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoder = new TextEncoder()
  const encoded = encoder.encode(message)

  const dead: SSEConnection[] = []
  for (const conn of set) {
    try {
      conn.writer.write(encoded)
    } catch {
      dead.push(conn)
    }
  }

  for (const conn of dead) {
    set.delete(conn)
  }
  if (set.size === 0) _connections.delete(userId)
}

/**
 * Broadcast to a user by looking up from generationId.
 * This is a convenience for the webhook handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
export function broadcastByGenerationId(generationId: string, event: string, data: any) {
  // We broadcast to all users — the generation's userId lookup happens at call site
  // This is called from the webhook with userId already resolved
  broadcast(generationId, event, data)
}

/**
 * Get the number of active connections for a user.
 */
export function getConnectionCount(userId: string): number {
  return _connections.get(userId)?.size ?? 0
}
