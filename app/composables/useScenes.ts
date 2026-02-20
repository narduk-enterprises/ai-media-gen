/**
 * useScenes — composable for saving and loading scene setups.
 *
 * Each "scene" stores the 6 scene/environment attributes (scene, pose, style,
 * lighting, mood, camera) that feed into the prompt builder. This lets you
 * reuse the same scene setups across different personas and batch-generate
 * persona × scene combinations.
 */
import { sceneAttributeKeys } from '~/utils/promptBuilder'

const STORAGE_KEY = 'ai-media-gen:scenes'

// ─── Data Model ──────────────────────────────────────────────────────────

export interface Scene {
  id: string
  name: string
  createdAt: string
  scene: string
  pose: string
  style: string
  lighting: string
  mood: string
  camera: string
}

export type SceneAttributes = Pick<Scene, 'scene' | 'pose' | 'style' | 'lighting' | 'mood' | 'camera'>

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadScenes(): Scene[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function persistScenes(scenes: Scene[]) {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes))
  } catch { /* ignore */ }
}

// ─── Composable ──────────────────────────────────────────────────────────

export function useScenes() {
  // useState ensures SSR → client hydration parity (no mismatch)
  const scenes = useState<Scene[]>('scenes', () => [])

  // Hydrate from localStorage only on the client, after mount
  if (import.meta.client) {
    onNuxtReady(() => {
      if (scenes.value.length === 0) {
        const loaded = loadScenes()
        if (loaded.length > 0) scenes.value = loaded
      }
    })
  }

  function _save() {
    persistScenes(scenes.value)
  }

  function addScene(name: string, attrs: Partial<SceneAttributes> = {}): Scene {
    const scene: Scene = {
      id: generateId(),
      name: name.trim() || 'Untitled',
      createdAt: new Date().toISOString(),
      scene: attrs.scene?.trim() ?? '',
      pose: attrs.pose?.trim() ?? '',
      style: attrs.style?.trim() ?? '',
      lighting: attrs.lighting?.trim() ?? '',
      mood: attrs.mood?.trim() ?? '',
      camera: attrs.camera?.trim() ?? '',
    }
    scenes.value.unshift(scene)
    _save()
    return scene
  }

  function getScene(id: string): Scene | undefined {
    return scenes.value.find(s => s.id === id)
  }

  function deleteScene(id: string) {
    scenes.value = scenes.value.filter(s => s.id !== id)
    _save()
  }

  function renameScene(id: string, newName: string) {
    const scene = scenes.value.find(s => s.id === id)
    if (scene) {
      scene.name = newName.trim() || 'Untitled'
      _save()
    }
  }

  function updateScene(id: string, attrs: Partial<SceneAttributes>) {
    const scene = scenes.value.find(s => s.id === id)
    if (!scene) return
    for (const key of sceneAttributeKeys) {
      if (key in attrs) {
        scene[key] = (attrs[key as keyof SceneAttributes] ?? '').trim()
      }
    }
    _save()
  }

  function duplicateScene(id: string): Scene | null {
    const source = scenes.value.find(s => s.id === id)
    if (!source) return null
    return addScene(`${source.name} (Copy)`, {
      scene: source.scene,
      pose: source.pose,
      style: source.style,
      lighting: source.lighting,
      mood: source.mood,
      camera: source.camera,
    })
  }

  /**
   * Import one or more scenes from a JSON object or array.
   *
   * Accepts:
   *  - A single object: `{ name, scene, pose, style, lighting, mood, camera }`
   *  - An array of such objects
   *
   * Returns the list of created Scene records.
   */
  function importScenes(json: unknown): Scene[] {
    const items = Array.isArray(json) ? json : [json]
    const created: Scene[] = []
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const obj = item as Record<string, unknown>
      const name = typeof obj.name === 'string' ? obj.name : 'Imported'
      const attrs: Partial<SceneAttributes> = {}
      for (const key of sceneAttributeKeys) {
        if (typeof obj[key] === 'string') attrs[key as keyof SceneAttributes] = obj[key] as string
      }
      created.push(addScene(name, attrs))
    }
    return created
  }

  function exportScene(id: string): Record<string, string> | null {
    const scene = scenes.value.find(s => s.id === id)
    if (!scene) return null
    const result: Record<string, string> = { name: scene.name }
    for (const key of sceneAttributeKeys) {
      if (scene[key]) result[key] = scene[key]
    }
    return result
  }

  return {
    scenes: readonly(scenes),
    addScene,
    getScene,
    deleteScene,
    renameScene,
    updateScene,
    duplicateScene,
    importScenes,
    exportScene,
  }
}
