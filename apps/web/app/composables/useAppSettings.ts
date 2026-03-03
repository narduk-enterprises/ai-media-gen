/**
 * App settings composable — SSR-safe.
 *
 * Pod routing is now fully server-side (smart least-loaded selection).
 * This composable only provides backward-compatible type exports
 * and an empty effectiveEndpoint so API routes let the server decide.
 */

export type PodProfile = 'image' | 'video' | 'full'

export interface PodEndpoint {
  url: string
  profile: PodProfile
  label?: string
}

export function useAppSettings() {
  /**
   * effectiveEndpoint — always empty string.
   * Server-side resolveApiUrl() auto-discovers running pods
   * and routes to the least-loaded one.
   */
  const effectiveEndpoint = computed(() => '')

  // Backward-compatible aliases (all no-ops)
  const gpuServerUrl = computed({
    get: () => '',
    set: (_val: string) => {},
  })

  const pods = computed({
    get: () => [] as PodEndpoint[],
    set: (_val: PodEndpoint[]) => {},
  })

  return {
    pods,
    gpuServerUrl,
    effectiveEndpoint,
    // Legacy aliases
    comfyuiServer: gpuServerUrl,
    backendMode: computed(() => 'comfyui' as const),
    runpodEndpoint: computed(() => '' as const),
    customEndpoint: computed(() => '' as const),
  }
}
