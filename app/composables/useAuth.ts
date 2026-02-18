/**
 * Global auth composable.
 *
 * Provides reactive `user`, `loggedIn`, and helper methods (`login`, `signup`,
 * `logout`, `refresh`). State is shared across the app via `useAsyncData`.
 *
 * SSR strategy (Cloudflare Workers compatible):
 * - Auth is resolved BEFORE the Vue app renders, by a Nitro server middleware
 *   that queries D1 directly (server/middleware/03.auth.ts).
 * - A Nuxt server plugin bridges the result into useState('auth-user-ssr').
 * - This composable reads from useState on the server — zero internal fetches.
 * - On the client, $fetch('/api/auth/me') is used for re-validation.
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
  const { data: user, refresh, status } = useAsyncData<AuthUser | null>(
    'auth-user',
    async () => {
      // ── Server (SSR): read pre-resolved auth from useState ──
      // The Nitro middleware already validated the session cookie against D1
      // and the Nuxt server plugin stored the result in useState.
      // No internal $fetch needed — this is instant and reliable on CF Workers.
      if (import.meta.server) {
        const ssrAuth = useState<AuthUser | null>('auth-user-ssr')
        return ssrAuth.value ?? null
      }

      // ── Client: fetch from API (cookies sent automatically by browser) ──
      try {
        const res = await $fetch<{ user: AuthUser | null }>('/api/auth/me')
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
