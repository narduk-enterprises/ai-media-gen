/**
 * Nuxt server plugin: bridges auth from Nitro → Vue SSR.
 *
 * Reads the pre-resolved user from `event.context._authUser` (set by
 * server/middleware/03.auth.ts) and stores it in useState('auth-user')
 * so the useAuth composable can access it synchronously during SSR.
 */
export default defineNuxtPlugin(() => {
  const event = useRequestEvent()
  const authUser = event?.context?._authUser ?? null

  // Use the SAME key as useAuth's useState — this initializes it
  // before any component setup runs, so loggedIn is correct immediately.
  useState('auth-user', () => authUser)
})
