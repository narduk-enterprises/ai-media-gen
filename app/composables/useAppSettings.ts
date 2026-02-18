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
