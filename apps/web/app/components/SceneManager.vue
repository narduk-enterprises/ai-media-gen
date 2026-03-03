<script setup lang="ts">
import {
  attributeLabels,
  attributePresets,
  sceneAttributeKeys,
  pickRandom,
  type AttributeKey,
  type SceneAttributeKey,
} from '~/utils/promptBuilder'
import type { Scene } from '~/composables/useScenes'

const { getPresets } = usePromptPresets()

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

// ─── Selection & form ────────────────────────────────────────
const selectedSceneId = ref<string | null>(null)
const isCreatingScene = ref(false)
const justSavedScene = ref(false)

const selectedScene = computed(() =>
  selectedSceneId.value ? getScene(selectedSceneId.value) ?? null : null
)

interface SceneFormData {
  name: string; scene: string; pose: string; style: string
  lighting: string; mood: string; camera: string; [key: string]: string
}

const sceneForm = reactive<SceneFormData>({
  name: '', scene: '', pose: '', style: '', lighting: '', mood: '', camera: '',
})

function populateSceneForm(scene: Scene) {
  sceneForm.name = scene.name; sceneForm.scene = scene.scene; sceneForm.pose = scene.pose
  sceneForm.style = scene.style; sceneForm.lighting = scene.lighting; sceneForm.mood = scene.mood; sceneForm.camera = scene.camera
}

function resetSceneForm() {
  sceneForm.name = ''; sceneForm.scene = ''; sceneForm.pose = ''
  sceneForm.style = ''; sceneForm.lighting = ''; sceneForm.mood = ''; sceneForm.camera = ''
}

function selectScene(id: string) {
  selectedSceneId.value = id; isCreatingScene.value = false
  const scene = getScene(id)
  if (scene) populateSceneForm(scene)
}

function startCreateScene() { selectedSceneId.value = null; isCreatingScene.value = true; resetSceneForm() }

function cancelCreateScene() {
  isCreatingScene.value = false
  if (scenes.value.length > 0) selectScene(scenes.value[0]!.id)
}

const hasUnsavedSceneChanges = computed(() => {
  if (isCreatingScene.value) return true
  if (!selectedScene.value) return false
  const s = selectedScene.value
  return sceneForm.name !== s.name || sceneForm.scene !== s.scene || sceneForm.pose !== s.pose ||
    sceneForm.style !== s.style || sceneForm.lighting !== s.lighting || sceneForm.mood !== s.mood || sceneForm.camera !== s.camera
})

const canSaveScene = computed(() => {
  if (isCreatingScene.value) return sceneForm.name.trim() !== ''
  return hasUnsavedSceneChanges.value && sceneForm.name.trim() !== ''
})

function saveScene() {
  if (!canSaveScene.value) return
  if (isCreatingScene.value) {
    const scene = addScene(sceneForm.name, {
      scene: sceneForm.scene, pose: sceneForm.pose, style: sceneForm.style,
      lighting: sceneForm.lighting, mood: sceneForm.mood, camera: sceneForm.camera,
    })
    selectedSceneId.value = scene.id; isCreatingScene.value = false
  } else if (selectedSceneId.value) {
    renameScene(selectedSceneId.value, sceneForm.name)
    updateScene(selectedSceneId.value, {
      scene: sceneForm.scene, pose: sceneForm.pose, style: sceneForm.style,
      lighting: sceneForm.lighting, mood: sceneForm.mood, camera: sceneForm.camera,
    })
  }
  justSavedScene.value = true
  setTimeout(() => { justSavedScene.value = false }, 2000)
}

function deleteSceneAction() {
  if (!selectedSceneId.value) return
  if (!confirm(`Delete "${selectedScene.value?.name}"? This cannot be undone.`)) return
  deleteScene(selectedSceneId.value); selectedSceneId.value = null
}

function duplicateSceneAction() {
  if (!selectedSceneId.value) return
  const copy = duplicateScene(selectedSceneId.value)
  if (copy) { selectedSceneId.value = copy.id; populateSceneForm(copy) }
}

