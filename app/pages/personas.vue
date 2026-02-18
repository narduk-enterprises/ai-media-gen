<script setup lang="ts">
import {
  attributeLabels,
  attributePresets,
  sceneAttributeKeys,
  characterAttributeKeys,
  pickRandom,
  buildPersonaPrompt,
  type AttributeKey,
  type SceneAttributeKey,
  type CharacterAttributeKey,
} from '~/utils/promptBuilder'

definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Personas' })

// ─── Presets (project-aware) ─────────────────────────────────────────────
const { getPresets, config: presetConfig, projects, activeProject, switchProject } = usePromptPresets()

// ─── Persons ─────────────────────────────────────────────────────────────
const {
  persons,
  addPerson,
  getPerson,
  deletePerson,
  renamePerson,
  updatePerson,
  duplicatePerson,
} = usePersons()

// ─── Selection & Mode ────────────────────────────────────────────────────
const selectedPersonId = ref<string | null>(null)
const isCreating = ref(false)
const justSaved = ref(false)

const selectedPerson = computed(() =>
  persons.value.find((p: any) => p.id === selectedPersonId.value) ?? null
)

// ─── Person Form ─────────────────────────────────────────────────────────
const personForm = reactive<Record<string, string>>({
  name: '',
  description: '',
  hair: '',
  eyes: '',
  bodyType: '',
  skinTone: '',
  clothing: '',
})

function populateForm(person: any) {
  personForm.name = person.name
  personForm.description = person.description || ''
  personForm.hair = person.hair
  personForm.eyes = person.eyes
  personForm.bodyType = person.bodyType
  personForm.skinTone = person.skinTone
  personForm.clothing = person.clothing
}

function resetForm() {
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
  if (person) populateForm(person)
}

function startCreate() {
  selectedPersonId.value = null
  isCreating.value = true
  resetForm()
}

function cancelCreate() {
  isCreating.value = false
  if (persons.value.length > 0) {
    selectPerson(persons.value[0].id)
  }
}

