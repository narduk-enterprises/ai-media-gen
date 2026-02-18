/**
 * Global auth composable.
 *
 * Provides reactive `user`, `loggedIn`, and helper methods (`login`, `signup`,
 * `logout`, `refresh`). State is shared across the app via `useAsyncData`.
 *
 * Key design decisions:
 * - NOT lazy: auth state must resolve before rendering to prevent flash of
 *   unauthenticated content / incorrect redirects.
 * - SSR context (useRequestEvent, useRequestFetch) is captured in the
 *   composable's setup scope — NOT inside the useAsyncData handler — because
 *   Cloudflare Workers can lose async context inside callbacks.
 * - `useRequestFetch` automatically forwards cookies during SSR, avoiding
 *   fragile manual header copying.
 *
 * Usage:
 *   const { user, loggedIn, login, logout } = useAuth()
 */

interface AuthUser {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
}

export function useAuth() {
  // CRITICAL: Capture SSR context in the composable's setup scope, NOT inside
  // the useAsyncData handler. On Cloudflare Workers, the Nuxt/Nitro async
  // context can be lost inside async callbacks, causing useRequestEvent() to
  // return undefined and the session cookie check to silently fail.
  const requestFetch = useRequestFetch()
  const ssrEvent = import.meta.server ? useRequestEvent() : undefined

  const { data: user, refresh, status } = useAsyncData<AuthUser | null>(
    'auth-user',
    async () => {
      // On the server, check for the session cookie first — skip the fetch
      // entirely if there is no cookie (avoids an unnecessary internal request).
      if (import.meta.server) {
        const sessionId = ssrEvent ? getCookie(ssrEvent, 'session') : undefined
        if (!sessionId) return null
      }

      try {
        // useRequestFetch() automatically forwards cookies during SSR,
        // eliminating the need for manual header copying which is fragile
        // on edge runtimes like Cloudflare Workers.
        const res = await requestFetch<{ user: AuthUser | null }>('/api/auth/me')
        return res.user ?? null
      } catch {
        return null
      }
    },
    {
      // Do NOT use lazy — auth must resolve before page renders / middleware runs
      lazy: false,
      // Cache across navigations within the same session
      dedupe: 'defer',
    },
  )

  const loggedIn = computed(() => !!user.value)
  const loading = computed(() => status.value === 'pending')

  async function login(email: string, password: string) {
    const res = await $fetch<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      body: { email, password },
    })
    user.value = res.user
    return res.user
  }

  async function signup(email: string, password: string, name?: string) {
    const res = await $fetch<{ user: AuthUser }>('/api/auth/signup', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      body: { email, password, name },
    })
    user.value = res.user
    return res.user
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } })
    user.value = null
  }

  return {
    user: readonly(user) as Readonly<Ref<AuthUser | null>>,
    loggedIn,
    loading,
    login,
    signup,
    logout,
    refresh,
  }
}
