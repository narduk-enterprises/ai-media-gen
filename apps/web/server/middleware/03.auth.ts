/**
 * Server middleware: resolve auth session from D1 on every request.
 *
 * Runs AFTER D1 init and stores the authenticated user in
 * `event.context._authUser`. This avoids any internal HTTP roundtrip
 * during SSR — the Nuxt app can read the user directly from the event
 * context, which is critical for Cloudflare Workers where internal
 * $fetch cookie forwarding is unreliable.
 */


export default defineEventHandler(async (event) => {
  const sessionId = getCookie(event, 'session')

  if (!sessionId) {
    event.context._authUser = null
    return
  }

  try {
    const result = await getSessionWithUser(event, sessionId)
    event.context._authUser = result
      ? {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        isAdmin: result.user.isAdmin,
      }
      : null
  } catch {
    event.context._authUser = null
  }
})
