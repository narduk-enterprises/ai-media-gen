/**
 * Nuxt server plugin: bridges auth from Nitro → Vue SSR.
 *
 * Reads the pre-resolved user from `event.context._authUser` (set by
 * server/middleware/03.auth.ts) and stores it in `useState` so the
 * useAuth composable can access it synchronously during SSR — no
 * internal $fetch needed.
 */
export default defineNuxtPlugin(() => {
  const event = useRequestEvent()
  const authUser = event?.context?._authUser ?? null
  useState('auth-user-ssr', () => authUser)
})