function randomizeSceneField(key: SceneAttributeKey) {
  const pool = getPresets(key as AttributeKey)
  sceneForm[key] = pool.length > 0 ? pickRandom(pool) : pickRandom(attributePresets[key])
}

function randomizeAllScene() { for (const key of sceneAttributeKeys) randomizeSceneField(key) }
function clearAllScene() { for (const key of sceneAttributeKeys) sceneForm[key] = '' }

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

// ─── Import/Export ───────────────────────────────────────────
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
    if (created.length === 0) { sceneImportError.value = 'No valid scenes found in the JSON'; return }
    sceneImportText.value = ''; showSceneImport.value = false
    selectScene(created[0]!.id)
  } catch { sceneImportError.value = 'Invalid JSON — expected an object or array of objects with name and scene fields' }
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
  <section>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-slate-700">My Scenes</h2>
      <div class="flex items-center gap-3">
        <button
class="text-xs font-medium transition-colors" :class="showSceneImport ? 'text-cyan-600' : 'text-slate-400 hover:text-slate-600'"
          @click="showSceneImport = !showSceneImport; sceneImportError = ''">Import JSON</button>
        <button class="text-xs font-medium text-cyan-600 hover:text-cyan-700 transition-colors" @click="startCreateScene">+ New Scene</button>
      </div>
    </div>

    <div v-if="showSceneImport" class="mb-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
      <p class="text-[11px] text-slate-500 mb-2">Paste JSON to import one or more scenes:</p>
      <pre class="text-[9px] text-slate-400 mb-2 overflow-x-auto bg-white rounded-lg p-2 border border-slate-100">{{ '{ "name": "Neon City Night", "scene": "neon-lit rainy alleyway", "camera": "close-up portrait", "style": "cinematic" }' }}</pre>
      <UTextarea v-model="sceneImportText" :rows="3" placeholder="Paste a single object or an array of objects..." class="font-mono" />
      <UAlert v-if="sceneImportError" color="error" variant="subtle" :title="sceneImportError" size="sm" class="mt-2" />
      <div class="flex gap-2 mt-2">
        <UButton color="primary" size="sm" :disabled="!sceneImportText.trim()" @click="handleSceneImport">Import</UButton>
        <UButton variant="outline" color="neutral" size="sm" @click="showSceneImport = false">Cancel</UButton>
      </div>
    </div>

    <div v-if="scenes.length === 0 && !isCreatingScene" class="glass-card p-10 text-center">
      <div class="w-14 h-14 rounded-2xl bg-cyan-100 flex items-center justify-center mx-auto mb-4">
        <span class="text-2xl">{{ attributeLabels.scene.emoji }}</span>
      </div>
      <h3 class="text-sm font-semibold text-slate-700 mb-1">No scenes yet</h3>
      <p class="text-xs text-slate-400 mb-5 max-w-md mx-auto">A scene bundles location, pose, style, lighting, mood, and camera. Create scenes and combine them with personas on the Create page.</p>
      <button class="px-5 py-2.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors active:scale-[0.98]" @click="startCreateScene">Create Your First Scene</button>
    </div>

    <div v-else class="overflow-x-auto pb-2">
      <div class="inline-flex gap-3">
        <button
v-for="scene in scenes" :key="scene.id" class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
          :class="selectedSceneId === scene.id && !isCreatingScene ? 'ring-2 ring-cyan-400 border-cyan-200 bg-cyan-50/70 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
          @click="selectScene(scene.id)">
          <div class="flex items-center gap-2.5 mb-1.5">
            <div
class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
              :class="selectedSceneId === scene.id && !isCreatingScene ? 'bg-cyan-200 text-cyan-700' : 'bg-slate-100 text-slate-500'">{{ attributeLabels.scene.emoji }}</div>
            <span class="font-medium text-sm text-slate-700 truncate">{{ scene.name }}</span>
          </div>
          <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ sceneSummary(scene) }}</p>
        </button>
        <button
