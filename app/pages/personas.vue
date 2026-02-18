<script setup lang="ts">
import {
  attributeLabels,
  attributePresets,
  sceneAttributeKeys,
  characterAttributeKeys,
  pickRandom,
  type AttributeKey,
  type SceneAttributeKey,
  type CharacterAttributeKey,
} from '~/utils/promptBuilder'
import type { Scene } from '~/composables/useScenes'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Personas & Scenes' })

const { getPresets } = usePromptPresets()

// ─── Persons ─────────────────────────────────────────────────────────────
const {
  persons,
  addPerson,
  getPerson,
  deletePerson,
  renamePerson,
  updatePerson,
  duplicatePerson,
  importPersons,
  exportPerson,
} = usePersons()

// ─── Persona selection & form ─────────────────────────────────────────────
const selectedPersonId = ref<string | null>(null)
const isCreating = ref(false)
const justSaved = ref(false)

const selectedPerson = computed(() =>
  persons.value.find((p: any) => p.id === selectedPersonId.value) ?? null
)

const personForm = reactive<Record<string, string>>({
  name: '',
  description: '',
  hair: '',
  eyes: '',
  bodyType: '',
  skinTone: '',
  clothing: '',
})

function populatePersonForm(person: any) {
  personForm.name = person.name
  personForm.description = person.description || ''
  personForm.hair = person.hair
  personForm.eyes = person.eyes
  personForm.bodyType = person.bodyType
  personForm.skinTone = person.skinTone
  personForm.clothing = person.clothing
}

function resetPersonForm() {
  personForm.name = ''
  personForm.description = ''
  personForm.hair = ''
  personForm.eyes = ''
  personForm.bodyType = ''
  personForm.skinTone = ''
  personForm.clothing = ''
}

function selectPerson(id: string) {
  selectedPersonId.value = id
  isCreating.value = false
  const person = getPerson(id)
  if (person) populatePersonForm(person)
}

function startCreatePerson() {
  selectedPersonId.value = null
  isCreating.value = true
  resetPersonForm()
}

function cancelCreatePerson() {
  isCreating.value = false
  if (persons.value.length > 0) {
    selectPerson(persons.value[0].id)
  }
}

const hasUnsavedPersonChanges = computed(() => {
  if (isCreating.value) return true
  if (!selectedPerson.value) return false
  const p = selectedPerson.value as any
  return (
    personForm.name !== p.name ||
    personForm.description !== (p.description || '') ||
    personForm.hair !== p.hair ||
    personForm.eyes !== p.eyes ||
    personForm.bodyType !== p.bodyType ||
    personForm.skinTone !== p.skinTone ||
    personForm.clothing !== p.clothing
  )
})

const canSavePerson = computed(() => {
  if (isCreating.value) return personForm.name.trim() !== ''
  return hasUnsavedPersonChanges.value && personForm.name.trim() !== ''
})

function savePerson() {
  if (!canSavePerson.value) return

  if (isCreating.value) {
    const person = addPerson(personForm.name, {
      description: personForm.description,
      hair: personForm.hair,
      eyes: personForm.eyes,
      bodyType: personForm.bodyType,
      skinTone: personForm.skinTone,
      clothing: personForm.clothing,
    })
    selectedPersonId.value = person.id
    isCreating.value = false
  } else if (selectedPersonId.value) {
    renamePerson(selectedPersonId.value, personForm.name)
    updatePerson(selectedPersonId.value, {
      description: personForm.description,
      hair: personForm.hair,
      eyes: personForm.eyes,
      bodyType: personForm.bodyType,
      skinTone: personForm.skinTone,
      clothing: personForm.clothing,
    })
  }

  justSaved.value = true
  setTimeout(() => { justSaved.value = false }, 2000)
}

function deletePersonAction() {
  if (!selectedPersonId.value) return
  if (!confirm(`Delete "${selectedPerson.value?.name}"? This cannot be undone.`)) return
  deletePerson(selectedPersonId.value)
  selectedPersonId.value = null
}

function duplicatePersonAction() {
  if (!selectedPersonId.value) return
  const copy = duplicatePerson(selectedPersonId.value)
  if (copy) {
    selectedPersonId.value = copy.id
    populatePersonForm(copy)
  }
}

function randomizePersonField(key: CharacterAttributeKey) {
  personForm[key] = pickRandom(attributePresets[key])
}

