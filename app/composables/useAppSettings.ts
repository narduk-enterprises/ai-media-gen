type EndpointType = 'full' | 'slim' | 'eu'

interface AppSettings {
  runpodEndpoint: EndpointType
}

const STORAGE_KEY = 'app-settings'

const defaults: AppSettings = {
  runpodEndpoint: 'full',
}

function load(): AppSettings {
  if (import.meta.server) return { ...defaults }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

function save(settings: AppSettings) {
  if (import.meta.server) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const state = ref<AppSettings>(load())

export function useAppSettings() {
  const runpodEndpoint = computed({
    get: () => state.value.runpodEndpoint,
    set: (val: EndpointType) => {
      state.value = { ...state.value, runpodEndpoint: val }
      save(state.value)
    },
  })

  return {
    runpodEndpoint,
  }
}
