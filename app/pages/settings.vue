<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()
const { config, addPreset, removePreset, clearCustomPresets, clearAllCustomPresets, setMergeMode, getCustomCount } = usePromptPresets()

import { attributeLabels, attributeKeys, attributePresets, type AttributeKey } from '~/utils/promptBuilder'

const newPresetInputs = reactive<Record<string, string>>(
  Object.fromEntries(attributeKeys.map(k => [k, '']))
)

const expandedCategory = ref<AttributeKey | null>(null)

function toggleCategory(key: AttributeKey) {
  expandedCategory.value = expandedCategory.value === key ? null : key
}

function handleAddPreset(key: AttributeKey) {
  const raw = (newPresetInputs[key] || '').trim()
  if (!raw) return

  // Try JSON first: ["a", "b"] or {"hair": [...], "eyes": [...]}
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // Flat array — add all to this category
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim()) addPreset(key, item.trim())
        }
        newPresetInputs[key] = ''
        return
      }
      if (typeof parsed === 'object' && parsed !== null) {
        // Object — add to each matching category
        for (const [k, vals] of Object.entries(parsed)) {
          if (attributeKeys.includes(k as AttributeKey) && Array.isArray(vals)) {
            for (const v of vals) {
              if (typeof v === 'string' && v.trim()) addPreset(k as AttributeKey, v.trim())
            }
          }
        }
        newPresetInputs[key] = ''
        return
      }
    } catch { /* not valid JSON, fall through to newline parsing */ }
  }

  // Newline-separated
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    addPreset(key, line)
  }
  newPresetInputs[key] = ''
}

const showJsonImport = ref(false)
const jsonImportText = ref('')
const jsonImportError = ref('')

function handleJsonImport() {
  jsonImportError.value = ''
  const raw = jsonImportText.value.trim()
  if (!raw) return

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      jsonImportError.value = 'Expected an object like { "hair": ["..."], "eyes": ["..."] }'
      return
    }
    let count = 0
    for (const [k, vals] of Object.entries(parsed)) {
      if (attributeKeys.includes(k as AttributeKey) && Array.isArray(vals)) {
        for (const v of vals) {
          if (typeof v === 'string' && v.trim()) {
            addPreset(k as AttributeKey, v.trim())
            count++
          }
        }
      }
    }
    jsonImportText.value = ''
    showJsonImport.value = false
    jsonImportError.value = ''
  } catch {
    jsonImportError.value = 'Invalid JSON. Check your syntax.'
  }
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

    <!-- ═══ Prompt Builder Presets ═══ -->
    <div class="glass-card p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          🧩 Prompt Builder Presets
        </h2>
        <span v-if="totalCustomPresets > 0" class="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">
          {{ totalCustomPresets }} custom
        </span>
      </div>

      <div class="flex items-start justify-between mb-4">
        <p class="text-xs text-zinc-500">
          Add your own presets for each prompt attribute. These will appear alongside the built-in options on the Create page.
        </p>
        <UButton
          size="xs"
          variant="ghost"
          class="ml-3 shrink-0"
          @click="showJsonImport = !showJsonImport"
        >
          {{ showJsonImport ? '✕ Close' : '📋 Import JSON' }}
        </UButton>
      </div>

      <!-- JSON bulk import panel -->
      <div v-if="showJsonImport" class="mb-4 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
        <p class="text-[11px] text-zinc-400 mb-2">
          Paste a JSON object to import presets across multiple categories at once:
        </p>
        <pre class="text-[10px] text-zinc-600 mb-2 overflow-x-auto">{{ `{
  "hair": ["long black hair", "short blonde bob"],
  "eyes": ["piercing blue eyes", "warm hazel eyes"],
  "clothing": ["leather jacket", "flowing dress"]
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
            Import All
          </UButton>
        </div>
      </div>

      <!-- Merge mode toggle -->
      <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 mb-4">
        <div>
          <p class="text-xs font-medium text-zinc-300">Merge with defaults</p>
          <p class="text-[11px] text-zinc-500">When on, your presets appear alongside built-in ones. When off, only your custom presets are used.</p>
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
          <!-- Category header -->
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

          <!-- Expanded content -->
          <div v-if="expandedCategory === key" class="px-3 pb-3">
            <!-- Add new presets (one per line) -->
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

            <!-- Custom presets -->
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

            <!-- Built-in presets (reference) -->
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
