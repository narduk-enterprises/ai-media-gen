<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()
const {
  config, projects, activeProject,
  addProject, deleteProject, renameProject, switchProject, duplicateProject,
  importProject, exportProject,
  addPreset, removePreset, clearCustomPresets, clearAllCustomPresets,
  setMergeMode, getCustomCount,
  addBasePrompt, removeBasePrompt, clearBasePrompts,
  setNegativePrompt,
} = usePromptPresets()

const { runpodEndpoint, customEndpoint } = useAppSettings()

import { attributeLabels, attributeKeys, attributePresets, characterAttributeKeys, type AttributeKey } from '~/utils/promptBuilder'
import type { Person, PersonAttributes } from '~/composables/usePersons'

const newPresetInputs = reactive<Record<string, string>>(
  Object.fromEntries(attributeKeys.map(k => [k, '']))
)

const expandedCategory = ref<AttributeKey | null>(null)
const showJsonImport = ref(false)
const jsonImportText = ref('')
const jsonImportError = ref('')
const newBasePrompt = ref('')
const newProjectName = ref('')
const renamingProjectId = ref<string | null>(null)
const renameProjectName = ref('')
const showProjectExport = ref(false)
const exportedJson = ref('')

// ─── Recovery ───────────────────────────────────────────────────────────
const recovering = ref(false)
const recoverResult = ref<{ recovered: number; failed: number; stillProcessing: number; total: number } | null>(null)
const recoverError = ref('')

async function recoverGenerations() {
  recovering.value = true
  recoverResult.value = null
  recoverError.value = ''
  try {
    const result = await $fetch<{ recovered: number; failed: number; stillProcessing: number; total: number }>('/api/generate/recover', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    recoverResult.value = result
  } catch (e: any) {
    recoverError.value = e?.data?.message || e?.message || 'Recovery failed'
  } finally {
    recovering.value = false
  }
}

// ─── Persons ────────────────────────────────────────────────────────────
const { persons, addPerson, deletePerson: deletePersonFn, renamePerson, updatePerson, duplicatePerson, importPersons, exportPerson } = usePersons()
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

function handleCreatePerson() {
  if (!newPersonName.value.trim()) return
  addPerson(newPersonName.value)
  newPersonName.value = ''
}

function startRenamePerson(person: Person) {
  renamingPersonId.value = person.id
  renamePersonName.value = person.name
}

function handleRenamePerson() {
  if (!renamingPersonId.value || !renamePersonName.value.trim()) return
  renamePerson(renamingPersonId.value, renamePersonName.value)
  renamingPersonId.value = null
  renamePersonName.value = ''
}

function startEditPerson(person: Person) {
  editingPersonId.value = editingPersonId.value === person.id ? null : person.id
  if (editingPersonId.value) {
    editingPersonAttrs.hair = person.hair
    editingPersonAttrs.eyes = person.eyes
    editingPersonAttrs.bodyType = person.bodyType
    editingPersonAttrs.skinTone = person.skinTone
    editingPersonAttrs.clothing = person.clothing
  }
}

function saveEditPerson() {
  if (!editingPersonId.value) return
  updatePerson(editingPersonId.value, { ...editingPersonAttrs })
  editingPersonId.value = null
}

const characterLabels = computed(() =>
  characterAttributeKeys.map(k => ({ key: k, ...attributeLabels[k] }))
)

function handlePersonImport() {
  personImportError.value = ''
  const raw = personImportText.value.trim()
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      personImportError.value = 'Expected a JSON object or array'
      return
    }
    const created = importPersons(parsed)
    if (created.length === 0) {
      personImportError.value = 'No valid persons found in JSON'
      return
    }
    personImportText.value = ''
    showPersonImport.value = false
  } catch {
    personImportError.value = 'Invalid JSON. Check your syntax.'
  }
}

function toggleCategory(key: AttributeKey) {
  expandedCategory.value = expandedCategory.value === key ? null : key
}

