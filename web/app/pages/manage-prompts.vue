<script setup lang="ts">
/**
 * /manage-prompts — Admin page for prompt builder management.
 * CRUD for templates and attributes, generation history, and test generation.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({
  title: 'Manage Prompts',
  description: 'Admin panel for managing prompt templates, attributes, and generation history.',
})

const { user } = useAuth()

// ─── Guard: admin only ──────────────────────────────────────
const isAdmin = computed(() => user.value?.isAdmin === true)

// ─── Active Tab ─────────────────────────────────────────────
const activeTab = ref('templates')
const tabs = [
  { label: 'Templates', value: 'templates', icon: 'i-lucide-file-text' },
  { label: 'Attributes', value: 'attributes', icon: 'i-lucide-tags' },
  { label: 'History', value: 'history', icon: 'i-lucide-clock' },
]

// ─── Templates ──────────────────────────────────────────────
const templates = ref<any[]>([])
const loadingTemplates = ref(false)
const newTemplate = ref({ name: '', template: '', category: 'general' })
const editingTemplate = ref<any | null>(null)

async function fetchTemplates() {
  loadingTemplates.value = true
  try {
    const data = await $fetch<any>('/api/prompt-builder/templates')
    templates.value = data.templates
  } catch { /* ignore */ }
  loadingTemplates.value = false
}

async function createTemplate() {
  if (!newTemplate.value.name.trim() || !newTemplate.value.template.trim()) return
  try {
    await $fetch('/api/prompt-builder/templates', {
      method: 'POST',
      body: newTemplate.value,
    })
    newTemplate.value = { name: '', template: '', category: 'general' }
    await fetchTemplates()
  } catch { /* ignore */ }
}

async function updateTemplate(tpl: any) {
  try {
    await $fetch(`/api/prompt-builder/templates/${tpl.id}`, {
      method: 'PUT',
      body: { name: tpl.name, template: tpl.template, category: tpl.category, isActive: tpl.isActive },
    })
    editingTemplate.value = null
    await fetchTemplates()
  } catch { /* ignore */ }
}

async function deleteTemplate(id: string) {
  try {
    await $fetch(`/api/prompt-builder/templates/${id}`, { method: 'DELETE' })
    await fetchTemplates()
  } catch { /* ignore */ }
}

function toggleTemplateActive(tpl: any) {
  tpl.isActive = !tpl.isActive
  updateTemplate(tpl)
}

// ─── Attributes ─────────────────────────────────────────────
const attributes = ref<any[]>([])
const groupedAttributes = ref<Record<string, any[]>>({})
const loadingAttributes = ref(false)
const newAttribute = ref({ category: '', value: '', weight: 1.0 })
const bulkCategory = ref('')
const bulkValues = ref('')

async function fetchAttributes() {
  loadingAttributes.value = true
  try {
    const data = await $fetch<any>('/api/prompt-builder/attributes')
    attributes.value = data.attributes
    groupedAttributes.value = data.grouped
  } catch { /* ignore */ }
  loadingAttributes.value = false
}

async function createAttribute() {
  if (!newAttribute.value.category.trim() || !newAttribute.value.value.trim()) return
  try {
    await $fetch('/api/prompt-builder/attributes', {
      method: 'POST',
      body: newAttribute.value,
    })
    newAttribute.value = { category: newAttribute.value.category, value: '', weight: 1.0 }
    await fetchAttributes()
  } catch { /* ignore */ }
}

async function bulkCreateAttributes() {
  if (!bulkCategory.value.trim() || !bulkValues.value.trim()) return
  const values = bulkValues.value.split('\n').map(v => v.trim()).filter(Boolean)
  if (values.length === 0) return
  try {
    await $fetch('/api/prompt-builder/attributes', {
      method: 'POST',
      body: { items: values.map(v => ({ category: bulkCategory.value.trim(), value: v })) },
    })
    bulkValues.value = ''
    await fetchAttributes()
  } catch { /* ignore */ }
}

async function updateAttributeWeight(attr: any, newWeight: number) {
  try {
    await $fetch(`/api/prompt-builder/attributes/${attr.id}`, {
      method: 'PUT',
      body: { weight: newWeight },
    })
    attr.weight = newWeight
  } catch { /* ignore */ }
}