const hasUnsavedChanges = computed(() => {
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

const canSave = computed(() => {
  if (isCreating.value) return personForm.name.trim() !== ''
  return hasUnsavedChanges.value && personForm.name.trim() !== ''
})

function savePerson() {
  if (!canSave.value) return

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

function handleDelete() {
  if (!selectedPersonId.value) return
  if (!confirm(`Delete "${selectedPerson.value?.name}"? This cannot be undone.`)) return
  deletePerson(selectedPersonId.value)
  selectedPersonId.value = null
}

function handleDuplicate() {
  if (!selectedPersonId.value) return
  const copy = duplicatePerson(selectedPersonId.value)
  if (copy) {
    selectedPersonId.value = copy.id
    populateForm(copy)
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

// ─── Scene Form ──────────────────────────────────────────────────────────
const sceneForm = reactive<Record<string, string>>({
  scene: '',
  pose: '',
  style: '',
  lighting: '',
  mood: '',
  camera: '',
})

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

// ─── Prompt Preview ──────────────────────────────────────────────────────
const basePrompt = ref('')

const promptPreview = computed(() => {
  if (!selectedPerson.value) return ''
  const person = selectedPerson.value as any

  const personAttrs: Record<string, string> = {}
  for (const key of characterAttributeKeys) {
    if (person[key]) personAttrs[key] = person[key]
  }

  const sceneAttrs: Record<string, string> = {}
  for (const key of sceneAttributeKeys) {
    if (sceneForm[key]) sceneAttrs[key] = sceneForm[key]
  }

  const base = basePrompt.value.trim() || (presetConfig.value.basePrompts.length > 0 ? '[random base prompt]' : '')
  return buildPersonaPrompt(base, personAttrs, sceneAttrs, person.description)
})

const emptySceneFields = computed(() =>
  sceneAttributeKeys.filter(k => !sceneForm[k]).map(k => attributeLabels[k].label.toLowerCase())
)

// ─── Generation Settings ─────────────────────────────────────────────────
const negativePrompt = computed(() =>
  presetConfig.value.negativePrompt || 'ugly, deformed, noisy, blurry, distorted, grainy, low quality, low resolution, watermark, text, signature, out of frame, poorly drawn, bad anatomy, extra limbs, mutation, disfigured, duplicate, cropped, username, error, jpeg artifacts'
)
const imageWidth = ref(1024)
const imageHeight = ref(1024)
const steps = ref(20)

const sizeOptions = [
  { label: '512', value: 512 },
  { label: '768', value: 768 },
  { label: '1024', value: 1024 },
  { label: '1536', value: 1536 },
]

// ─── Generation ──────────────────────────────────────────────────────────

interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
}

interface GenerationResult {
  generation: {
    id: string
    prompt: string
    imageCount: number
    status: string
    createdAt: string
  }
  items: MediaItemResult[]
}

const generating = ref(false)
const error = ref('')
const allImages = ref<(MediaItemResult & { prompt?: string; personName?: string })[]>([])
const activeGenerationIds = ref<string[]>([])
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const generationProgress = ref({ done: 0, total: 0 })

function buildPromptForImage(): { prompt: string; personName: string } {
  const person = selectedPerson.value as any

  const personAttrs: Record<string, string> = {}
  for (const key of characterAttributeKeys) {
    if (person[key]) personAttrs[key] = person[key]
  }

  const sceneAttrs: Record<string, string> = {}
  for (const key of sceneAttributeKeys) {
    if (sceneForm[key]) {
      sceneAttrs[key] = sceneForm[key]
    } else {
      const pool = getPresets(key as AttributeKey)
      if (pool.length > 0) sceneAttrs[key] = pickRandom(pool)
    }
  }

  let base = basePrompt.value.trim()
  if (!base && presetConfig.value.basePrompts.length > 0) {
    base = pickRandom(presetConfig.value.basePrompts)
  }

  const prompt = buildPersonaPrompt(base, personAttrs, sceneAttrs, person.description)
  return { prompt, personName: person.name }
}

async function generate(count: number) {
  if (!selectedPerson.value) return
  generating.value = true
  error.value = ''
  allImages.value = []
  activeGenerationIds.value = []
  stopPolling()
  generationProgress.value = { done: 0, total: count }

  for (let i = 0; i < count; i++) {
    const { prompt, personName } = buildPromptForImage()

    try {
      const result = await $fetch<GenerationResult>('/api/generate/image', {
        method: 'POST',
        body: {
          prompt,
          negativePrompt: negativePrompt.value,
          count: 1,
          steps: steps.value,
          width: imageWidth.value,
          height: imageHeight.value,
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      const newImages = result.items
        .filter(item => item.type === 'image')
        .map(item => ({ ...item, prompt, personName }))
      allImages.value = [...allImages.value, ...newImages]
      activeGenerationIds.value.push(result.generation.id)
      generationProgress.value.done++
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Generation failed'
    }
  }

  if (activeGenerationIds.value.length > 0) {
    startPolling()
  } else {
    generating.value = false
  }
}

function startPolling() {
  stopPolling()
  pollingTimer.value = setInterval(async () => {
    let allDone = true
    for (const genId of activeGenerationIds.value) {
      try {
        const result = await $fetch<GenerationResult>('/api/generate/generation-status', {
          params: { id: genId },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })

        for (const updated of result.items) {
          const idx = allImages.value.findIndex(item => item.id === updated.id)
          if (idx >= 0) {
            allImages.value[idx] = { ...allImages.value[idx], ...updated }
          }
        }

        const genItems = result.items.filter(item => item.type === 'image')
        if (!genItems.every(item => item.status === 'complete' || item.status === 'failed')) {
          allDone = false
        }
      } catch { allDone = false }
    }

    if (allDone) {
      stopPolling()
      generating.value = false
    }
  }, 3000)
}

function stopPolling() {
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }
}

onUnmounted(() => stopPolling())

// ─── Lightbox ────────────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxImage = ref<{ url: string; prompt: string; personName: string } | null>(null)

function openLightbox(img: (typeof allImages.value)[number]) {
  if (img.status !== 'complete' || !img.url) return
  lightboxImage.value = { url: img.url, prompt: img.prompt || '', personName: img.personName || '' }
  lightboxOpen.value = true
}
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

    <!-- ═══ Page Header ═══ -->
    <div class="mb-6">
      <h1 class="text-2xl font-display font-bold text-slate-800 tracking-tight">
        Personas
      </h1>
      <p class="text-sm text-slate-500 mt-1">
        Define your characters, set up a scene, and generate images.
      </p>
    </div>

    <!-- ═══ Persona Cards ═══ -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-slate-700">My Personas</h2>
        <button
          class="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
          @click="startCreate"
        >
          + New Persona
        </button>
      </div>

      <!-- Empty state: no personas at all -->
      <div v-if="persons.length === 0 && !isCreating" class="glass-card p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-violet-500">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h3 class="text-sm font-semibold text-slate-700 mb-1">No personas yet</h3>
        <p class="text-xs text-slate-400 mb-5 max-w-md mx-auto">
          A persona defines a character's appearance — hair, eyes, body type, skin tone, and outfit.
          Once created, you can generate images of them in any scene or style.
        </p>
        <button
          class="px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors active:scale-[0.98]"
          @click="startCreate"
        >
          Create Your First Persona
        </button>
      </div>

      <!-- Persona cards row -->
      <div v-else class="flex gap-3 overflow-x-auto pb-2">
        <button
          v-for="person in persons"
          :key="person.id"
          class="shrink-0 w-52 p-3 rounded-xl border text-left transition-all"
          :class="selectedPersonId === person.id && !isCreating
            ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70 shadow-sm'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
          @click="selectPerson(person.id)"
        >
          <div class="flex items-center gap-2.5 mb-1.5">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              :class="selectedPersonId === person.id && !isCreating
                ? 'bg-violet-200 text-violet-700'
                : 'bg-slate-100 text-slate-500'"
            >
              {{ person.name.charAt(0).toUpperCase() }}
            </div>
            <span class="font-medium text-sm text-slate-700 truncate">{{ person.name }}</span>
          </div>
          <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">
            {{ personSummary(person) }}
          </p>
        </button>

        <!-- New persona card -->
        <button
          class="shrink-0 w-44 p-3 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1"
          :class="isCreating
            ? 'border-violet-300 bg-violet-50/50'
            : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'"
          @click="startCreate"
        >
          <span class="text-2xl text-slate-300">+</span>
          <span class="text-[11px] text-slate-400 font-medium">New Persona</span>
        </button>
      </div>
    </div>

    <!-- ═══ Creating: centered form ═══ -->
    <div v-if="isCreating" class="max-w-xl mx-auto mb-6">
      <div class="glass-card p-5">
        <h2 class="text-sm font-semibold text-slate-700 mb-4">New Persona</h2>

        <div class="space-y-3">
          <div>
            <label class="text-[11px] text-slate-500 font-medium mb-1 block">Name</label>
            <input
              v-model="personForm.name"
              type="text"
              placeholder="e.g. Cyber Girl, Forest Elf, Commander Reyes..."
              class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label class="text-[11px] text-slate-500 font-medium mb-1 block">Description</label>
            <textarea
              v-model="personForm.description"
              placeholder="Describe this person: age, gender, distinguishing features..."
              rows="2"
              class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
            />
            <p class="text-[9px] text-slate-400 mt-0.5">
              e.g. "25 year old Japanese woman with a warm smile and dimples"
            </p>
          </div>

          <div class="border-t border-slate-100 pt-2">
            <span class="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Appearance</span>
          </div>

          <div v-for="key in characterAttributeKeys" :key="key">
            <label class="text-[11px] text-slate-500 font-medium flex items-center gap-1 mb-1">
              <span>{{ attributeLabels[key].emoji }}</span>
              <span>{{ attributeLabels[key].label }}</span>
            </label>
            <div class="flex gap-1.5">
              <input
                v-model="personForm[key]"
                type="text"
                :placeholder="attributePresets[key][0]"
                class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              />
              <button
                class="w-8 h-8 rounded-lg border border-slate-200 text-sm hover:bg-slate-50 hover:border-slate-300 transition-colors flex items-center justify-center shrink-0"
                title="Randomize"
                @click="randomizePersonField(key as CharacterAttributeKey)"
              >
                🎲
              </button>
            </div>
          </div>
        </div>

        <div class="flex gap-2 mt-5 pt-4 border-t border-slate-100">
          <button
            class="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            :class="canSave
              ? 'bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98]'
              : 'bg-slate-100 text-slate-300 cursor-not-allowed'"
            :disabled="!canSave"
            @click="savePerson"
          >
            Create Persona
          </button>
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
            @click="cancelCreate"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- ═══ Selected Persona: Profile + Scene + Generate ═══ -->
    <div v-if="selectedPerson && !isCreating" class="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">

      <!-- Left: Persona Profile -->
      <div class="lg:col-span-2">
        <div class="glass-card p-5 lg:sticky lg:top-24">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-semibold text-slate-700">Persona Profile</h2>
            <div class="flex items-center gap-1">
              <span v-if="justSaved" class="text-xs text-emerald-500 font-medium mr-1 animate-pulse">Saved!</span>
              <button
                class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex items-center justify-center text-sm"
                title="Duplicate persona"
                @click="handleDuplicate"
              >
                📋
              </button>
              <button
                class="w-7 h-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center text-sm"
                title="Delete persona"
                @click="handleDelete"
              >
                🗑️
              </button>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <label class="text-[11px] text-slate-500 font-medium mb-1 block">Name</label>
              <input
                v-model="personForm.name"
                type="text"
                placeholder="Character name"
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              />
            </div>

            <div>
              <label class="text-[11px] text-slate-500 font-medium mb-1 block">Description</label>
              <textarea
                v-model="personForm.description"
                placeholder="Age, gender, distinguishing features..."
                rows="2"
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
              />
            </div>

            <div class="border-t border-slate-100 pt-2">
              <span class="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Appearance</span>
            </div>

            <div v-for="key in characterAttributeKeys" :key="key">
              <label class="text-[11px] text-slate-500 font-medium flex items-center gap-1 mb-1">
                <span>{{ attributeLabels[key].emoji }}</span>
                <span>{{ attributeLabels[key].label }}</span>
              </label>
              <div class="flex gap-1.5">
                <input
                  v-model="personForm[key]"
                  type="text"
                  :placeholder="attributePresets[key][0]"
                  class="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
                <button
                  class="w-8 h-8 rounded-lg border border-slate-200 text-sm hover:bg-slate-50 hover:border-slate-300 transition-colors flex items-center justify-center shrink-0"
                  title="Randomize"
                  @click="randomizePersonField(key as CharacterAttributeKey)"
                >
                  🎲
                </button>
              </div>
            </div>
          </div>

          <div class="mt-5 pt-4 border-t border-slate-100">
            <button
              class="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all"
              :class="canSave
                ? 'bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98]'
                : 'bg-slate-100 text-slate-300 cursor-not-allowed'"
              :disabled="!canSave"
              @click="savePerson"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Scene Setup + Generate -->
      <div class="lg:col-span-3 space-y-4">

        <!-- Scene Setup -->
        <div class="glass-card p-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold text-slate-700">Scene Setup</h2>
            <div class="flex items-center gap-2">
              <select
                v-if="projects.length > 1"
                :value="activeProject?.id"
                class="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] text-slate-500 focus:outline-none"
                @change="switchProject(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <button
                class="text-[10px] text-violet-500 hover:text-violet-600 font-medium transition-colors"
                @click="randomizeAllScene"
              >
                Randomize All
              </button>
              <button
                class="text-[10px] text-slate-400 hover:text-slate-600 font-medium transition-colors"
                @click="clearAllScene"
              >
                Clear
              </button>
            </div>
          </div>

          <p class="text-[10px] text-slate-400 mb-3">
            Set specific values or leave empty — empty fields get randomized for each image.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
            <div v-for="key in sceneAttributeKeys" :key="key">
              <label class="text-[11px] text-slate-500 font-medium flex items-center gap-1 mb-1">
                <span>{{ attributeLabels[key].emoji }}</span>
                <span>{{ attributeLabels[key].label }}</span>
                <span v-if="!sceneForm[key]" class="text-[9px] text-slate-300 font-normal ml-0.5">(random)</span>
              </label>
              <div class="flex gap-1.5">
                <input
                  v-model="sceneForm[key]"
                  type="text"
                  :placeholder="attributePresets[key][0]"
                  class="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
                <button
                  class="w-7 h-7 rounded-lg border border-slate-200 text-xs hover:bg-slate-50 hover:border-slate-300 transition-colors flex items-center justify-center shrink-0"
                  title="Randomize"
                  @click="randomizeSceneField(key as SceneAttributeKey)"
                >
                  🎲
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Prompt Preview -->
        <div v-if="promptPreview" class="glass-card p-4">
          <div class="flex items-center justify-between mb-1.5">
            <h3 class="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Prompt Preview</h3>
            <span v-if="emptySceneFields.length > 0" class="text-[9px] text-slate-300">
              + random: {{ emptySceneFields.join(', ') }}
            </span>
          </div>
          <p class="text-xs text-slate-600 leading-relaxed wrap-break-word">
            {{ promptPreview }}
          </p>
        </div>

        <!-- Generate -->
        <div class="glass-card p-5">
          <h2 class="text-sm font-semibold text-slate-700 mb-3">Generate Images</h2>

          <!-- Base prompt -->
          <div class="mb-3">
            <label class="text-[11px] text-slate-500 font-medium mb-1 block">Base Prompt (optional)</label>
            <div v-if="presetConfig.basePrompts.length > 0" class="flex flex-wrap gap-1.5 mb-2">
              <button
                v-for="bp in presetConfig.basePrompts"
                :key="bp"
                class="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border"
                :class="basePrompt === bp
                  ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                  : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'"
                @click="basePrompt = basePrompt === bp ? '' : bp"
              >
                {{ bp.length > 40 ? bp.slice(0, 40) + '…' : bp }}
              </button>
            </div>
            <textarea
              v-model="basePrompt"
              placeholder="Leave empty to use a random base prompt from your project"
              rows="1"
              class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
            />
          </div>

          <!-- Image settings -->
          <div class="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label class="text-[10px] text-slate-500 font-medium mb-1 block">Width</label>
              <select
                v-model="imageWidth"
                class="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option v-for="s in sizeOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[10px] text-slate-500 font-medium mb-1 block">Height</label>
              <select
                v-model="imageHeight"
                class="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option v-for="s in sizeOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[10px] text-slate-500 font-medium mb-1 block">Steps</label>
              <select
                v-model="steps"
                class="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="30">30</option>
                <option :value="40">40</option>
                <option :value="50">50</option>
              </select>
            </div>
          </div>

          <!-- Generate buttons -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="count in [1, 4, 8, 16]"
              :key="count"
              class="px-3 py-2.5 rounded-lg text-sm font-medium transition-all border"
              :class="generating
                ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                : 'bg-white border-slate-200 text-slate-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 active:scale-[0.98]'"
              :disabled="generating"
              @click="generate(count)"
            >
              {{ count }} {{ count === 1 ? 'image' : 'images' }}
            </button>
          </div>

          <!-- Progress -->
          <div v-if="generating" class="mt-3 flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
            <span class="text-xs text-slate-500">
              Queued {{ generationProgress.done }}/{{ generationProgress.total }}…
            </span>
          </div>

          <p v-if="error" class="text-[11px] text-red-500 mt-2">{{ error }}</p>
        </div>
      </div>
    </div>

    <!-- ═══ Hint: nothing selected ═══ -->
    <div
      v-if="!selectedPerson && !isCreating && persons.length > 0"
      class="glass-card p-10 text-center mb-6"
    >
      <p class="text-sm text-slate-400">
        Select a persona above to set up a scene and generate images.
      </p>
    </div>

    <!-- ═══ Results Grid ═══ -->
    <div v-if="allImages.length > 0" class="mt-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-slate-700">
          Results
          <span class="text-slate-400 font-normal">
            ({{ allImages.filter(i => i.status === 'complete').length }}/{{ allImages.length }})
          </span>
        </h2>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <div
          v-for="img in allImages"
          :key="img.id"
          class="relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 group cursor-pointer"
          @click="openLightbox(img)"
        >
          <!-- Loading -->
          <div
            v-if="img.status !== 'complete' && img.status !== 'failed'"
            class="absolute inset-0 flex items-center justify-center"
          >
            <div class="flex flex-col items-center gap-2">
              <div class="w-6 h-6 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
              <span class="text-[9px] text-slate-400">Generating…</span>
            </div>
          </div>

          <!-- Failed -->
          <div
            v-else-if="img.status === 'failed'"
            class="absolute inset-0 flex items-center justify-center bg-red-50"
          >
            <span class="text-[10px] text-red-400">Failed</span>
          </div>

          <!-- Image -->
          <img
            v-else-if="img.url"
            :src="img.url"
            :alt="img.prompt || ''"
            class="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />

          <!-- Person name label -->
          <div
            v-if="img.personName"
            class="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/60 to-transparent p-2 pt-6"
          >
            <span class="text-[9px] text-white font-medium">{{ img.personName }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Lightbox ═══ -->
    <UModal v-model:open="lightboxOpen">
      <template #content>
        <div v-if="lightboxImage" class="flex flex-col">
          <div class="flex items-center justify-between p-4 border-b border-slate-200">
            <div class="flex items-center gap-2 flex-1 mr-4">
              <span class="text-amber-600 font-medium text-sm">{{ lightboxImage.personName }}</span>
              <p class="text-sm text-slate-500 line-clamp-1">{{ lightboxImage.prompt }}</p>
            </div>
            <UButton variant="ghost" color="neutral" icon="i-heroicons-x-mark" size="sm" @click="lightboxOpen = false" />
          </div>
          <div class="p-4 flex items-center justify-center">
            <img :src="lightboxImage.url" :alt="lightboxImage.prompt" class="max-h-[75vh] w-auto rounded-lg object-contain" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