class="shrink-0 w-40 p-3 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1"
          :class="isCreatingScene ? 'border-cyan-300 bg-cyan-50/50' : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'"
          @click="startCreateScene">
          <span class="text-2xl text-slate-300">+</span>
          <span class="text-[11px] text-slate-400 font-medium">New Scene</span>
        </button>
      </div>
    </div>

    <!-- Scene form -->
    <div v-if="isCreatingScene || selectedScene" class="mt-6 max-w-2xl">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-700">{{ isCreatingScene ? 'New Scene' : 'Scene' }}</h2>
            <div class="flex items-center gap-2">
              <span v-if="justSavedScene" class="text-xs text-emerald-500 font-medium animate-pulse">Saved!</span>
              <span v-if="copiedScene" class="text-xs text-emerald-500 font-medium animate-pulse">Copied!</span>
              <UButton v-if="!isCreatingScene" variant="link" color="neutral" size="xs" @click="handleExportScene">Export</UButton>
              <UButton variant="link" color="primary" size="xs" @click="randomizeAllScene">Randomize All</UButton>
              <UButton variant="link" color="neutral" size="xs" @click="clearAllScene">Clear</UButton>
              <template v-if="!isCreatingScene">
                <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-copy" title="Duplicate" @click="duplicateSceneAction" />
                <UButton variant="ghost" color="error" size="xs" icon="i-lucide-trash-2" title="Delete" @click="deleteSceneAction" />
              </template>
            </div>
          </div>
        </template>
        <div v-if="isCreatingScene" class="mb-3 p-3 rounded-lg bg-cyan-50/60 border border-cyan-100 text-xs text-slate-600 space-y-1.5">
          <p class="font-medium text-cyan-700">Writing a good scene</p>
          <ul class="space-y-1 text-[11px] text-slate-500 list-disc pl-4">
            <li><strong>Scene</strong> is the location/setting. Be vivid: <em>"neon-lit rainy alleyway at midnight"</em></li>
            <li><strong>Pose</strong> describes what the subject is doing: <em>"leaning against a wall, arms crossed"</em></li>
            <li><strong>Style</strong> controls the artistic look: <em>"cinematic"</em>, <em>"anime"</em>, <em>"photorealistic"</em></li>
            <li><strong>Lighting</strong> sets the atmosphere: <em>"golden hour warmth"</em>, <em>"neon glow"</em></li>
            <li>Leave any field blank and it will be filled randomly at generation time.</li>
          </ul>
        </div>
        <div class="space-y-2.5">
          <UFormField label="Name"><UInput v-model="sceneForm.name" placeholder="e.g. Neon City Night, Forest Glade..." /></UFormField>
          <div v-for="key in sceneAttributeKeys" :key="key" class="flex gap-1.5 items-center">
            <label class="text-[11px] text-slate-500 font-medium w-20 shrink-0 flex items-center gap-1"><span>{{ attributeLabels[key].emoji }}</span><span>{{ attributeLabels[key].label }}</span></label>
            <UInput v-model="sceneForm[key]" :placeholder="attributePresets[key][0]" size="sm" class="flex-1" />
            <UButton variant="outline" color="neutral" size="xs" icon="i-lucide-dice-3" title="Randomize" @click="randomizeSceneField(key as SceneAttributeKey)" />
          </div>
        </div>
        <template #footer>
          <div class="flex gap-2">
            <UButton color="primary" class="flex-1" :disabled="!canSaveScene" @click="saveScene">{{ isCreatingScene ? 'Create Scene' : 'Save Changes' }}</UButton>
            <UButton v-if="isCreatingScene" variant="outline" color="neutral" @click="cancelCreateScene">Cancel</UButton>
          </div>
        </template>
      </UCard>
    </div>

    <div v-if="!selectedScene && !isCreatingScene && scenes.length > 0" class="mt-4">
      <p class="text-sm text-slate-400">Select a scene to edit, or go to <NuxtLink to="/create" class="text-violet-600 hover:underline">Create</NuxtLink> to combine with personas.</p>
    </div>
  </section>
</template>