function personSummary(person: any): string {
  if (person.description) {
    return person.description.length > 50 ? person.description.slice(0, 50) + '…' : person.description
  }
  const parts: string[] = []
  for (const key of characterAttributeKeys) {
    if (person[key]) {
      parts.push(person[key])
      if (parts.length >= 2) break
    }
  }
  return parts.join(' · ') || 'No details yet'
}

// ─── Persona Import/Export ───────────────────────────────────────────────
const showPersonaImport = ref(false)
const personaImportText = ref('')
const personaImportError = ref('')
const copiedPersona = ref(false)

function handlePersonaImport() {
  personaImportError.value = ''
  const text = personaImportText.value.trim()
  if (!text) return

  try {
    const parsed = JSON.parse(text)
    const created = importPersons(parsed)
    if (created.length === 0) {
      personaImportError.value = 'No valid personas found in the JSON'
      return
    }
    personaImportText.value = ''
    showPersonaImport.value = false
    selectPerson(created[0].id)
  } catch {
    personaImportError.value = 'Invalid JSON — expected an object or array of objects'
  }
}

function handleExportPersona() {
  if (!selectedPersonId.value) return
  const data = exportPerson(selectedPersonId.value)
  if (data) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    copiedPersona.value = true
    setTimeout(() => { copiedPersona.value = false }, 2000)
  }
}

// ─── Scenes ──────────────────────────────────────────────────────────────
const {
  scenes,
  addScene,
  getScene,
  deleteScene,
  renameScene,
  updateScene,
  duplicateScene,
  importScenes,
  exportScene,
} = useScenes()

const selectedSceneId = ref<string | null>(null)
const isCreatingScene = ref(false)
const justSavedScene = ref(false)

const selectedScene = computed(() =>
  selectedSceneId.value ? getScene(selectedSceneId.value) ?? null : null
)

const sceneForm = reactive<Record<string, string>>({
  name: '',
  scene: '',
  pose: '',
  style: '',
  lighting: '',
  mood: '',
  camera: '',
})

function populateSceneForm(scene: Scene) {
  sceneForm.name = scene.name
  sceneForm.scene = scene.scene
  sceneForm.pose = scene.pose
  sceneForm.style = scene.style
  sceneForm.lighting = scene.lighting
  sceneForm.mood = scene.mood
  sceneForm.camera = scene.camera
}

function resetSceneForm() {
  sceneForm.name = ''
  sceneForm.scene = ''
  sceneForm.pose = ''
  sceneForm.style = ''
  sceneForm.lighting = ''
  sceneForm.mood = ''
  sceneForm.camera = ''
}

function selectScene(id: string) {
  selectedSceneId.value = id
  isCreatingScene.value = false
  const scene = getScene(id)
  if (scene) populateSceneForm(scene)
}

function startCreateScene() {
  selectedSceneId.value = null
  isCreatingScene.value = true
  resetSceneForm()
}

function cancelCreateScene() {
  isCreatingScene.value = false
  if (scenes.value.length > 0) {
    selectScene(scenes.value[0].id)
  }
}

const hasUnsavedSceneChanges = computed(() => {
  if (isCreatingScene.value) return true
  if (!selectedScene.value) return false
  const s = selectedScene.value
  return (
    sceneForm.name !== s.name ||
    sceneForm.scene !== s.scene ||
    sceneForm.pose !== s.pose ||
    sceneForm.style !== s.style ||
    sceneForm.lighting !== s.lighting ||
    sceneForm.mood !== s.mood ||
    sceneForm.camera !== s.camera
  )
})

const canSaveScene = computed(() => {
  if (isCreatingScene.value) return sceneForm.name.trim() !== ''
  return hasUnsavedSceneChanges.value && sceneForm.name.trim() !== ''
})

function saveScene() {
  if (!canSaveScene.value) return

  if (isCreatingScene.value) {
    const scene = addScene(sceneForm.name, {
      scene: sceneForm.scene,
      pose: sceneForm.pose,
      style: sceneForm.style,
      lighting: sceneForm.lighting,
      mood: sceneForm.mood,
      camera: sceneForm.camera,
    })
    selectedSceneId.value = scene.id
    isCreatingScene.value = false
  } else if (selectedSceneId.value) {
    renameScene(selectedSceneId.value, sceneForm.name)
    updateScene(selectedSceneId.value, {
      scene: sceneForm.scene,
      pose: sceneForm.pose,
      style: sceneForm.style,
      lighting: sceneForm.lighting,
      mood: sceneForm.mood,
      camera: sceneForm.camera,
    })
  }

  justSavedScene.value = true
  setTimeout(() => { justSavedScene.value = false }, 2000)
}

