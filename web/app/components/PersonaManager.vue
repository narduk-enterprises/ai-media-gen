<script setup lang="ts">
import {
  attributeLabels,
  attributePresets,
  characterAttributeKeys,
  pickRandom,
  type CharacterAttributeKey,
} from '~/utils/promptBuilder'

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

// ─── Selection & form ────────────────────────────────────────
const selectedPersonId = ref<string | null>(null)
const isCreating = ref(false)
const justSaved = ref(false)

const selectedPerson = computed(() =>
  persons.value.find((p: any) => p.id === selectedPersonId.value) ?? null
)

interface PersonFormData {
  name: string; description: string; hair: string; eyes: string
  bodyType: string; skinTone: string; clothing: string; [key: string]: string
}

const personForm = reactive<PersonFormData>({
  name: '', description: '', hair: '', eyes: '', bodyType: '', skinTone: '', clothing: '',
})

function populatePersonForm(person: any) {
  personForm.name = person.name; personForm.description = person.description || ''
  personForm.hair = person.hair; personForm.eyes = person.eyes
  personForm.bodyType = person.bodyType; personForm.skinTone = person.skinTone; personForm.clothing = person.clothing
}

function resetPersonForm() {
  personForm.name = ''; personForm.description = ''; personForm.hair = ''
  personForm.eyes = ''; personForm.bodyType = ''; personForm.skinTone = ''; personForm.clothing = ''
}

function selectPerson(id: string) {
  selectedPersonId.value = id; isCreating.value = false
  const person = getPerson(id)
  if (person) populatePersonForm(person)
}

function startCreatePerson() {
  selectedPersonId.value = null; isCreating.value = true; resetPersonForm()
}

function cancelCreatePerson() {
  isCreating.value = false
  if (persons.value.length > 0) selectPerson(persons.value[0]!.id)
}

const hasUnsavedPersonChanges = computed(() => {
  if (isCreating.value) return true
  if (!selectedPerson.value) return false
  const p = selectedPerson.value as any
  return personForm.name !== p.name || personForm.description !== (p.description || '') ||
    personForm.hair !== p.hair || personForm.eyes !== p.eyes || personForm.bodyType !== p.bodyType ||
    personForm.skinTone !== p.skinTone || personForm.clothing !== p.clothing
})

const canSavePerson = computed(() => {
  if (isCreating.value) return personForm.name.trim() !== ''
  return hasUnsavedPersonChanges.value && personForm.name.trim() !== ''
})

function savePerson() {
  if (!canSavePerson.value) return
  if (isCreating.value) {
    const person = addPerson(personForm.name, {
      description: personForm.description, hair: personForm.hair, eyes: personForm.eyes,
      bodyType: personForm.bodyType, skinTone: personForm.skinTone, clothing: personForm.clothing,
    })
    selectedPersonId.value = person.id; isCreating.value = false
  } else if (selectedPersonId.value) {
    renamePerson(selectedPersonId.value, personForm.name)
    updatePerson(selectedPersonId.value, {
      description: personForm.description, hair: personForm.hair, eyes: personForm.eyes,
      bodyType: personForm.bodyType, skinTone: personForm.skinTone, clothing: personForm.clothing,
    })
  }
  justSaved.value = true
  setTimeout(() => { justSaved.value = false }, 2000)
}

function deletePersonAction() {
  if (!selectedPersonId.value) return
  if (!confirm(`Delete "${selectedPerson.value?.name}"? This cannot be undone.`)) return
  deletePerson(selectedPersonId.value); selectedPersonId.value = null
}

function duplicatePersonAction() {
  if (!selectedPersonId.value) return
  const copy = duplicatePerson(selectedPersonId.value)
  if (copy) { selectedPersonId.value = copy.id; populatePersonForm(copy) }
}

function randomizePersonField(key: CharacterAttributeKey) {
  personForm[key] = pickRandom(attributePresets[key])
}

function personSummary(person: any): string {
  if (person.description) return person.description.length > 50 ? person.description.slice(0, 50) + '…' : person.description
  const parts: string[] = []
  for (const key of characterAttributeKeys) {
    if (person[key]) { parts.push(person[key]); if (parts.length >= 2) break }
  }
  return parts.join(' · ') || 'No details yet'
}

// ─── Import/Export ───────────────────────────────────────────
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
    if (created.length === 0) { personaImportError.value = 'No valid personas found in the JSON'; return }
    personaImportText.value = ''; showPersonaImport.value = false
    selectPerson(created[0]!.id)
  } catch { personaImportError.value = 'Invalid JSON — expected an object or array of objects' }
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
</script>

