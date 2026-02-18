/**
 * Client-side route middleware: redirects unauthenticated users to `/login`.
 *
 * Auth state is resolved synchronously via useState (populated by the
 * server plugin during SSR), so loggedIn is available immediately.
 *
 * Usage in a page:
 *   definePageMeta({ middleware: 'auth' })
 */
export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn } = useAuth()

  if (!loggedIn.value) {
    return navigateTo('/login')
  }
})