function deleteSceneAction() {
  if (!selectedSceneId.value) return
  if (!confirm(`Delete "${selectedScene.value?.name}"? This cannot be undone.`)) return
  deleteScene(selectedSceneId.value)
  selectedSceneId.value = null
}

function duplicateSceneAction() {
  if (!selectedSceneId.value) return
  const copy = duplicateScene(selectedSceneId.value)
  if (copy) {
    selectedSceneId.value = copy.id
    populateSceneForm(copy)
  }
}

function randomizeSceneField(key: SceneAttributeKey) {
  const pool = getPresets(key as AttributeKey)
  sceneForm[key] = pool.length > 0 ? pickRandom(pool) : pickRandom(attributePresets[key])
}

function randomizeAllScene() {
  for (const key of sceneAttributeKeys) {
    randomizeSceneField(key)
  }
}

function clearAllScene() {
  for (const key of sceneAttributeKeys) {
    sceneForm[key] = ''
  }
}

function sceneSummary(scene: Scene): string {
  const parts: string[] = []
  for (const key of sceneAttributeKeys) {
    if (scene[key]?.trim()) {
      parts.push(scene[key].length > 15 ? scene[key].slice(0, 15) + '…' : scene[key])
      if (parts.length >= 2) break
    }
  }
  return parts.join(' · ') || 'Empty scene'
}

// ─── Scene Import/Export ────────────────────────────────────────────────
const showSceneImport = ref(false)
const sceneImportText = ref('')
const sceneImportError = ref('')
const copiedScene = ref(false)

function handleSceneImport() {
  sceneImportError.value = ''
  const text = sceneImportText.value.trim()
  if (!text) return

  try {
    const parsed = JSON.parse(text)
    const created = importScenes(parsed)
    if (created.length === 0) {
      sceneImportError.value = 'No valid scenes found in the JSON'
      return
    }
    sceneImportText.value = ''
    showSceneImport.value = false
    selectScene(created[0].id)
  } catch {
    sceneImportError.value = 'Invalid JSON — expected an object or array of objects with name and scene fields'
  }
}

