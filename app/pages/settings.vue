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
} = usePromptPresets()

import { attributeLabels, attributeKeys, attributePresets, type AttributeKey } from '~/utils/promptBuilder'

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
  <div class="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <h1 class="font-display text-2xl sm:text-3xl font-bold mb-8">Settings</h1>

    <!-- Account info -->
    <div class="glass-card p-6 mb-6">
      <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Account</h2>

      <div class="space-y-4">
        <div>
          <label class="text-xs text-zinc-500">Email</label>
          <p class="text-sm text-white">{{ user?.email || '—' }}</p>
        </div>
        <div>
          <label class="text-xs text-zinc-500">Name</label>
          <p class="text-sm text-white">{{ user?.name || 'Not set' }}</p>
        </div>
      </div>
    </div>

    <!-- ═══ Projects ═══ -->
    <div class="glass-card p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
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

      <p class="text-xs text-zinc-500 mb-4">
        Each project has its own presets and base prompts. Switch between projects on the Create page.
      </p>

      <!-- Project list -->
      <div class="flex flex-wrap gap-2 mb-4">
        <button
          v-for="proj in projects"
          :key="proj.id"
          class="group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
          :class="activeProject?.id === proj.id
            ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
            : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'"
          @click="switchProject(proj.id)"
        >
          <span>{{ proj.name }}</span>
          <span v-if="activeProject?.id === proj.id" class="w-1.5 h-1.5 rounded-full bg-violet-400" />
          <div v-if="projects.length > 1" class="hidden group-hover:flex items-center ml-1 gap-0.5">
            <button
              class="p-0.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Rename"
              @click.stop="startRename(proj.id, proj.name)"
            >
              <UIcon name="i-heroicons-pencil-square" class="w-3 h-3" />
            </button>
            <button
              class="p-0.5 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete"
              @click.stop="deleteProject(proj.id)"
            >
              <UIcon name="i-heroicons-x-mark" class="w-3 h-3" />
            </button>
          </div>
        </button>

        <!-- Add new project -->
        <div class="flex items-center gap-1.5">
          <input
            v-model="newProjectName"
            placeholder="New project…"
            class="w-28 bg-zinc-900/50 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
            @keydown.enter="handleCreateProject"
          />
          <button
            class="p-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-violet-400 hover:border-violet-500/30 transition-colors"
            title="Create project"
            :disabled="!newProjectName.trim()"
            @click="handleCreateProject"
          >
            <UIcon name="i-heroicons-plus" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Rename modal -->
      <div v-if="renamingProjectId" class="mb-4 flex items-center gap-2 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
        <input
          v-model="renameProjectName"
          class="flex-1 bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          @keydown.enter="handleRenameProject"
          @keydown.escape="renamingProjectId = null"
        />
        <UButton size="xs" @click="handleRenameProject">Rename</UButton>
        <button class="text-xs text-zinc-500 hover:text-zinc-300" @click="renamingProjectId = null">✕</button>
      </div>

      <!-- JSON import panel — now imports as a new project -->
      <div v-if="showJsonImport" class="mb-4 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
        <p class="text-[11px] text-zinc-400 mb-2">
          Paste a JSON object to create a new project with presets:
        </p>
        <pre class="text-[10px] text-zinc-600 mb-2 overflow-x-auto">{{ `{
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
          class="w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none font-mono"
        />
        <p v-if="jsonImportError" class="text-[11px] text-red-400 mt-1">{{ jsonImportError }}</p>
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
      <div v-if="showProjectExport" class="mb-4 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[11px] text-zinc-400">Exported JSON — copy and share:</p>
          <div class="flex items-center gap-2">
            <button class="text-[11px] text-violet-400 hover:text-violet-300 transition-colors" @click="copyExport">📋 Copy</button>
            <button class="text-[11px] text-zinc-500 hover:text-zinc-300" @click="showProjectExport = false">✕</button>
          </div>
        </div>
        <pre class="text-[10px] text-zinc-400 bg-zinc-800/60 rounded-lg p-3 overflow-x-auto max-h-48">{{ exportedJson }}</pre>
      </div>

      <!-- No project selected state -->
      <div v-if="!activeProject" class="text-center py-6">
        <p class="text-xs text-zinc-500">Create a project to start adding presets</p>
      </div>

      <!-- ─── Active Project Settings ─── -->
      <template v-if="activeProject">
        <!-- Saved Base Prompts -->
        <div class="mb-4 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-medium text-zinc-300">📝 Base Prompts</p>
            <button
              v-if="config.basePrompts.length > 0"
              class="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
              @click="clearBasePrompts"
            >
              Clear all
            </button>
          </div>
          <div class="flex gap-2 mb-2">
            <input
              v-model="newBasePrompt"
              placeholder="Add a base prompt..."
              class="flex-1 bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
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
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-[11px] group"
            >
              {{ bp.length > 40 ? bp.slice(0, 40) + '...' : bp }}
              <button
                class="opacity-0 group-hover:opacity-100 text-emerald-400 hover:text-red-400 transition-all text-xs"
                @click="removeBasePrompt(bp)"
              >
                ✕
              </button>
            </span>
          </div>
          <p v-else class="text-[10px] text-zinc-600 italic">No saved base prompts yet</p>
        </div>

        <!-- Merge mode toggle -->
        <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 mb-4">
          <div>
            <p class="text-xs font-medium text-zinc-300">Merge with defaults</p>
            <p class="text-[11px] text-zinc-500">When on, your presets appear alongside built-in ones.</p>
          </div>
          <div
            class="relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ml-4"
            :class="config.mergeWithDefaults ? 'bg-violet-500' : 'bg-zinc-700'"
            @click="setMergeMode(!config.mergeWithDefaults)"
          >
            <div
              class="absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white transition-transform"
              :class="config.mergeWithDefaults ? 'translate-x-[18px]' : 'translate-x-[3px]'"
            />
          </div>
        </div>

        <!-- Clear all -->
        <button
          v-if="totalCustomPresets > 0"
          class="text-[11px] text-red-400/60 hover:text-red-400 transition-colors mb-4"
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
            :class="expandedCategory === key ? 'border-violet-500/20 bg-violet-500/5' : 'border-zinc-800 bg-zinc-900/30'"
          >
            <button
              class="w-full flex items-center justify-between p-3 text-left"
              @click="toggleCategory(key)"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm">{{ attributeLabels[key].emoji }}</span>
                <span class="text-xs font-medium text-zinc-300">{{ attributeLabels[key].label }}</span>
                <span v-if="getCustomCount(key) > 0" class="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
                  +{{ getCustomCount(key) }}
                </span>
              </div>
              <UIcon
                :name="expandedCategory === key ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                class="w-4 h-4 text-zinc-500"
              />
            </button>

            <div v-if="expandedCategory === key" class="px-3 pb-3">
              <div class="mb-3">
                <textarea
                  v-model="newPresetInputs[key]"
                  :placeholder="`Add custom ${attributeLabels[key].label.toLowerCase()}...\nOne per line`"
                  rows="3"
                  class="w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
                />
                <div class="flex items-center justify-between mt-1.5">
                  <p class="text-[10px] text-zinc-600">One per line • or paste JSON array</p>
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
                <p class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">Your Presets</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="preset in config.custom[key]"
                    :key="preset"
                    class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-500/15 text-violet-300 text-[11px] group"
                  >
                    {{ preset }}
                    <button
                      class="text-violet-400/40 hover:text-red-400 transition-colors"
                      @click="removePreset(key, preset)"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <button
                  class="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
                  @click="clearCustomPresets(key)"
                >
                  Clear {{ attributeLabels[key].label.toLowerCase() }} presets
                </button>
              </div>

              <div>
                <p class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">Built-in Presets</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="preset in attributePresets[key]"
                    :key="preset"
                    class="px-2 py-1 rounded-full bg-zinc-800/50 text-zinc-500 text-[11px] cursor-default"
                  >
                    {{ preset }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Danger zone -->
    <div class="glass-card p-6 border-red-500/10">
      <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Session</h2>
      <UButton
        color="error"
        variant="outline"
        @click="handleLogout"
      >
        Sign Out
      </UButton>
    </div>
  </div>
</template>
