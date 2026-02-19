<script setup lang="ts">
import { attributeLabels, attributePresets, characterAttributeKeys, type AttributeKey } from '~/utils/promptBuilder'
import type { Person, PersonAttributes } from '~/composables/usePersons'

const { persons, addPerson, deletePerson: deletePersonFn, renamePerson, updatePerson, duplicatePerson, importPersons } = usePersons()

const newPersonName = ref('')
const renamingPersonId = ref<string | null>(null)
const renamePersonName = ref('')
const editingPersonId = ref<string | null>(null)
const showPersonImport = ref(false)
const personImportText = ref('')
const personImportError = ref('')
const editingPersonAttrs = reactive<PersonAttributes>({
  hair: '', eyes: '', bodyType: '', skinTone: '', clothing: '',
})

function handleCreatePerson() { if (!newPersonName.value.trim()) return; addPerson(newPersonName.value); newPersonName.value = '' }

function startRenamePerson(person: Person) { renamingPersonId.value = person.id; renamePersonName.value = person.name }

function handleRenamePerson() {
  if (!renamingPersonId.value || !renamePersonName.value.trim()) return
  renamePerson(renamingPersonId.value, renamePersonName.value); renamingPersonId.value = null; renamePersonName.value = ''
}

function startEditPerson(person: Person) {
  editingPersonId.value = editingPersonId.value === person.id ? null : person.id
  if (editingPersonId.value) {
    editingPersonAttrs.hair = person.hair; editingPersonAttrs.eyes = person.eyes
    editingPersonAttrs.bodyType = person.bodyType; editingPersonAttrs.skinTone = person.skinTone; editingPersonAttrs.clothing = person.clothing
  }
}

function saveEditPerson() {
  if (!editingPersonId.value) return
  updatePerson(editingPersonId.value, { ...editingPersonAttrs }); editingPersonId.value = null
}

const characterLabels = computed(() => characterAttributeKeys.map(k => ({ key: k, ...attributeLabels[k] })))

function handlePersonImport() {
  personImportError.value = ''
  const raw = personImportText.value.trim()
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) { personImportError.value = 'Expected a JSON object or array'; return }
    const created = importPersons(parsed)
    if (created.length === 0) { personImportError.value = 'No valid persons found in JSON'; return }
    personImportText.value = ''; showPersonImport.value = false
  } catch { personImportError.value = 'Invalid JSON. Check your syntax.' }
}
</script>

<template>
  <UCard class="mb-6" variant="outline">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">👤 Persons</h2>
      <UButton size="xs" variant="ghost" @click="showPersonImport = !showPersonImport">{{ showPersonImport ? '✕ Close' : '📥 Import JSON' }}</UButton>
    </div>

    <p class="text-xs text-slate-500 mb-4">Save fictional characters with appearance traits. Load them into the prompt builder on the Create page.</p>

    <!-- Import -->
    <div v-if="showPersonImport" class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
      <p class="text-[11px] text-slate-500 mb-2">Paste JSON to import one or more persons:</p>
      <pre class="text-[10px] text-slate-400 mb-2 overflow-x-auto">{{ `{ "name": "Cyber Girl", "hair": "long platinum hair", "eyes": "glowing blue eyes" }

or an array:
[{ "name": "Elf", "hair": "silver hair" }, { "name": "Knight", "clothing": "plate armor" }]` }}</pre>
      <textarea v-model="personImportText" placeholder="Paste JSON here..." rows="4" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none font-mono" />
      <p v-if="personImportError" class="text-[11px] text-red-500 mt-1">{{ personImportError }}</p>
      <div class="flex justify-end mt-2"><UButton size="xs" :disabled="!personImportText.trim()" @click="handlePersonImport">Import</UButton></div>
    </div>

    <!-- Create -->
    <div class="flex items-center gap-2 mb-4">
      <input v-model="newPersonName" placeholder="New person name…" class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30" @keydown.enter="handleCreatePerson" />
      <UButton size="xs" :disabled="!newPersonName.trim()" @click="handleCreatePerson">+ Add Person</UButton>
    </div>

    <!-- Rename -->
    <div v-if="renamingPersonId" class="mb-4 flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
      <input v-model="renamePersonName" class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-500/30" @keydown.enter="handleRenamePerson" @keydown.escape="renamingPersonId = null" />
      <UButton size="xs" @click="handleRenamePerson">Rename</UButton>
      <button class="text-xs text-slate-500 hover:text-slate-700" @click="renamingPersonId = null">✕</button>
    </div>

    <!-- List -->
    <div v-if="persons.length === 0" class="text-center py-6"><p class="text-xs text-slate-400">No saved persons yet</p></div>
    <div v-else class="space-y-2">
      <div v-for="person in persons" :key="person.id" class="rounded-lg border transition-colors" :class="editingPersonId === person.id ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white'">
        <div class="flex items-center justify-between p-3">
          <div class="flex items-center gap-2">
            <span class="text-sm">👤</span>
            <span class="text-xs font-medium text-slate-700">{{ person.name }}</span>
            <div class="flex items-center gap-1 ml-1">
              <template v-for="key of characterAttributeKeys" :key="key">
                <span v-if="(person as any)[key]" class="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[9px] border border-amber-200" :title="`${attributeLabels[key].label}: ${(person as any)[key]}`">{{ attributeLabels[key].emoji }}</span>
              </template>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button class="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Edit" @click="startEditPerson(person)"><UIcon name="i-lucide-pencil" class="w-3.5 h-3.5" /></button>
            <button class="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="Rename" @click="startRenamePerson(person)"><UIcon name="i-lucide-tag" class="w-3.5 h-3.5" /></button>
            <button class="p-1 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors" title="Duplicate" @click="duplicatePerson(person.id)"><UIcon name="i-lucide-copy" class="w-3.5 h-3.5" /></button>
            <button class="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete" @click="deletePersonFn(person.id)"><UIcon name="i-lucide-x" class="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div v-if="editingPersonId === person.id" class="px-3 pb-3 space-y-1.5">
          <div v-for="item in characterLabels" :key="item.key" class="flex items-center gap-1.5">
            <span class="text-[10px] text-slate-400 w-16 shrink-0">{{ item.emoji }} {{ item.label }}</span>
            <input v-model="editingPersonAttrs[item.key]" :placeholder="attributePresets[item.key][0]" class="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500/20" />
            <select class="appearance-none bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px] text-slate-500 focus:outline-none cursor-pointer max-w-[100px]" :value="''"
              @change="(e: Event) => { editingPersonAttrs[item.key] = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = '' }">
              <option value="" disabled selected>▾</option>
              <option v-for="preset in attributePresets[item.key]" :key="preset" :value="preset">{{ preset }}</option>
            </select>
          </div>
          <div class="flex justify-end gap-2 mt-2">
            <button class="text-[11px] text-slate-500 hover:text-slate-700" @click="editingPersonId = null">Cancel</button>
            <UButton size="xs" @click="saveEditPerson">Save Changes</UButton>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