async function toggleAttributeActive(attr: any) {
  try {
    await $fetch(`/api/prompt-builder/attributes/${attr.id}`, {
      method: 'PUT',
      body: { isActive: !attr.isActive },
    })
    attr.isActive = !attr.isActive
  } catch { /* ignore */ }
}

async function deleteAttribute(id: string) {
  try {
    await $fetch(`/api/prompt-builder/attributes/${id}`, { method: 'DELETE' })
    await fetchAttributes()
  } catch { /* ignore */ }
}

// ─── History ────────────────────────────────────────────────
const history = ref<any[]>([])
const historyTotal = ref(0)
const historyOffset = ref(0)
const historyLimit = 20
const loadingHistory = ref(false)

async function fetchHistory() {
  loadingHistory.value = true
  try {
    const data = await $fetch<any>('/api/prompt-builder/history', {
      params: { limit: historyLimit, offset: historyOffset.value },
    })
    history.value = data.items
    historyTotal.value = data.total
  } catch { /* ignore */ }
  loadingHistory.value = false
}

const historyPage = computed({
  get: () => Math.floor(historyOffset.value / historyLimit) + 1,
  set: (page: number) => {
    historyOffset.value = (page - 1) * historyLimit
    fetchHistory()
  },
})

const totalHistoryPages = computed(() => Math.ceil(historyTotal.value / historyLimit))

// ─── Test Generator ─────────────────────────────────────────
const generating = ref(false)
const generatedResult = ref<any | null>(null)
const generateError = ref('')

async function testGenerate() {
  generating.value = true
  generateError.value = ''
  generatedResult.value = null
  try {
    const result = await $fetch<any>('/api/prompt-builder/generate', { method: 'POST' })
    generatedResult.value = result
  } catch (e: any) {
    generateError.value = e.data?.message || e.message || 'Generation failed'
  }
  generating.value = false
}

// ─── Init ───────────────────────────────────────────────────
onMounted(() => {
  if (isAdmin.value) {
    fetchTemplates()
    fetchAttributes()
    fetchHistory()
  }
})

// Fetch when tab changes
watch(activeTab, (tab) => {
  if (tab === 'templates') fetchTemplates()
  else if (tab === 'attributes') fetchAttributes()
  else if (tab === 'history') fetchHistory()
})

// ─── Category helpers ───────────────────────────────────────
const categoryColors: Record<string, string> = {
  adjective: 'primary',
  subject: 'success',
  setting: 'warning',
  feature: 'info',
  style: 'secondary',
  mood: 'error',
}

