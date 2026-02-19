/**
 * App settings composable — SSR-safe.
 *
 * Uses useState (SSR payload) for defaults, defers localStorage
 * hydration to client mount to avoid hydration mismatches.
 */

type EndpointType = 'full' | 'slim' | 'eu'

interface AppSettings {
  runpodEndpoint: EndpointType
  customEndpoint: string
}

const STORAGE_KEY = 'app-settings'

const defaults: AppSettings = {
  runpodEndpoint: 'full',
  customEndpoint: '',
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
          state.value = { ...defaults, ...parsed }
        }
      } catch {}
    })
  }

  const runpodEndpoint = computed({
    get: () => state.value.runpodEndpoint,
    set: (val: EndpointType) => {
      state.value = { ...state.value, runpodEndpoint: val }
      save(state.value)
    },
  })

  const customEndpoint = computed({
    get: () => state.value.customEndpoint,
    set: (val: string) => {
      state.value = { ...state.value, customEndpoint: val }
      save(state.value)
    },
  })

  return {
    runpodEndpoint,
    customEndpoint,
  }
}
