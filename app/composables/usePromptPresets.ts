/**
 * usePromptPresets — project-based preset management.
 *
 * Each "project" holds its own set of custom presets + base prompts.
 * Users can create, switch, import/export, and delete projects.
 * Falls back to built-in defaults from promptBuilder.ts when a
 * project has no custom presets for a given category.
 */
import {
  attributePresets as defaultPresets,
  attributeKeys,
  type AttributeKey,
} from '~/utils/promptBuilder'

const STORAGE_KEY = 'ai-media-gen:projects'
const LEGACY_KEY = 'ai-media-gen:custom-presets'

// ─── Data Model ──────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  mergeWithDefaults: boolean
  basePrompts: string[]
  presets: Partial<Record<AttributeKey, string[]>>
}

export interface ProjectStore {
  activeProjectId: string | null
  projects: Project[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function createProject(name: string, data?: Partial<Pick<Project, 'basePrompts' | 'presets' | 'mergeWithDefaults'>>): Project {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: name.trim() || 'Untitled',
    createdAt: now,
    updatedAt: now,
    mergeWithDefaults: data?.mergeWithDefaults ?? true,
    basePrompts: data?.basePrompts ?? [],
    presets: data?.presets ?? {},
  }
}

/**
 * Migrate legacy single-config localStorage into a "Default" project.
 */
function migrateLegacy(): ProjectStore | null {
  if (import.meta.server) return null
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const legacy = JSON.parse(raw)
    const project = createProject('Default', {
      mergeWithDefaults: legacy.mergeWithDefaults ?? true,
      basePrompts: legacy.basePrompts ?? [],
      presets: legacy.custom ?? {},
    })
    const store: ProjectStore = { activeProjectId: project.id, projects: [project] }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    localStorage.removeItem(LEGACY_KEY)
    return store
  } catch { return null }
}

