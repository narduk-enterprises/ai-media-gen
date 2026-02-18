/**
 * usePersons — composable for saving and loading fictional characters.
 *
 * Each "person" stores a freeform description plus character appearance
 * attributes (hair, eyes, bodyType, skinTone, clothing) that feed into
 * the prompt builder. This lets you reuse the same character across
 * different scenes, styles, and compositions.
 */
import { characterAttributeKeys } from '~/utils/promptBuilder'

const STORAGE_KEY = 'ai-media-gen:persons'

// ─── Data Model ──────────────────────────────────────────────────────────

export interface Person {
  id: string
  name: string
  description: string
  createdAt: string
  hair: string
  eyes: string
  bodyType: string
  skinTone: string
  clothing: string
}

export type PersonAttributes = Pick<Person, 'hair' | 'eyes' | 'bodyType' | 'skinTone' | 'clothing'>

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadPersons(): Person[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as any[]
      return parsed.map(p => ({ ...p, description: p.description ?? '' }))
    }
  } catch { /* ignore */ }
  return []
}

function persistPersons(persons: Person[]) {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persons))
  } catch { /* ignore */ }
}

// ─── Composable ──────────────────────────────────────────────────────────

export function usePersons() {
  const persons = ref<Person[]>(loadPersons())

  function _save() {
    persistPersons(persons.value)
  }

  function addPerson(name: string, attrs: Partial<PersonAttributes & { description: string }> = {}): Person {
    const person: Person = {
      id: generateId(),
      name: name.trim() || 'Untitled',
      description: attrs.description?.trim() ?? '',
      createdAt: new Date().toISOString(),
      hair: attrs.hair?.trim() ?? '',
      eyes: attrs.eyes?.trim() ?? '',
      bodyType: attrs.bodyType?.trim() ?? '',
      skinTone: attrs.skinTone?.trim() ?? '',
      clothing: attrs.clothing?.trim() ?? '',
    }
    persons.value.unshift(person)
    _save()
    return person
  }

  function getPerson(id: string): Person | undefined {
    return persons.value.find(p => p.id === id)
  }

  function deletePerson(id: string) {
    persons.value = persons.value.filter(p => p.id !== id)
    _save()
  }

  function renamePerson(id: string, newName: string) {
    const person = persons.value.find(p => p.id === id)
    if (person) {
      person.name = newName.trim() || 'Untitled'
      _save()
    }
  }

  function updatePerson(id: string, attrs: Partial<PersonAttributes & { description: string }>) {
    const person = persons.value.find(p => p.id === id)
    if (!person) return
    if ('description' in attrs && typeof attrs.description === 'string') {
      person.description = attrs.description.trim()
    }
    for (const key of characterAttributeKeys) {
      if (key in attrs) {
        person[key] = (attrs[key as keyof PersonAttributes] ?? '').trim()
      }
    }
    _save()
  }

  function duplicatePerson(id: string): Person | null {
    const source = persons.value.find(p => p.id === id)
    if (!source) return null
    return addPerson(`${source.name} (Copy)`, {
      description: source.description,
      hair: source.hair,
      eyes: source.eyes,
      bodyType: source.bodyType,
      skinTone: source.skinTone,
      clothing: source.clothing,
    })
  }

  /**
   * Import one or more persons from a JSON object or array.
   *
   * Accepts:
   *  - A single object: `{ name, description, hair, eyes, bodyType, skinTone, clothing }`
   *  - An array of such objects
   *
   * Returns the list of created Person records.
   */
  function importPersons(json: unknown): Person[] {
    const items = Array.isArray(json) ? json : [json]
    const created: Person[] = []
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const obj = item as Record<string, unknown>
      const name = typeof obj.name === 'string' ? obj.name : 'Imported'
      const attrs: Partial<PersonAttributes & { description: string }> = {}
      if (typeof obj.description === 'string') attrs.description = obj.description
      for (const key of characterAttributeKeys) {
        if (typeof obj[key] === 'string') attrs[key as keyof PersonAttributes] = obj[key] as string
      }
      created.push(addPerson(name, attrs))
    }
    return created
  }

  function exportPerson(id: string): Record<string, string> | null {
    const person = persons.value.find(p => p.id === id)
    if (!person) return null
    const result: Record<string, string> = { name: person.name }
    if (person.description) result.description = person.description
    for (const key of characterAttributeKeys) {
      if (person[key]) result[key] = person[key]
    }
    return result
  }

  return {
    persons: readonly(persons),
    addPerson,
    getPerson,
    deletePerson,
    renamePerson,
    updatePerson,
    duplicatePerson,
    importPersons,
    exportPerson,
  }
}