function getCategoryColor(cat: string): string {
  return categoryColors[cat] || 'neutral'
}
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Access denied -->
    <div v-if="!isAdmin" class="text-center py-24">
      <UIcon name="i-lucide-shield-x" class="w-16 h-16 text-red-400 mx-auto mb-4" />
      <h1 class="text-2xl font-bold text-slate-800 mb-2">Admin Access Required</h1>
      <p class="text-slate-500">This page is restricted to administrators.</p>
    </div>

    <!-- Admin panel -->
    <template v-else>
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-linear-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg">
              <UIcon name="i-lucide-wand" class="w-5 h-5 text-white" />
            </div>
            Prompt Builder
          </h1>
          <p class="text-slate-500 mt-1">Manage templates, attributes, and view generation history</p>
        </div>

        <!-- Generate Test Button -->
        <UButton
          icon="i-lucide-sparkles"
          label="Generate Test Prompt"
          color="primary"
          :loading="generating"
          @click="testGenerate"
        />
      </div>

      <!-- Generated result banner -->
      <Transition name="slide-down">
        <div
          v-if="generatedResult"
          class="mb-6 p-5 rounded-2xl bg-linear-to-br from-violet-50 to-fuchsia-50 border border-violet-200 relative"
        >
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="xs"
            class="absolute top-3 right-3"
            @click="generatedResult = null"
          />
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-sparkles" class="w-5 h-5 text-violet-500" />
            <span class="font-semibold text-violet-700">Generated Prompt</span>
            <UBadge v-if="generatedResult.templateName" color="neutral" variant="subtle" size="sm">
              {{ generatedResult.templateName }}
            </UBadge>
          </div>
          <div class="space-y-2">
            <div>
              <span class="text-xs font-medium text-slate-400 uppercase">Raw</span>
              <p class="text-sm text-slate-700 bg-white rounded-lg p-3 mt-1">{{ generatedResult.rawPrompt }}</p>
            </div>
            <div>
              <span class="text-xs font-medium text-slate-400 uppercase">Refined</span>
              <p class="text-sm text-slate-800 bg-white rounded-lg p-3 mt-1 font-medium">{{ generatedResult.refinedPrompt }}</p>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Error banner -->
      <div v-if="generateError" class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
        <UIcon name="i-lucide-alert-circle" class="w-4 h-4" />
        {{ generateError }}
        <UButton variant="ghost" color="error" size="xs" icon="i-lucide-x" @click="generateError = ''" class="ml-auto" />
      </div>

      <!-- Tabs -->
      <div class="flex gap-2 mb-6 border-b border-slate-200">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px"
          :class="activeTab === tab.value
            ? 'border-violet-500 text-violet-700'
            : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'"
          @click="activeTab = tab.value"
        >
          <UIcon :name="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Templates Tab -->
      <div v-if="activeTab === 'templates'" class="space-y-6">
        <!-- Add new template form -->
        <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <UIcon name="i-lucide-plus" class="w-4 h-4" />
            New Template
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <UInput v-model="newTemplate.name" placeholder="Template name" class="sm:col-span-1" />
            <UInput v-model="newTemplate.category" placeholder="Category" class="sm:col-span-1" />
            <UInput v-model="newTemplate.template" placeholder="A [adjective] [subject] in [setting]" class="sm:col-span-2" />
          </div>
          <div class="flex items-center justify-between mt-3">
            <p class="text-xs text-slate-400">Use [slotName] for attribute placeholders</p>
            <UButton label="Add Template" icon="i-lucide-plus" size="sm" @click="createTemplate" />
          </div>
        </div>

        <!-- Templates list -->
        <div v-if="loadingTemplates" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="w-6 h-6 text-violet-500 animate-spin" />
        </div>
        <div v-else-if="templates.length === 0" class="text-center py-12 text-slate-400">
          <UIcon name="i-lucide-file-x" class="w-10 h-10 mx-auto mb-2" />
          <p>No templates yet. Create your first one above.</p>
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="tpl in templates"
            :key="tpl.id"
            class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <div v-if="editingTemplate?.id === tpl.id" class="space-y-3">
              <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <UInput v-model="editingTemplate.name" placeholder="Name" />
                <UInput v-model="editingTemplate.category" placeholder="Category" />
                <UInput v-model="editingTemplate.template" placeholder="Template" class="sm:col-span-2" />
              </div>
              <div class="flex gap-2 justify-end">
                <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="editingTemplate = null" />
                <UButton label="Save" icon="i-lucide-check" size="sm" @click="updateTemplate(editingTemplate)" />
              </div>
            </div>
            <div v-else class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-semibold text-slate-800">{{ tpl.name }}</span>
                  <UBadge :color="tpl.isActive ? 'success' : 'neutral'" variant="subtle" size="xs">
                    {{ tpl.isActive ? 'Active' : 'Inactive' }}
                  </UBadge>
                  <UBadge color="neutral" variant="outline" size="xs">{{ tpl.category }}</UBadge>
                </div>
                <p class="text-sm text-slate-600 font-mono truncate">{{ tpl.template }}</p>
              </div>
              <div class="flex gap-1 shrink-0">
                <UButton
                  :icon="tpl.isActive ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="toggleTemplateActive(tpl)"
                />
                <UButton
                  icon="i-lucide-pencil"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="editingTemplate = { ...tpl }"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="deleteTemplate(tpl.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Attributes Tab -->
      <div v-if="activeTab === 'attributes'" class="space-y-6">
        <!-- Add single attribute -->
        <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <UIcon name="i-lucide-plus" class="w-4 h-4" />
            Add Attribute
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <UInput v-model="newAttribute.category" placeholder="Category (e.g. adjective)" />
            <UInput v-model="newAttribute.value" placeholder="Value (e.g. ethereal)" class="sm:col-span-2" />
            <div class="flex items-center gap-2">
              <label class="text-xs text-slate-500 shrink-0">Weight:</label>
              <UInput v-model.number="newAttribute.weight" type="number" step="0.1" min="0.1" max="10" class="flex-1" />
            </div>
          </div>
          <div class="flex justify-end mt-3">
            <UButton label="Add" icon="i-lucide-plus" size="sm" @click="createAttribute" />
          </div>
        </div>

        <!-- Bulk add -->
        <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <UIcon name="i-lucide-list-plus" class="w-4 h-4" />
            Bulk Add Attributes
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UInput v-model="bulkCategory" placeholder="Category for all" />
            <UTextarea
              v-model="bulkValues"
              placeholder="One value per line..."
              :rows="4"
              class="sm:col-span-2"
            />
          </div>
          <div class="flex justify-end mt-3">
            <UButton label="Bulk Add" icon="i-lucide-list-plus" size="sm" @click="bulkCreateAttributes" />
          </div>
        </div>

        <!-- Attributes grouped by category -->
        <div v-if="loadingAttributes" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="w-6 h-6 text-violet-500 animate-spin" />
        </div>
        <div v-else-if="Object.keys(groupedAttributes).length === 0" class="text-center py-12 text-slate-400">
          <UIcon name="i-lucide-tags" class="w-10 h-10 mx-auto mb-2" />
          <p>No attributes yet. Add some above.</p>
        </div>
        <div v-else class="space-y-4">
          <div v-for="(attrs, category) in groupedAttributes" :key="category" class="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UBadge :color="getCategoryColor(String(category))" variant="subtle" size="sm">{{ category }}</UBadge>
                <span class="text-xs text-slate-400">{{ attrs.length }} attributes</span>
              </div>
            </div>
            <div class="divide-y divide-slate-100">
              <div
                v-for="attr in attrs"
                :key="attr.id"
                class="px-5 py-3 flex items-center gap-4 hover:bg-slate-50 transition-colors"
              >
                <span class="flex-1 text-sm text-slate-700">{{ attr.value }}</span>
                <div class="flex items-center gap-2 shrink-0">
                  <label class="text-xs text-slate-400">Wt:</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="10"
                    :value="attr.weight"
                    class="w-16 text-sm text-center rounded-lg border border-slate-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    @change="(e: Event) => updateAttributeWeight(attr, Number((e.target as HTMLInputElement).value))"
                  />
                  <UButton
                    :icon="attr.isActive ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                    :variant="attr.isActive ? 'ghost' : 'soft'"
                    :color="attr.isActive ? 'success' : 'neutral'"
                    size="xs"
                    @click="toggleAttributeActive(attr)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    variant="ghost"
                    color="error"
                    size="xs"
                    @click="deleteAttribute(attr.id)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- History Tab -->
      <div v-if="activeTab === 'history'" class="space-y-4">
        <div v-if="loadingHistory" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="w-6 h-6 text-violet-500 animate-spin" />
        </div>
        <div v-else-if="history.length === 0" class="text-center py-12 text-slate-400">
          <UIcon name="i-lucide-clock" class="w-10 h-10 mx-auto mb-2" />
          <p>No generations yet. Use the "Generate Test Prompt" button to create some.</p>
        </div>
        <template v-else>
          <div
            v-for="entry in history"
            :key="entry.id"
            class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm"
          >
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs text-slate-400">{{ new Date(entry.createdAt).toLocaleString() }}</span>
              <UBadge v-if="entry.templateName" color="neutral" variant="outline" size="xs">
                {{ entry.templateName }}
              </UBadge>
            </div>
            <div class="space-y-1">
              <div>
                <span class="text-xs font-medium text-slate-400">RAW</span>
                <p class="text-sm text-slate-600">{{ entry.rawPrompt }}</p>
              </div>
              <div v-if="entry.refinedPrompt">
                <span class="text-xs font-medium text-violet-400">REFINED</span>
                <p class="text-sm text-slate-800 font-medium">{{ entry.refinedPrompt }}</p>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div v-if="totalHistoryPages > 1" class="flex justify-center pt-4">
            <UPagination v-model="historyPage" :total="historyTotal" :items-per-page="historyLimit" />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
