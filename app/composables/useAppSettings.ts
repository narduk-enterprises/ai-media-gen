/**
 * App settings composable — SSR-safe.
 *
 * Uses useState (SSR payload) for defaults, defers localStorage
 * hydration to client mount to avoid hydration mismatches.
 */

interface AppSettings {
  /** GPU pod server URL (e.g. https://xxx.proxy.runpod.net) */
  gpuServerUrl: string
}

const STORAGE_KEY = 'app-settings'

const defaults: AppSettings = {
  gpuServerUrl: '',
}

function save(settings: AppSettings) {
  if (import.meta.server) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function useAppSettings() {
  // useState ensures consistent SSR → client hydration
  const state = useState<AppSettings>('app-settings', () => ({ ...defaults }))

  // Hydrate from localStorage only on the client, after mount
  if (import.meta.client) {
    onNuxtReady(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)

          // Migrate from old format: prefer comfyuiServer > customEndpoint
          if (parsed.comfyuiServer && !parsed.gpuServerUrl) {
            parsed.gpuServerUrl = parsed.comfyuiServer
          } else if (parsed.customEndpoint && !parsed.gpuServerUrl) {
            parsed.gpuServerUrl = parsed.customEndpoint
          }

          state.value = { ...defaults, ...parsed }
        }
      } catch {}
    })
  }

  const gpuServerUrl = computed({
    get: () => state.value.gpuServerUrl,
    set: (val: string) => {
      state.value = { ...state.value, gpuServerUrl: val }
      save(state.value)
    },
  })

  /** The effective endpoint URL sent to API routes */
  const effectiveEndpoint = computed(() => {
    return state.value.gpuServerUrl?.replace(/\/+$/, '') || ''
  })

  return {
    gpuServerUrl,
    effectiveEndpoint,
    // Backward-compatible aliases for code that still references old names
    comfyuiServer: gpuServerUrl,
    backendMode: computed(() => 'comfyui' as const),
    runpodEndpoint: computed(() => '' as const),
    customEndpoint: computed(() => '' as const),
  }
}
