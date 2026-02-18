/**
 * Client-side route middleware: redirects unauthenticated users to `/login`.
 *
 * Because `useAuth()` uses `lazy: false`, the auth state is already resolved
 * by the time middleware runs. No need for manual refresh/await logic.
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