function handleExportScene() {
  if (!selectedSceneId.value) return
  const data = exportScene(selectedSceneId.value)
  if (data) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    copiedScene.value = true
    setTimeout(() => { copiedScene.value = false }, 2000)
  }
}
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="mb-8">
      <h1 class="text-2xl font-display font-bold text-slate-800 tracking-tight">
        Personas & Scenes
      </h1>
      <p class="text-sm text-slate-500 mt-1">
        Define your characters and scenes here. Combine them on the Create page to generate images.
      </p>
    </div>

    <!-- ═══ Personas ═══ -->
    <section class="mb-10">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-slate-700">My Personas</h2>
        <div class="flex items-center gap-3">
          <button
            class="text-xs font-medium transition-colors"
            :class="showPersonaImport ? 'text-violet-600' : 'text-slate-400 hover:text-slate-600'"
            @click="showPersonaImport = !showPersonaImport; personaImportError = ''"
          >
            Import JSON
          </button>
          <button
            class="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
            @click="startCreatePerson"
          >
            + New Persona
          </button>
        </div>
      </div>

      <div v-if="showPersonaImport" class="mb-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <p class="text-[11px] text-slate-500 mb-2">Paste JSON to import one or more personas:</p>
        <pre class="text-[9px] text-slate-400 mb-2 overflow-x-auto bg-white rounded-lg p-2 border border-slate-100">{{ '{ "name": "Cyber Girl", "description": "25yo hacker", "hair": "neon pink pixie cut", "eyes": "glowing blue" }' }}</pre>
        <textarea
          v-model="personaImportText"
          rows="3"
          placeholder='Paste a single object or an array of objects...'
          class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none font-mono"
        />
        <p v-if="personaImportError" class="text-[10px] text-red-500 mt-1">{{ personaImportError }}</p>
        <div class="flex gap-2 mt-2">
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            :class="{ 'opacity-50 cursor-not-allowed': !personaImportText.trim() }"
            :disabled="!personaImportText.trim()"
            @click="handlePersonaImport"
          >
            Import
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
            @click="showPersonaImport = false"
          >
            Cancel
          </button>
        </div>
      </div>

      <div v-if="persons.length === 0 && !isCreating" class="glass-card p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-violet-500">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h3 class="text-sm font-semibold text-slate-700 mb-1">No personas yet</h3>
        <p class="text-xs text-slate-400 mb-5 max-w-md mx-auto">
          A persona defines a character's appearance. Create one, then use it on the Create page with your scenes.
        </p>
        <button
          class="px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors active:scale-[0.98]"
          @click="startCreatePerson"
        >
          Create Your First Persona
        </button>
      </div>

      <div v-else class="overflow-x-auto pb-2">
        <div class="inline-flex gap-3">
          <button
            v-for="person in persons"
            :key="person.id"
            class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
            :class="selectedPersonId === person.id && !isCreating
              ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
            @click="selectPerson(person.id)"
          >
            <div class="flex items-center gap-2.5 mb-1.5">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                :class="selectedPersonId === person.id && !isCreating ? 'bg-violet-200 text-violet-700' : 'bg-slate-100 text-slate-500'"
              >
                {{ person.name.charAt(0).toUpperCase() }}
              </div>
              <span class="font-medium text-sm text-slate-700 truncate">{{ person.name }}</span>
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ personSummary(person) }}</p>
          </button>
          <button
            class="shrink-0 w-40 p-3 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1"
            :class="isCreating ? 'border-violet-300 bg-violet-50/50' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'"
            @click="startCreatePerson"
          >
            <span class="text-2xl text-slate-300">+</span>
            <span class="text-[11px] text-slate-400 font-medium">New Persona</span>
          </button>
        </div>
      </div>

      <!-- Persona form (create or edit) -->
      <div v-if="isCreating || selectedPerson" class="mt-6 max-w-xl">
        <div class="glass-card p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-semibold text-slate-700">{{ isCreating ? 'New Persona' : 'Persona Profile' }}</h2>
            <div v-if="!isCreating" class="flex items-center gap-1">
              <span v-if="justSaved" class="text-xs text-emerald-500 font-medium animate-pulse">Saved!</span>
              <span v-if="copiedPersona" class="text-xs text-emerald-500 font-medium animate-pulse">Copied!</span>
              <button class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center text-sm" title="Export as JSON" @click="handleExportPersona">📤</button>
              <button class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center text-sm" title="Duplicate" @click="duplicatePersonAction">📋</button>
              <button class="w-7 h-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-sm" title="Delete" @click="deletePersonAction">🗑️</button>
            </div>
          </div>
          <div v-if="isCreating" class="mb-4 p-3 rounded-lg bg-violet-50/60 border border-violet-100 text-xs text-slate-600 space-y-1.5">
            <p class="font-medium text-violet-700">Writing a good persona</p>
            <ul class="space-y-1 text-[11px] text-slate-500 list-disc pl-4">
              <li><strong>Description</strong> is the most important field. Write it as a short phrase the AI model will see directly: <em>"25 year old woman, athletic, confident expression"</em></li>
              <li><strong>Appearance fields</strong> are concatenated into the prompt. Be specific and visual: <em>"long flowing black hair"</em> beats <em>"black hair"</em></li>
              <li>Leave fields blank to skip them. Only fill what matters for consistency across scenes.</li>
              <li>Think of it as an actor's casting sheet: what must stay the same every time this character appears?</li>
            </ul>
          </div>
          <div class="space-y-3">
            <div>
              <label class="text-[11px] text-slate-500 font-medium mb-1 block">Name</label>
              <input
                v-model="personForm.name"
                type="text"
                placeholder="e.g. Cyber Girl, Forest Elf..."
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              />
            </div>
            <div>
              <label class="text-[11px] text-slate-500 font-medium mb-1 block">Description</label>
              <textarea
                v-model="personForm.description"
                placeholder="e.g. 25 year old woman, athletic build, confident expression, slight smile"
                rows="2"
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
              />
            </div>
            <div class="border-t border-slate-100 pt-2">
              <span class="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Appearance</span>
            </div>
            <div v-for="key in characterAttributeKeys" :key="key" class="flex gap-1.5 items-center">
              <label class="text-[11px] text-slate-500 font-medium w-24 shrink-0 flex items-center gap-1">
                <span>{{ attributeLabels[key].emoji }}</span>
                <span>{{ attributeLabels[key].label }}</span>
              </label>
              <input
                v-model="personForm[key]"
                type="text"
                :placeholder="attributePresets[key][0]"
                class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              />
              <button class="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center shrink-0 text-sm" title="Randomize" @click="randomizePersonField(key as CharacterAttributeKey)">🎲</button>
            </div>
          </div>
          <div class="flex gap-2 mt-5 pt-4 border-t border-slate-100">
            <button
              class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              :class="canSavePerson ? 'bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98]' : 'bg-slate-100 text-slate-300 cursor-not-allowed'"
              :disabled="!canSavePerson"
              @click="savePerson"
            >
              {{ isCreating ? 'Create Persona' : 'Save Changes' }}
            </button>
            <button
              v-if="isCreating"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
              @click="cancelCreatePerson"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div v-if="!selectedPerson && !isCreating && persons.length > 0" class="mt-4">
        <p class="text-sm text-slate-400">Select a persona to edit, or go to <NuxtLink to="/create" class="text-violet-600 hover:underline">Create</NuxtLink> to generate images.</p>
      </div>
    </section>

    <!-- ═══ Scenes ═══ -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-slate-700">My Scenes</h2>
        <div class="flex items-center gap-3">
          <button
            class="text-xs font-medium transition-colors"
            :class="showSceneImport ? 'text-cyan-600' : 'text-slate-400 hover:text-slate-600'"
            @click="showSceneImport = !showSceneImport; sceneImportError = ''"
          >
            Import JSON
          </button>
          <button
            class="text-xs font-medium text-cyan-600 hover:text-cyan-700 transition-colors"
            @click="startCreateScene"
          >
            + New Scene
          </button>
        </div>
      </div>

      <div v-if="showSceneImport" class="mb-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <p class="text-[11px] text-slate-500 mb-2">Paste JSON to import one or more scenes:</p>
        <pre class="text-[9px] text-slate-400 mb-2 overflow-x-auto bg-white rounded-lg p-2 border border-slate-100">{{ '{ "name": "Neon City Night", "scene": "neon-lit rainy alleyway", "camera": "close-up portrait", "style": "cinematic" }' }}</pre>
        <textarea
          v-model="sceneImportText"
          rows="3"
          placeholder='Paste a single object or an array of objects...'
          class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 resize-none font-mono"
        />
        <p v-if="sceneImportError" class="text-[10px] text-red-500 mt-1">{{ sceneImportError }}</p>
        <div class="flex gap-2 mt-2">
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-700 transition-colors"
            :class="{ 'opacity-50 cursor-not-allowed': !sceneImportText.trim() }"
            :disabled="!sceneImportText.trim()"
            @click="handleSceneImport"
          >
            Import
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
            @click="showSceneImport = false"
          >
            Cancel
          </button>
        </div>
      </div>

      <div v-if="scenes.length === 0 && !isCreatingScene" class="glass-card p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-cyan-100 flex items-center justify-center mx-auto mb-4">
          <span class="text-2xl">{{ attributeLabels.scene.emoji }}</span>
        </div>
        <h3 class="text-sm font-semibold text-slate-700 mb-1">No scenes yet</h3>
        <p class="text-xs text-slate-400 mb-5 max-w-md mx-auto">
          A scene bundles location, pose, style, lighting, mood, and camera. Create scenes and combine them with personas on the Create page.
        </p>
        <button
          class="px-5 py-2.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors active:scale-[0.98]"
          @click="startCreateScene"
        >
          Create Your First Scene
        </button>
      </div>

      <div v-else class="overflow-x-auto pb-2">
        <div class="inline-flex gap-3">
          <button
            v-for="scene in scenes"
            :key="scene.id"
            class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
            :class="selectedSceneId === scene.id && !isCreatingScene
              ? 'ring-2 ring-cyan-400 border-cyan-200 bg-cyan-50/70 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
            @click="selectScene(scene.id)"
          >
            <div class="flex items-center gap-2.5 mb-1.5">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                :class="selectedSceneId === scene.id && !isCreatingScene ? 'bg-cyan-200 text-cyan-700' : 'bg-slate-100 text-slate-500'"
              >
                {{ attributeLabels.scene.emoji }}
              </div>
              <span class="font-medium text-sm text-slate-700 truncate">{{ scene.name }}</span>
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ sceneSummary(scene) }}</p>
          </button>
          <button
            class="shrink-0 w-40 p-3 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1"
            :class="isCreatingScene ? 'border-cyan-300 bg-cyan-50/50' : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'"
            @click="startCreateScene"
          >
            <span class="text-2xl text-slate-300">+</span>
            <span class="text-[11px] text-slate-400 font-medium">New Scene</span>
          </button>
        </div>
      </div>

      <!-- Scene form (create or edit) -->
      <div v-if="isCreatingScene || selectedScene" class="mt-6 max-w-2xl">
        <div class="glass-card p-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold text-slate-700">{{ isCreatingScene ? 'New Scene' : 'Scene' }}</h2>
            <div class="flex items-center gap-2">
              <span v-if="justSavedScene" class="text-xs text-emerald-500 font-medium animate-pulse">Saved!</span>
              <span v-if="copiedScene" class="text-xs text-emerald-500 font-medium animate-pulse">Copied!</span>
              <button v-if="!isCreatingScene" class="text-[10px] font-medium text-cyan-600 hover:text-cyan-700" @click="handleExportScene">{{ copiedScene ? 'Copied!' : 'Export' }}</button>
              <button class="text-[10px] font-medium text-cyan-600 hover:text-cyan-700" @click="randomizeAllScene">Randomize All</button>
              <button class="text-[10px] text-slate-400 hover:text-slate-600 font-medium" @click="clearAllScene">Clear</button>
              <template v-if="!isCreatingScene">
                <button class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center text-sm" title="Duplicate" @click="duplicateSceneAction">📋</button>
                <button class="w-7 h-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-sm" title="Delete" @click="deleteSceneAction">🗑️</button>
              </template>
            </div>
          </div>
          <div v-if="isCreatingScene" class="mb-3 p-3 rounded-lg bg-cyan-50/60 border border-cyan-100 text-xs text-slate-600 space-y-1.5">
            <p class="font-medium text-cyan-700">Writing a good scene</p>
            <ul class="space-y-1 text-[11px] text-slate-500 list-disc pl-4">
              <li><strong>Scene</strong> is the location/setting. Be vivid: <em>"neon-lit rainy alleyway at midnight"</em> not just <em>"alleyway"</em></li>
              <li><strong>Pose</strong> describes what the subject is doing: <em>"leaning against a wall, arms crossed"</em></li>
              <li><strong>Style</strong> controls the artistic look: <em>"cinematic"</em>, <em>"anime"</em>, <em>"oil painting"</em>, <em>"photorealistic"</em></li>
              <li><strong>Lighting</strong> sets the atmosphere: <em>"golden hour warmth"</em>, <em>"dramatic chiaroscuro"</em>, <em>"neon glow"</em></li>
              <li><strong>Mood</strong> is the emotional tone: <em>"mysterious"</em>, <em>"serene"</em>, <em>"epic"</em></li>
              <li><strong>Camera</strong> is the shot composition: <em>"close-up portrait"</em>, <em>"wide angle establishing shot"</em>, <em>"low angle heroic"</em></li>
              <li>Leave any field blank and it will be filled randomly at generation time for variety.</li>
            </ul>
          </div>
          <div class="space-y-2.5">
            <div>
              <label class="text-[11px] text-slate-500 font-medium mb-1 block">Name</label>
              <input
                v-model="sceneForm.name"
                type="text"
                placeholder="e.g. Neon City Night, Forest Glade..."
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
              />
            </div>
            <div v-for="key in sceneAttributeKeys" :key="key" class="flex gap-1.5 items-center">
              <label class="text-[11px] text-slate-500 font-medium w-20 shrink-0 flex items-center gap-1">
                <span>{{ attributeLabels[key].emoji }}</span>
                <span>{{ attributeLabels[key].label }}</span>
              </label>
              <input
                v-model="sceneForm[key]"
                type="text"
                :placeholder="attributePresets[key][0]"
                class="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
              />
              <button class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center shrink-0 text-xs" title="Randomize" @click="randomizeSceneField(key as SceneAttributeKey)">🎲</button>
            </div>
          </div>
          <div class="flex gap-2 mt-5 pt-4 border-t border-slate-100">
            <button
              class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              :class="canSaveScene ? 'bg-cyan-600 text-white hover:bg-cyan-700 active:scale-[0.98]' : 'bg-slate-100 text-slate-300 cursor-not-allowed'"
              :disabled="!canSaveScene"
              @click="saveScene"
            >
              {{ isCreatingScene ? 'Create Scene' : 'Save Changes' }}
            </button>
            <button
              v-if="isCreatingScene"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
              @click="cancelCreateScene"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div v-if="!selectedScene && !isCreatingScene && scenes.length > 0" class="mt-4">
        <p class="text-sm text-slate-400">Select a scene to edit, or go to <NuxtLink to="/create" class="text-violet-600 hover:underline">Create</NuxtLink> to combine with personas.</p>
      </div>
    </section>
  </div>
</template>
