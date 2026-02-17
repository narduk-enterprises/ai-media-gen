/**
 * Client-side route middleware: redirects unauthenticated users to `/`.
 *
 * Usage in a page:
 *   definePageMeta({ middleware: 'auth' })
 */
export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, refresh, loading } = useAuth()

  // Wait for auth state to fully resolve before deciding
  if (loading.value) {
    await refresh()
  }

  if (!loggedIn.value) {
    return navigateTo('/')
  }
})