function handleAddPreset(key: AttributeKey) {
  const raw = (newPresetInputs[key] || '').trim()
  if (!raw) return

  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim()) addPreset(key, item.trim())
        }
        newPresetInputs[key] = ''
        return
      }
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, vals] of Object.entries(parsed)) {
          if (k === 'basePrompt' && Array.isArray(vals)) {
            for (const v of vals) {
              if (typeof v === 'string' && v.trim()) addBasePrompt(v.trim())
            }
          } else if (attributeKeys.includes(k as AttributeKey) && Array.isArray(vals)) {
            for (const v of vals) {
              if (typeof v === 'string' && v.trim()) addPreset(k as AttributeKey, v.trim())
            }
          }
        }
        newPresetInputs[key] = ''
        return
      }
    } catch { /* fall through */ }
  }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    addPreset(key, line)
  }
  newPresetInputs[key] = ''
}

function handleJsonImport() {
  jsonImportError.value = ''
  const raw = jsonImportText.value.trim()
  if (!raw) return

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      jsonImportError.value = 'Expected a JSON object with a "name" key and attribute arrays'
      return
    }
    importProject(parsed)
    jsonImportText.value = ''
    showJsonImport.value = false
    jsonImportError.value = ''
  } catch {
    jsonImportError.value = 'Invalid JSON. Check your syntax.'
  }
}

function handleCreateProject() {
  if (!newProjectName.value.trim()) return
  addProject(newProjectName.value)
  newProjectName.value = ''
}

function handleRenameProject() {
  if (!renamingProjectId.value || !renameProjectName.value.trim()) return
  renameProject(renamingProjectId.value, renameProjectName.value)
  renamingProjectId.value = null
  renameProjectName.value = ''
}

function startRename(id: string, name: string) {
  renamingProjectId.value = id
  renameProjectName.value = name
}

function handleExportProject() {
  if (!activeProject.value) return
  const json = exportProject(activeProject.value.id)
  exportedJson.value = JSON.stringify(json, null, 2)
  showProjectExport.value = true
}

function copyExport() {
  navigator.clipboard.writeText(exportedJson.value)
}

async function handleLogout() {
  await logout()
  navigateTo('/')
}

