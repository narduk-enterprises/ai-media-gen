/**
 * App settings composable — SSR-safe.
 *
 * Uses useState (SSR payload) for defaults, defers localStorage
 * hydration to client mount to avoid hydration mismatches.
 *
 * Supports multiple GPU pod endpoints, each tagged with a profile
 * (image, video, full) for intelligent request routing.
 */

export type PodProfile = 'image' | 'video' | 'full'

export interface PodEndpoint {
  /** GPU pod server URL (e.g. https://xxx-8188.proxy.runpod.net) */
  url: string
  /** Pod profile determining which generation types it handles */
  profile: PodProfile
  /** Human-readable label (e.g. "A30 Image Pod") */
  label?: string
}

interface AppSettings {
  /** Array of configured GPU pod endpoints */
  pods: PodEndpoint[]
}

const STORAGE_KEY = 'app-settings'

const defaults: AppSettings = {
  pods: [],
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

          // ── Migrate from old single-URL format ──
          // Old format: { gpuServerUrl: "https://..." }
          // Also: { comfyuiServer: "..." } or { customEndpoint: "..." }
          if (!parsed.pods) {
            const oldUrl =
              parsed.gpuServerUrl ||
              parsed.comfyuiServer ||
              parsed.customEndpoint ||
              ''
            if (oldUrl) {
              parsed.pods = [{ url: oldUrl, profile: 'full' as PodProfile, label: 'GPU Pod' }]
            } else {
              parsed.pods = []
            }
            delete parsed.gpuServerUrl
            delete parsed.comfyuiServer
            delete parsed.customEndpoint
          }

          state.value = { ...defaults, ...parsed }
        }
      } catch {}
    })
  }

  // ── Pod management ──
  const pods = computed({
    get: () => state.value.pods,
    set: (val: PodEndpoint[]) => {
      state.value = { ...state.value, pods: val }
      save(state.value)
    },
  })

  function addPod(pod: PodEndpoint) {
    state.value = { ...state.value, pods: [...state.value.pods, pod] }
    save(state.value)
  }

  function removePod(index: number) {
    const newPods = [...state.value.pods]
    newPods.splice(index, 1)
    state.value = { ...state.value, pods: newPods }
    save(state.value)
  }

  function updatePod(index: number, pod: PodEndpoint) {
    const newPods = [...state.value.pods]
    newPods[index] = pod
    state.value = { ...state.value, pods: newPods }
    save(state.value)
  }

  /** Get the best pod URL for a given profile */
  function getPodForProfile(profile: PodProfile): PodEndpoint | undefined {
    // Exact match first
    const exact = state.value.pods.find(p => p.url && p.profile === profile)
    if (exact) return exact
    // Fall back to 'full' profile pod (handles everything)
    const full = state.value.pods.find(p => p.url && p.profile === 'full')
    if (full) return full
    // Last resort: any pod with a URL
    return state.value.pods.find(p => p.url)
  }

  // ── Backward-compatible aliases ──
  // gpuServerUrl returns the first pod URL for backward compatibility
  const gpuServerUrl = computed({
    get: () => state.value.pods[0]?.url || '',
    set: (val: string) => {
      if (state.value.pods.length > 0) {
        updatePod(0, { ...state.value.pods[0]!, url: val })
      } else {
        addPod({ url: val, profile: 'full', label: 'GPU Pod' })
      }
    },
  })

  /** The effective endpoint URL sent to API routes (first pod) */
  const effectiveEndpoint = computed(() => {
    return state.value.pods[0]?.url?.replace(/\/+$/, '') || ''
  })

  return {
    pods,
    addPod,
    removePod,
    updatePod,
    getPodForProfile,
    gpuServerUrl,
    effectiveEndpoint,
    // Backward-compatible aliases
    comfyuiServer: gpuServerUrl,
    backendMode: computed(() => 'comfyui' as const),
    runpodEndpoint: computed(() => '' as const),
    customEndpoint: computed(() => '' as const),
  }
}
