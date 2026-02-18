/**
 * Global auth composable.
 *
 * SSR strategy (Cloudflare Workers):
 * - A Nitro server middleware (03.auth.ts) resolves the session from D1.
 * - A Nuxt server plugin (auth.server.ts) stores the result in useState.
 * - This composable reads useState synchronously — zero async, zero fetch.
 * - On the client, login/signup/logout update useState directly.
 * - `refresh()` can be called to re-validate against the server.
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
  // State is pre-populated by auth.server.ts plugin during SSR.
  // On the client, it hydrates from the SSR payload automatically.
  // No useAsyncData, no internal $fetch during SSR — fully synchronous.
  const user = useState<AuthUser | null>('auth-user', () => null)

  const loggedIn = computed(() => !!user.value)

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

  /** Re-validate session against the server (client-side only). */
  async function refresh() {
    try {
      const res = await $fetch<{ user: AuthUser | null }>('/api/auth/me')
      user.value = res.user ?? null
    } catch {
      user.value = null
    }
  }

  return {
    user: readonly(user) as Readonly<Ref<AuthUser | null>>,
    loggedIn,
    login,
    signup,
    logout,
    refresh,
  }
}