<template>
  <section class="mb-10">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-slate-700">My Personas</h2>
      <div class="flex items-center gap-3">
        <button class="text-xs font-medium transition-colors" :class="showPersonaImport ? 'text-violet-600' : 'text-slate-400 hover:text-slate-600'"
          @click="showPersonaImport = !showPersonaImport; personaImportError = ''">Import JSON</button>
        <button class="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors" @click="startCreatePerson">+ New Persona</button>
      </div>
    </div>

    <div v-if="showPersonaImport" class="mb-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
      <p class="text-[11px] text-slate-500 mb-2">Paste JSON to import one or more personas:</p>
      <pre class="text-[9px] text-slate-400 mb-2 overflow-x-auto bg-white rounded-lg p-2 border border-slate-100">{{ '{ "name": "Cyber Girl", "description": "25yo hacker", "hair": "neon pink pixie cut", "eyes": "glowing blue" }' }}</pre>
      <UTextarea v-model="personaImportText" :rows="3" placeholder="Paste a single object or an array of objects..." class="font-mono" />
      <UAlert v-if="personaImportError" color="error" variant="subtle" :title="personaImportError" size="sm" class="mt-2" />
      <div class="flex gap-2 mt-2">
        <UButton color="primary" size="sm" :disabled="!personaImportText.trim()" @click="handlePersonaImport">Import</UButton>
        <UButton variant="outline" color="neutral" size="sm" @click="showPersonaImport = false">Cancel</UButton>
      </div>
    </div>

    <div v-if="persons.length === 0 && !isCreating" class="glass-card p-10 text-center">
      <div class="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-violet-500">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <h3 class="text-sm font-semibold text-slate-700 mb-1">No personas yet</h3>
      <p class="text-xs text-slate-400 mb-5 max-w-md mx-auto">A persona defines a character's appearance. Create one, then use it on the Create page with your scenes.</p>
      <button class="px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors active:scale-[0.98]" @click="startCreatePerson">Create Your First Persona</button>
    </div>

    <div v-else class="overflow-x-auto pb-2">
      <div class="inline-flex gap-3">
        <button v-for="person in persons" :key="person.id" class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
          :class="selectedPersonId === person.id && !isCreating ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
          @click="selectPerson(person.id)">
          <div class="flex items-center gap-2.5 mb-1.5">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              :class="selectedPersonId === person.id && !isCreating ? 'bg-violet-200 text-violet-700' : 'bg-slate-100 text-slate-500'">{{ person.name.charAt(0).toUpperCase() }}</div>
            <span class="font-medium text-sm text-slate-700 truncate">{{ person.name }}</span>
          </div>
          <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ personSummary(person) }}</p>
        </button>
        <button class="shrink-0 w-40 p-3 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1"
          :class="isCreating ? 'border-violet-300 bg-violet-50/50' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'"
          @click="startCreatePerson">
          <span class="text-2xl text-slate-300">+</span>
          <span class="text-[11px] text-slate-400 font-medium">New Persona</span>
        </button>
      </div>
    </div>

    <!-- Persona form -->
    <div v-if="isCreating || selectedPerson" class="mt-6 max-w-xl">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-700">{{ isCreating ? 'New Persona' : 'Persona Profile' }}</h2>
            <div v-if="!isCreating" class="flex items-center gap-1">
              <span v-if="justSaved" class="text-xs text-emerald-500 font-medium animate-pulse">Saved!</span>
              <span v-if="copiedPersona" class="text-xs text-emerald-500 font-medium animate-pulse">Copied!</span>
              <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-upload" title="Export as JSON" @click="handleExportPersona" />
              <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-copy" title="Duplicate" @click="duplicatePersonAction" />
              <UButton variant="ghost" color="error" size="xs" icon="i-lucide-trash-2" title="Delete" @click="deletePersonAction" />
            </div>
          </div>
        </template>
        <div v-if="isCreating" class="mb-4 p-3 rounded-lg bg-violet-50/60 border border-violet-100 text-xs text-slate-600 space-y-1.5">
          <p class="font-medium text-violet-700">Writing a good persona</p>
          <ul class="space-y-1 text-[11px] text-slate-500 list-disc pl-4">
            <li><strong>Description</strong> is the most important field. Write it as a short phrase the AI model will see directly: <em>"25 year old woman, athletic, confident expression"</em></li>
            <li><strong>Appearance fields</strong> are concatenated into the prompt. Be specific and visual: <em>"long flowing black hair"</em> beats <em>"black hair"</em></li>
            <li>Leave fields blank to skip them. Only fill what matters for consistency across scenes.</li>
          </ul>
        </div>
        <div class="space-y-3">
          <UFormField label="Name"><UInput v-model="personForm.name" placeholder="e.g. Cyber Girl, Forest Elf..." /></UFormField>
          <UFormField label="Description"><UTextarea v-model="personForm.description" placeholder="e.g. 25 year old woman, athletic build, confident expression" :rows="2" autoresize /></UFormField>
          <div class="border-t border-slate-100 pt-2"><span class="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Appearance</span></div>
          <div v-for="key in characterAttributeKeys" :key="key" class="flex gap-1.5 items-center">
            <label class="text-[11px] text-slate-500 font-medium w-24 shrink-0 flex items-center gap-1"><span>{{ attributeLabels[key].emoji }}</span><span>{{ attributeLabels[key].label }}</span></label>
            <UInput v-model="personForm[key]" :placeholder="attributePresets[key][0]" size="sm" class="flex-1" />
            <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-dice-3" title="Randomize" @click="randomizePersonField(key as CharacterAttributeKey)" />
          </div>
        </div>
        <template #footer>
          <div class="flex gap-2">
            <UButton color="primary" class="flex-1" :disabled="!canSavePerson" @click="savePerson">{{ isCreating ? 'Create Persona' : 'Save Changes' }}</UButton>
            <UButton v-if="isCreating" variant="outline" color="neutral" @click="cancelCreatePerson">Cancel</UButton>
          </div>
        </template>
      </UCard>
    </div>

    <div v-if="!selectedPerson && !isCreating && persons.length > 0" class="mt-4">
      <p class="text-sm text-slate-400">Select a persona to edit, or go to <NuxtLink to="/create" class="text-violet-600 hover:underline">Create</NuxtLink> to generate images.</p>
    </div>
  </section>
</template>