function loadStore(): ProjectStore {
  if (import.meta.server) return { activeProjectId: null, projects: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  // Try legacy migration
  const migrated = migrateLegacy()
  if (migrated) return migrated
  return { activeProjectId: null, projects: [] }
}

function saveStore(store: ProjectStore) {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch { /* ignore */ }
}

// ─── Composable ──────────────────────────────────────────────────────────

export function usePromptPresets() {
  const store = ref<ProjectStore>(loadStore())

  const activeProject = computed<Project | null>(() =>
    store.value.projects.find(p => p.id === store.value.activeProjectId) ?? null
  )

  const projects = computed(() => store.value.projects)

  function _touch(project: Project) {
    project.updatedAt = new Date().toISOString()
  }

  function _save() {
    saveStore(store.value)
  }

  // ─── Project CRUD ────────────────────────────────────────────────────

  function addProject(name: string, data?: Partial<Pick<Project, 'basePrompts' | 'presets' | 'mergeWithDefaults'>>): Project {
    const project = createProject(name, data)
    store.value.projects.push(project)
    store.value.activeProjectId = project.id
    _save()
    return project
  }

  function deleteProject(id: string) {
    store.value.projects = store.value.projects.filter(p => p.id !== id)
    if (store.value.activeProjectId === id) {
      store.value.activeProjectId = store.value.projects[0]?.id ?? null
    }
    _save()
  }

  function renameProject(id: string, newName: string) {
    const project = store.value.projects.find(p => p.id === id)
    if (project) {
      project.name = newName.trim() || 'Untitled'
      _touch(project)
      _save()
    }
  }

  function switchProject(id: string) {
    if (store.value.projects.some(p => p.id === id)) {
      store.value.activeProjectId = id
      _save()
    }
  }

  function duplicateProject(id: string): Project | null {
    const source = store.value.projects.find(p => p.id === id)
    if (!source) return null
    const copy = createProject(`${source.name} (Copy)`, {
      mergeWithDefaults: source.mergeWithDefaults,
      basePrompts: [...source.basePrompts],
      presets: Object.fromEntries(
        Object.entries(source.presets).map(([k, v]) => [k, [...(v ?? [])]])
      ) as Partial<Record<AttributeKey, string[]>>,
    })
    store.value.projects.push(copy)
    store.value.activeProjectId = copy.id
    _save()
    return copy
  }

  // ─── Import / Export ─────────────────────────────────────────────────

  function importProject(json: Record<string, unknown>): Project {
    const name = typeof json.name === 'string' ? json.name : 'Imported'
    const basePrompts: string[] = []
    const presets: Partial<Record<AttributeKey, string[]>> = {}

    if (Array.isArray(json.basePrompt)) {
      for (const v of json.basePrompt) {
        if (typeof v === 'string' && v.trim()) basePrompts.push(v.trim())
      }
    }

    for (const key of attributeKeys) {
      const vals = json[key]
      if (Array.isArray(vals)) {
        const filtered = vals.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim())
        if (filtered.length > 0) presets[key] = filtered
      }
    }

    return addProject(name, { basePrompts, presets })
  }

  function exportProject(id: string): Record<string, unknown> | null {
    const project = store.value.projects.find(p => p.id === id)
    if (!project) return null
    const result: Record<string, unknown> = { name: project.name }
    if (project.basePrompts.length > 0) result.basePrompt = [...project.basePrompts]
    for (const key of attributeKeys) {
      const vals = project.presets[key]
      if (vals && vals.length > 0) result[key] = [...vals]
    }
    return result
  }

  // ─── Preset Operations (scoped to active project) ───────────────────

  function getPresets(key: AttributeKey): readonly string[] {
    const project = activeProject.value
    if (!project) return defaultPresets[key]

    const custom = project.presets[key]
    if (!custom || custom.length === 0) return defaultPresets[key]

    if (project.mergeWithDefaults) {
      const combined = [...custom]
      for (const d of defaultPresets[key]) {
        if (!combined.includes(d)) combined.push(d)
      }
      return combined
    }
    return custom
  }

  function getAllPresets(): Record<AttributeKey, readonly string[]> {
    const result = {} as Record<AttributeKey, readonly string[]>
    for (const key of attributeKeys) {
      result[key] = getPresets(key)
    }
    return result
  }

  function addPreset(key: AttributeKey, preset: string) {
    const project = activeProject.value
    if (!project) return
    const trimmed = preset.trim()
    if (!trimmed) return
    if (!project.presets[key]) project.presets[key] = []
    if (!project.presets[key]!.includes(trimmed)) {
      project.presets[key]!.push(trimmed)
      _touch(project)
      _save()
    }
  }

  function removePreset(key: AttributeKey, preset: string) {
    const project = activeProject.value
    if (!project || !project.presets[key]) return
    project.presets[key] = project.presets[key]!.filter(p => p !== preset)
    _touch(project)
    _save()
  }

  function setCustomPresets(key: AttributeKey, presets: string[]) {
    const project = activeProject.value
    if (!project) return
    project.presets[key] = presets.filter(p => p.trim())
    _touch(project)
    _save()
  }

  function clearCustomPresets(key: AttributeKey) {
    const project = activeProject.value
    if (!project) return
    delete project.presets[key]
    _touch(project)
    _save()
  }

  function clearAllCustomPresets() {
    const project = activeProject.value
    if (!project) return
    project.presets = {}
    project.basePrompts = []
    _touch(project)
    _save()
  }

  function setMergeMode(merge: boolean) {
    const project = activeProject.value
    if (!project) return
    project.mergeWithDefaults = merge
    _touch(project)
    _save()
  }

  function getCustomCount(key: AttributeKey): number {
    return activeProject.value?.presets[key]?.length ?? 0
  }

  // ─── Base Prompt Presets (scoped to active project) ─────────────────

  function addBasePrompt(prompt: string) {
    const project = activeProject.value
    if (!project) return
    const trimmed = prompt.trim()
    if (!trimmed) return
    if (!project.basePrompts.includes(trimmed)) {
      project.basePrompts.push(trimmed)
      _touch(project)
      _save()
    }
  }

  function removeBasePrompt(prompt: string) {
    const project = activeProject.value
    if (!project) return
    project.basePrompts = project.basePrompts.filter(p => p !== prompt)
    _touch(project)
    _save()
  }

  function clearBasePrompts() {
    const project = activeProject.value
    if (!project) return
    project.basePrompts = []
    _touch(project)
    _save()
  }

  // ─── Backward-compatible config computed ────────────────────────────

  const config = computed(() => ({
    custom: activeProject.value?.presets ?? {},
    mergeWithDefaults: activeProject.value?.mergeWithDefaults ?? true,
    basePrompts: activeProject.value?.basePrompts ?? [],
  }))

  return {
    // Project management
    projects,
    activeProject,
    addProject,
    deleteProject,
    renameProject,
    switchProject,
    duplicateProject,
    importProject,
    exportProject,

    // Backward-compatible interface
    config,
    getPresets,
    getAllPresets,
    setCustomPresets,
    addPreset,
    removePreset,
    clearCustomPresets,
    clearAllCustomPresets,
    setMergeMode,
    getCustomCount,
    addBasePrompt,
    removeBasePrompt,
    clearBasePrompts,
  }
}
