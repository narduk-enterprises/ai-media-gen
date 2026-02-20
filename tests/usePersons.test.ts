/**
 * Tests for the usePersons composable.
 *
 * Since the composable relies on Nuxt auto-imports (ref, readonly)
 * and import.meta.server, we provide global shims before importing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, readonly } from 'vue'

// ─── Globals for Nuxt auto-imports ──────────────────────────────────────
;(globalThis as any).ref = ref
;(globalThis as any).readonly = readonly

// useState shim: behaves like ref for testing (state is per-call, not shared)
const useStateStore: Record<string, any> = {}
;(globalThis as any).useState = (key: string, init: () => any) => {
  if (!useStateStore[key]) useStateStore[key] = ref(init())
  return useStateStore[key]
}
// onNuxtReady shim: execute callback immediately in tests
;(globalThis as any).onNuxtReady = (cb: () => void) => cb()

// ─── Mock localStorage ──────────────────────────────────────────────────
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

// ─── Mock the promptBuilder import ──────────────────────────────────────
vi.mock('~/utils/promptBuilder', () => ({
  characterAttributeKeys: ['hair', 'eyes', 'bodyType', 'skinTone', 'clothing'],
}))

// ─── Import after globals are set ───────────────────────────────────────
import { usePersons, type Person } from '../app/composables/usePersons'

// ─── Test Suite ─────────────────────────────────────────────────────────

describe('usePersons', () => {
  beforeEach(() => {
    localStorageMock.clear()
    // Clear useState store so each test starts fresh
    for (const k of Object.keys(useStateStore)) delete useStateStore[k]
    vi.clearAllMocks()
  })

  it('starts with an empty list when no localStorage data exists', () => {
    const { persons } = usePersons()
    expect(persons.value).toEqual([])
  })

  it('addPerson creates a new person and persists it', () => {
    const { persons, addPerson } = usePersons()

    const person = addPerson('Cyber Girl', {
      hair: 'long platinum hair',
      eyes: 'glowing blue eyes',
      clothing: 'cyberpunk outfit',
    })

    expect(person.name).toBe('Cyber Girl')
    expect(person.hair).toBe('long platinum hair')
    expect(person.eyes).toBe('glowing blue eyes')
    expect(person.clothing).toBe('cyberpunk outfit')
    expect(person.bodyType).toBe('')
    expect(person.skinTone).toBe('')
    expect(person.id).toBeTruthy()
    expect(person.createdAt).toBeTruthy()

    expect(persons.value).toHaveLength(1)
    expect(localStorageMock.setItem).toHaveBeenCalled()
  })

  it('addPerson trims name and attributes', () => {
    const { addPerson } = usePersons()
    const person = addPerson('  Space Elf  ', { hair: '  silver hair  ' })

    expect(person.name).toBe('Space Elf')
    expect(person.hair).toBe('silver hair')
  })

  it('addPerson defaults name to "Untitled" when empty', () => {
    const { addPerson } = usePersons()
    const person = addPerson('')
    expect(person.name).toBe('Untitled')
  })

  it('addPerson prepends new persons (most recent first)', () => {
    const { persons, addPerson } = usePersons()
    addPerson('First')
    addPerson('Second')

    expect(persons.value[0].name).toBe('Second')
    expect(persons.value[1].name).toBe('First')
  })

  it('getPerson returns the correct person by ID', () => {
    const { addPerson, getPerson } = usePersons()
    const person = addPerson('Test Person')

    expect(getPerson(person.id)?.name).toBe('Test Person')
  })

  it('getPerson returns undefined for unknown ID', () => {
    const { getPerson } = usePersons()
    expect(getPerson('nonexistent')).toBeUndefined()
  })

  it('deletePerson removes the person', () => {
    const { persons, addPerson, deletePerson } = usePersons()
    const person = addPerson('To Delete')
    expect(persons.value).toHaveLength(1)

    deletePerson(person.id)
    expect(persons.value).toHaveLength(0)
  })

  it('renamePerson updates the name', () => {
    const { addPerson, getPerson, renamePerson } = usePersons()
    const person = addPerson('Original Name')

    renamePerson(person.id, 'New Name')
    expect(getPerson(person.id)?.name).toBe('New Name')
  })

  it('renamePerson trims and falls back to "Untitled"', () => {
    const { addPerson, getPerson, renamePerson } = usePersons()
    const person = addPerson('Test')

    renamePerson(person.id, '   ')
    expect(getPerson(person.id)?.name).toBe('Untitled')
  })

  it('renamePerson does nothing for unknown ID', () => {
    const { persons, renamePerson } = usePersons()
    renamePerson('nonexistent', 'New Name')
    expect(persons.value).toHaveLength(0)
  })

  it('updatePerson changes appearance attributes', () => {
    const { addPerson, getPerson, updatePerson } = usePersons()
    const person = addPerson('Warrior', {
      hair: 'black hair',
      eyes: 'brown eyes',
    })

    updatePerson(person.id, {
      hair: 'red hair',
      clothing: 'plate armor',
    })

    const updated = getPerson(person.id)!
    expect(updated.hair).toBe('red hair')
    expect(updated.eyes).toBe('brown eyes') // unchanged
    expect(updated.clothing).toBe('plate armor')
  })

  it('updatePerson does nothing for unknown ID', () => {
    const { persons, updatePerson } = usePersons()
    updatePerson('nonexistent', { hair: 'test' })
    expect(persons.value).toHaveLength(0)
  })

  it('duplicatePerson creates a copy with "(Copy)" suffix', () => {
    const { persons, addPerson, duplicatePerson } = usePersons()
    const original = addPerson('Original', {
      hair: 'blonde hair',
      eyes: 'green eyes',
      bodyType: 'athletic',
      skinTone: 'fair skin',
      clothing: 'casual outfit',
    })

    const copy = duplicatePerson(original.id)

    expect(copy).not.toBeNull()
    expect(copy!.name).toBe('Original (Copy)')
    expect(copy!.hair).toBe('blonde hair')
    expect(copy!.eyes).toBe('green eyes')
    expect(copy!.bodyType).toBe('athletic')
    expect(copy!.skinTone).toBe('fair skin')
    expect(copy!.clothing).toBe('casual outfit')
    expect(copy!.id).not.toBe(original.id)
    expect(persons.value).toHaveLength(2)
  })

  it('duplicatePerson returns null for unknown ID', () => {
    const { duplicatePerson } = usePersons()
    expect(duplicatePerson('nonexistent')).toBeNull()
  })

  it('persists data to localStorage on each mutation', () => {
    const { addPerson, renamePerson, deletePerson } = usePersons()

    const person = addPerson('Test')
    const callCount1 = localStorageMock.setItem.mock.calls.length

    renamePerson(person.id, 'Updated')
    expect(localStorageMock.setItem.mock.calls.length).toBeGreaterThan(callCount1)

    const callCount2 = localStorageMock.setItem.mock.calls.length
    deletePerson(person.id)
    expect(localStorageMock.setItem.mock.calls.length).toBeGreaterThan(callCount2)
  })

  it('supports description field on persons', () => {
    const { addPerson, getPerson } = usePersons()
    const person = addPerson('Warrior', { description: 'A 25 year old warrior' })

    expect(person.description).toBe('A 25 year old warrior')
    expect(getPerson(person.id)?.description).toBe('A 25 year old warrior')
  })

  it('defaults description to empty string', () => {
    const { addPerson } = usePersons()
    const person = addPerson('No Desc')
    expect(person.description).toBe('')
  })

  it('updatePerson handles description', () => {
    const { addPerson, getPerson, updatePerson } = usePersons()
    const person = addPerson('Test', { description: 'original' })

    updatePerson(person.id, { description: 'updated description' })

    expect(getPerson(person.id)?.description).toBe('updated description')
  })

  it('loads persisted persons from localStorage (with backward compat for description)', () => {
    const testPersons: Person[] = [{
      id: 'test-1',
      name: 'Saved Person',
      description: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      hair: 'black hair',
      eyes: 'blue eyes',
      bodyType: 'athletic',
      skinTone: 'olive skin',
      clothing: 'armor',
    }]
    store['ai-media-gen:persons'] = JSON.stringify(testPersons)

    const { persons } = usePersons()
    expect(persons.value).toHaveLength(1)
    expect(persons.value[0].name).toBe('Saved Person')
  })
})
