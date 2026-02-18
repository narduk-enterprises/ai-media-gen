/**
 * useSavedSetups — composable for saving and loading generation configurations.
 *
 * Stores named setups in localStorage so users can quickly switch between
 * their favourite generation configurations on the create page.
 */
import { type AttributeKey, attributeKeys } from '~/utils/promptBuilder'

const STORAGE_KEY = 'ai-media-gen:saved-setups'

export interface SavedSetup {
  id: string
  name: string
  createdAt: string
  /** Generation settings */
  prompt: string
  negativePrompt: string
  genMode: 'image' | 'video'
  imageCount: number
  steps: number
  imageWidth: number
  imageHeight: number
  videoDuration: number
  videoCfg: number
  varyPerImage: boolean
  /** Prompt builder attributes */
  attributes: Record<AttributeKey, string>
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadSetups(): SavedSetup[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function persistSetups(setups: SavedSetup[]) {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setups))
  } catch { /* ignore */ }
}

export function useSavedSetups() {
  const setups = ref<SavedSetup[]>(loadSetups())

  function saveSetup(
    name: string,
    settings: Omit<SavedSetup, 'id' | 'name' | 'createdAt'>,
  ): SavedSetup {
    const setup: SavedSetup = {
      id: generateId(),
      name: name.trim() || 'Untitled',
      createdAt: new Date().toISOString(),
      ...settings,
    }
    setups.value.unshift(setup)
    persistSetups(setups.value)
    return setup
  }

  function getSetup(id: string): SavedSetup | undefined {
    return setups.value.find(s => s.id === id)
  }

  function deleteSetup(id: string) {
    setups.value = setups.value.filter(s => s.id !== id)
    persistSetups(setups.value)
  }

  function renameSetup(id: string, newName: string) {
    const setup = setups.value.find(s => s.id === id)
    if (setup) {
      setup.name = newName.trim() || 'Untitled'
      persistSetups(setups.value)
    }
  }

  return {
    setups: readonly(setups),
    saveSetup,
    getSetup,
    deleteSetup,
    renameSetup,
  }
}