const totalCustomPresets = computed(() =>
  attributeKeys.reduce((sum, k) => sum + getCustomCount(k), 0)
)
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <h1 class="font-display text-2xl sm:text-3xl font-bold text-slate-800 mb-8">Settings</h1>

    <!-- Account info -->
    <UCard class="mb-6" variant="outline">
      <template #header>
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">Account</h2>
      </template>
      <div class="space-y-4">
        <UFormField label="Email" size="sm">
          <p class="text-sm text-slate-800">{{ user?.email || '—' }}</p>
        </UFormField>
        <UFormField label="Name" size="sm">
          <p class="text-sm text-slate-800">{{ user?.name || 'Not set' }}</p>
        </UFormField>
      </div>
    </UCard>

    <!-- ═══ AI Backend ═══ -->
    <UCard class="mb-6" variant="outline">
      <template #header>
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">AI Backend</h2>
      </template>

      <p class="text-xs text-slate-500 mb-4">
        Choose which RunPod endpoint to use for generation. The <strong>full</strong> image has all models baked in
        for fast cold starts. The <strong>slim</strong> image loads models from network volume (slower cold start, smaller image).
        The <strong>EU</strong> endpoint is a full image hosted in Europe for lower latency.
      </p>

      <div class="flex gap-2">
        <UButton
          v-for="ep in [{ key: 'full', label: 'Full', desc: '~40GB image, fast cold start' }, { key: 'slim', label: 'Slim', desc: '~2-3GB image, network volume models' }, { key: 'eu', label: 'EU', desc: 'EU region, lower latency for Europe' }]"
          :key="ep.key"
          class="flex-1 justify-start"
          :variant="runpodEndpoint === ep.key ? 'soft' : 'outline'"
          :color="runpodEndpoint === ep.key ? 'primary' : 'neutral'"
          @click="runpodEndpoint = ep.key as any"
        >
          <div class="text-left">
            <p class="text-xs font-medium">{{ ep.label }}</p>
            <p class="text-[10px] opacity-60">{{ ep.desc }}</p>
          </div>
        </UButton>
      </div>

      <!-- Custom endpoint URL -->
      <div class="mt-4">
        <UFormField label="Custom Endpoint URL" description="Override with a direct URL (e.g. a temporary RunPod pod). Leave empty to use the selected endpoint above." size="sm">
          <UInput v-model="customEndpoint" type="url" placeholder="https://your-pod-id.proxy.runpod.net/" class="w-full font-mono" size="sm" />
        </UFormField>
        <div v-if="customEndpoint" class="flex items-center gap-1.5 mt-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span class="text-[10px] text-emerald-600">Custom endpoint active</span>
          <UButton variant="link" color="error" size="xs" @click="customEndpoint = ''">Clear</UButton>
        </div>
      </div>

      <!-- Recovery -->
      <div class="mt-5 pt-4 border-t border-slate-100">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="text-xs font-medium text-slate-700">Recover Lost Generations</p>
            <p class="text-[10px] text-slate-400">Find and complete any generations that were interrupted (e.g. browser closed during processing)</p>
          </div>
          <UButton size="sm" variant="soft" color="warning" :loading="recovering" @click="recoverGenerations">
            {{ recovering ? 'Scanning...' : 'Recover' }}
          </UButton>
        </div>
        <!-- Result -->
        <div v-if="recoverResult" class="mt-2 p-3 rounded-lg text-xs" :class="recoverResult.total === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'">
          <template v-if="recoverResult.total === 0">
            ✅ No orphaned items found — all generations are accounted for.
          </template>
          <template v-else>
            Found <strong>{{ recoverResult.total }}</strong> orphaned items:
            <span v-if="recoverResult.recovered"> ✅ {{ recoverResult.recovered }} recovered</span>
            <span v-if="recoverResult.failed"> ❌ {{ recoverResult.failed }} failed</span>
            <span v-if="recoverResult.stillProcessing"> ⏳ {{ recoverResult.stillProcessing }} still processing</span>
          </template>
        </div>
        <div v-if="recoverError" class="mt-2 p-3 rounded-lg bg-red-50 text-red-600 text-xs">
          {{ recoverError }}
        </div>
      </div>
    </UCard>

    <!-- ═══ Projects ═══ -->
    <UCard class="mb-6" variant="outline">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">
          📁 Projects
        </h2>
        <div class="flex items-center gap-2">
          <UButton
            size="xs"
            variant="ghost"
            @click="showJsonImport = !showJsonImport"
          >
            {{ showJsonImport ? '✕ Close' : '📥 Import' }}
          </UButton>
          <UButton
            v-if="activeProject"
            size="xs"
            variant="ghost"
            @click="handleExportProject"
          >
            📤 Export
          </UButton>
        </div>
      </div>

      <p class="text-xs text-slate-500 mb-4">
        Each project has its own presets and base prompts. Switch between projects on the Create page.
      </p>

      <!-- Project list -->
      <div class="flex flex-wrap gap-2 mb-4">
        <button
          v-for="proj in projects"
          :key="proj.id"
          class="group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
          :class="activeProject?.id === proj.id
            ? 'bg-violet-50 border-violet-300 text-violet-700'
            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'"
          @click="switchProject(proj.id)"
        >
          <span>{{ proj.name }}</span>
          <span v-if="activeProject?.id === proj.id" class="w-1.5 h-1.5 rounded-full bg-violet-500" />
          <div v-if="projects.length > 1" class="hidden group-hover:flex items-center ml-1 gap-0.5">
            <button
              class="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Rename"
              @click.stop="startRename(proj.id, proj.name)"
            >
              <UIcon name="i-lucide-pencil" class="w-3 h-3" />
            </button>
            <button
              class="p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Delete"
              @click.stop="deleteProject(proj.id)"
            >
              <UIcon name="i-lucide-x" class="w-3 h-3" />
            </button>
          </div>
        </button>

        <!-- Add new project -->
        <div class="flex items-center gap-1.5">
          <input
            v-model="newProjectName"
            placeholder="New project…"
            class="w-28 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
            @keydown.enter="handleCreateProject"
          />
          <button
            class="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-violet-600 hover:border-violet-300 transition-colors"
            title="Create project"
            :disabled="!newProjectName.trim()"
            @click="handleCreateProject"
          >
            <UIcon name="i-lucide-plus" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Rename modal -->
      <div v-if="renamingProjectId" class="mb-4 flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <input
          v-model="renameProjectName"
          class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          @keydown.enter="handleRenameProject"
          @keydown.escape="renamingProjectId = null"
        />
        <UButton size="xs" @click="handleRenameProject">Rename</UButton>
        <button class="text-xs text-slate-500 hover:text-slate-700" @click="renamingProjectId = null">✕</button>
      </div>

      <!-- JSON import panel -->
      <div v-if="showJsonImport" class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <p class="text-[11px] text-slate-500 mb-2">
          Paste a JSON object to create a new project with presets:
        </p>
        <pre class="text-[10px] text-slate-400 mb-2 overflow-x-auto">{{ `{
  "name": "Fantasy Characters",
  "basePrompt": ["an elf warrior", "a dark wizard"],
  "hair": ["long black hair"],
  "eyes": ["glowing violet eyes"],
  "clothing": ["fantasy wizard robes"]
}` }}</pre>
        <textarea
          v-model="jsonImportText"
          placeholder="Paste JSON here..."
          rows="4"
          class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none font-mono"
        />
        <p v-if="jsonImportError" class="text-[11px] text-red-500 mt-1">{{ jsonImportError }}</p>
        <div class="flex justify-end mt-2">
          <UButton
            size="xs"
            :disabled="!jsonImportText.trim()"
            @click="handleJsonImport"
          >
            Import as New Project
          </UButton>
        </div>
      </div>

      <!-- Export modal -->
      <div v-if="showProjectExport" class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[11px] text-slate-500">Exported JSON — copy and share:</p>
          <div class="flex items-center gap-2">
            <button class="text-[11px] text-violet-600 hover:text-violet-700 transition-colors" @click="copyExport">📋 Copy</button>
            <button class="text-[11px] text-slate-500 hover:text-slate-700" @click="showProjectExport = false">✕</button>
          </div>
        </div>
        <pre class="text-[10px] text-slate-600 bg-white rounded-lg p-3 overflow-x-auto max-h-48 border border-slate-100">{{ exportedJson }}</pre>
      </div>

      <!-- No project selected state -->
      <div v-if="!activeProject" class="text-center py-6">
        <p class="text-xs text-slate-400">Create a project to start adding presets</p>
      </div>

      <!-- ─── Active Project Settings ─── -->
      <template v-if="activeProject">
        <!-- Default Negative Prompt -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-xs font-medium text-slate-700 mb-1.5">🚫 Default Negative Prompt</p>
          <p class="text-[10px] text-slate-400 mb-2">Loaded automatically when you switch to this project.</p>
          <textarea
            :value="config.negativePrompt"
            @input="(e: Event) => setNegativePrompt((e.target as HTMLTextAreaElement).value)"
            placeholder="ugly, deformed, blurry, low quality…"
            class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/30 min-h-[60px]"
          />
        </div>

        <!-- Saved Base Prompts -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-medium text-slate-700">📝 Base Prompts</p>
            <button
              v-if="config.basePrompts.length > 0"
              class="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
              @click="clearBasePrompts"
            >
              Clear all
            </button>
          </div>
          <div class="flex gap-2 mb-2">
            <input
              v-model="newBasePrompt"
              placeholder="Add a base prompt..."
              class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              @keyup.enter="() => { addBasePrompt(newBasePrompt); newBasePrompt = '' }"
            />
            <UButton size="xs" :disabled="!newBasePrompt.trim()" @click="() => { addBasePrompt(newBasePrompt); newBasePrompt = '' }">
              Add
            </UButton>
          </div>
          <div v-if="config.basePrompts.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="bp in config.basePrompts"
              :key="bp"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] group border border-emerald-200"
            >
              {{ bp.length > 40 ? bp.slice(0, 40) + '...' : bp }}
              <button
                class="opacity-0 group-hover:opacity-100 text-emerald-500 hover:text-red-500 transition-all text-xs"
                @click="removeBasePrompt(bp)"
              >
                ✕
              </button>
            </span>
          </div>
          <p v-else class="text-[10px] text-slate-400 italic">No saved base prompts yet</p>
        </div>

        <!-- Merge mode toggle -->
        <div class="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 mb-4">
          <div>
            <p class="text-xs font-medium text-slate-700">Merge with defaults</p>
            <p class="text-[11px] text-slate-500">When on, your presets appear alongside built-in ones.</p>
          </div>
          <div
            class="relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ml-4"
            :class="config.mergeWithDefaults ? 'bg-violet-500' : 'bg-slate-300'"
            @click="setMergeMode(!config.mergeWithDefaults)"
          >
            <div
              class="absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white transition-transform shadow-sm"
              :class="config.mergeWithDefaults ? 'translate-x-[18px]' : 'translate-x-[3px]'"
            />
          </div>
        </div>

        <!-- Clear all -->
        <button
          v-if="totalCustomPresets > 0"
          class="text-[11px] text-red-400 hover:text-red-500 transition-colors mb-4"
          @click="clearAllCustomPresets()"
        >
          ✕ Clear all custom presets
        </button>

        <!-- Attribute categories -->
        <div class="space-y-2">
          <div
            v-for="key in attributeKeys"
            :key="key"
            class="rounded-lg border transition-colors"
            :class="expandedCategory === key ? 'border-violet-200 bg-violet-50/50' : 'border-slate-200 bg-white'"
          >
            <button
              class="w-full flex items-center justify-between p-3 text-left"
              @click="toggleCategory(key)"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm">{{ attributeLabels[key].emoji }}</span>
                <span class="text-xs font-medium text-slate-700">{{ attributeLabels[key].label }}</span>
                <span v-if="getCustomCount(key) > 0" class="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                  +{{ getCustomCount(key) }}
                </span>
              </div>
              <UIcon
                :name="expandedCategory === key ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="w-4 h-4 text-slate-400"
              />
            </button>

            <div v-if="expandedCategory === key" class="px-3 pb-3">
              <div class="mb-3">
                <textarea
                  v-model="newPresetInputs[key]"
                  :placeholder="`Add custom ${attributeLabels[key].label.toLowerCase()}...\nOne per line`"
                  rows="3"
                  class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
                />
                <div class="flex items-center justify-between mt-1.5">
                  <p class="text-[10px] text-slate-400">One per line • or paste JSON array</p>
                  <UButton
                    size="xs"
                    :disabled="!newPresetInputs[key]?.trim()"
                    @click="handleAddPreset(key)"
                  >
                    Add All
                  </UButton>
                </div>
              </div>

              <div v-if="getCustomCount(key) > 0" class="mb-3">
                <p class="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-medium">Your Presets</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="preset in config.custom[key]"
                    :key="preset"
                    class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-50 text-violet-700 text-[11px] group border border-violet-200"
                  >
                    {{ preset }}
                    <button
                      class="text-violet-400 hover:text-red-500 transition-colors"
                      @click="removePreset(key, preset)"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <button
                  class="text-[10px] text-slate-400 hover:text-slate-600 transition-colors mt-2"
                  @click="clearCustomPresets(key)"
                >
                  Clear {{ attributeLabels[key].label.toLowerCase() }} presets
                </button>
              </div>

              <div>
                <p class="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-medium">Built-in Presets</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="preset in attributePresets[key]"
                    :key="preset"
                    class="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[11px] cursor-default border border-slate-200"
                  >
                    {{ preset }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UCard>

    <!-- ═══ Persons ═══ -->
    <UCard class="mb-6" variant="outline">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">
          👤 Persons
        </h2>
        <UButton
          size="xs"
          variant="ghost"
          @click="showPersonImport = !showPersonImport"
        >
          {{ showPersonImport ? '✕ Close' : '📥 Import JSON' }}
        </UButton>
      </div>

      <p class="text-xs text-slate-500 mb-4">
        Save fictional characters with appearance traits. Load them into the prompt builder on the Create page.
      </p>

      <!-- JSON import panel -->
      <div v-if="showPersonImport" class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <p class="text-[11px] text-slate-500 mb-2">
          Paste JSON to import one or more persons:
        </p>
        <pre class="text-[10px] text-slate-400 mb-2 overflow-x-auto">{{ `{ "name": "Cyber Girl", "hair": "long platinum hair", "eyes": "glowing blue eyes" }

or an array:
[{ "name": "Elf", "hair": "silver hair" }, { "name": "Knight", "clothing": "plate armor" }]` }}</pre>
        <textarea
          v-model="personImportText"
          placeholder="Paste JSON here..."
          rows="4"
          class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none font-mono"
        />
        <p v-if="personImportError" class="text-[11px] text-red-500 mt-1">{{ personImportError }}</p>
        <div class="flex justify-end mt-2">
          <UButton
            size="xs"
            :disabled="!personImportText.trim()"
            @click="handlePersonImport"
          >
            Import
          </UButton>
        </div>
      </div>

      <!-- Create person -->
      <div class="flex items-center gap-2 mb-4">
        <input
          v-model="newPersonName"
          placeholder="New person name…"
          class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          @keydown.enter="handleCreatePerson"
        />
        <UButton size="xs" :disabled="!newPersonName.trim()" @click="handleCreatePerson">
          + Add Person
        </UButton>
      </div>

      <!-- Rename inline -->
      <div v-if="renamingPersonId" class="mb-4 flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <input
          v-model="renamePersonName"
          class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          @keydown.enter="handleRenamePerson"
          @keydown.escape="renamingPersonId = null"
        />
        <UButton size="xs" @click="handleRenamePerson">Rename</UButton>
        <button class="text-xs text-slate-500 hover:text-slate-700" @click="renamingPersonId = null">✕</button>
      </div>

      <!-- Person list -->
      <div v-if="persons.length === 0" class="text-center py-6">
        <p class="text-xs text-slate-400">No saved persons yet</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="person in persons"
          :key="person.id"
          class="rounded-lg border transition-colors"
          :class="editingPersonId === person.id ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white'"
        >
          <div class="flex items-center justify-between p-3">
            <div class="flex items-center gap-2">
              <span class="text-sm">👤</span>
              <span class="text-xs font-medium text-slate-700">{{ person.name }}</span>
              <!-- Attribute pills -->
              <div class="flex items-center gap-1 ml-1">
                <span
                  v-for="key of characterAttributeKeys"
                  :key="key"
                  v-if="person[key]"
                  class="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[9px] border border-amber-200"
                  :title="`${attributeLabels[key].label}: ${person[key]}`"
                >
                  {{ attributeLabels[key].emoji }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <button
                class="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                title="Edit"
                @click="startEditPerson(person)"
              >
                <UIcon name="i-lucide-pencil" class="w-3.5 h-3.5" />
              </button>
              <button
                class="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Rename"
                @click="startRenamePerson(person)"
              >
                <UIcon name="i-lucide-tag" class="w-3.5 h-3.5" />
              </button>
              <button
                class="p-1 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                title="Duplicate"
                @click="duplicatePerson(person.id)"
              >
                <UIcon name="i-lucide-copy" class="w-3.5 h-3.5" />
              </button>
              <button
                class="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete"
                @click="deletePersonFn(person.id)"
              >
                <UIcon name="i-lucide-x" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <!-- Edit panel -->
          <div v-if="editingPersonId === person.id" class="px-3 pb-3 space-y-1.5">
            <div v-for="item in characterLabels" :key="item.key" class="flex items-center gap-1.5">
              <span class="text-[10px] text-slate-400 w-16 shrink-0">{{ item.emoji }} {{ item.label }}</span>
              <input
                v-model="editingPersonAttrs[item.key]"
                :placeholder="attributePresets[item.key][0]"
                class="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
              />
              <select
                class="appearance-none bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px] text-slate-500 focus:outline-none cursor-pointer max-w-[100px]"
                :value="''"
                @change="(e: Event) => { editingPersonAttrs[item.key] = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = '' }"
              >
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

    <!-- Danger zone -->
    <UCard class="border-red-100" variant="outline">
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Session</h2>
      <UButton
        color="error"
        variant="outline"
        @click="handleLogout"
      >
        Sign Out
      </UButton>
    </UCard>
  </div>
</template>
