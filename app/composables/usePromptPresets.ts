/**
 * usePromptPresets — composable for user-customizable prompt presets.
 *
 * Stores custom presets per attribute in localStorage. Falls back to
 * built-in defaults from promptBuilder.ts when no custom presets exist.
 */
import {
  attributePresets as defaultPresets,
  attributeKeys,
  type AttributeKey,
} from '~/utils/promptBuilder'

const STORAGE_KEY = 'ai-media-gen:custom-presets'

export interface UserPresetConfig {
  /** Custom presets per attribute. Empty array = use defaults. */
  custom: Partial<Record<AttributeKey, string[]>>
  /** Whether to merge custom presets with defaults or replace them. */
  mergeWithDefaults: boolean
}

function loadConfig(): UserPresetConfig {
  if (import.meta.server) return { custom: {}, mergeWithDefaults: true }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { custom: {}, mergeWithDefaults: true }
}

function saveConfig(config: UserPresetConfig) {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch { /* ignore */ }
}

export function usePromptPresets() {
  const config = ref<UserPresetConfig>(loadConfig())

  /**
   * Get the effective presets for a given attribute,
   * considering user customization and merge mode.
   */
  function getPresets(key: AttributeKey): readonly string[] {
    const custom = config.value.custom[key]
    if (!custom || custom.length === 0) {
      return defaultPresets[key]
    }
    if (config.value.mergeWithDefaults) {
      // Custom first, then defaults (deduped)
      const combined = [...custom]
      for (const d of defaultPresets[key]) {
        if (!combined.includes(d)) combined.push(d)
      }
      return combined
    }
    return custom
  }

  /**
   * Get all effective presets as a record.
   */
  function getAllPresets(): Record<AttributeKey, readonly string[]> {
    const result = {} as Record<AttributeKey, readonly string[]>
    for (const key of attributeKeys) {
      result[key] = getPresets(key)
    }
    return result
  }

  /**
   * Set custom presets for a specific attribute.
   */
  function setCustomPresets(key: AttributeKey, presets: string[]) {
    config.value.custom[key] = presets.filter(p => p.trim())
    saveConfig(config.value)
  }

  /**
   * Add a single preset to a specific attribute.
   */
  function addPreset(key: AttributeKey, preset: string) {
    const trimmed = preset.trim()
    if (!trimmed) return
    if (!config.value.custom[key]) config.value.custom[key] = []
    if (!config.value.custom[key]!.includes(trimmed)) {
      config.value.custom[key]!.push(trimmed)
      saveConfig(config.value)
    }
  }

  /**
   * Remove a single preset from a specific attribute.
   */
  function removePreset(key: AttributeKey, preset: string) {
    if (!config.value.custom[key]) return
    config.value.custom[key] = config.value.custom[key]!.filter(p => p !== preset)
    saveConfig(config.value)
  }

  /**
   * Clear custom presets for a specific attribute (reverts to defaults).
   */
  function clearCustomPresets(key: AttributeKey) {
    delete config.value.custom[key]
    saveConfig(config.value)
  }

  /**
   * Clear ALL custom presets.
   */
  function clearAllCustomPresets() {
    config.value.custom = {}
    saveConfig(config.value)
  }

  /**
   * Toggle merge-with-defaults mode.
   */
  function setMergeMode(merge: boolean) {
    config.value.mergeWithDefaults = merge
    saveConfig(config.value)
  }

  /**
   * Get the number of custom presets for a given attribute.
   */
  function getCustomCount(key: AttributeKey): number {
    return config.value.custom[key]?.length ?? 0
  }

  return {
    config: readonly(config),
    getPresets,
    getAllPresets,
    setCustomPresets,
    addPreset,
    removePreset,
    clearCustomPresets,
    clearAllCustomPresets,
    setMergeMode,
    getCustomCount,
  }
}
