<script setup lang="ts">
import { characterAttributeKeys, sceneAttributeKeys, attributeLabels, attributePresets, pickRandom } from '~/utils/promptBuilder'

const props = defineProps<{
  persons: readonly any[]
  scenes: readonly any[]
  activePersonId: string | null
  selectedSceneIds: string[]
  countPerScene: number
  basePrompt: string
  showBasePrompt: boolean
  presetBasePrompts: string[]
  promptPreview: { name: string; prompt: string }[]
  scenePayloads: Record<string, string>[]
  personaTotal: number
  disabled: boolean
}>()

const emit = defineEmits<{
  'update:activePersonId': [value: string | null]
  'update:selectedSceneIds': [value: string[]]
  'update:countPerScene': [value: number]
  'update:basePrompt': [value: string]
  'update:showBasePrompt': [value: boolean]
  toggleScene: [id: string]
  addRandomScene: []
}>()

function personSummary(person: { name: string; description?: string; [key: string]: any }): string {
  if (person.description?.trim()) return person.description.length > 50 ? person.description.slice(0, 50) + '…' : person.description
  const parts: string[] = []
  for (const key of characterAttributeKeys) {
    if (person[key]) { parts.push(person[key]); if (parts.length >= 2) break }
  }
  return parts.join(' · ') || 'No details yet'
}

function sceneSummary(scene: any): string {
  const parts: string[] = []
  for (const key of sceneAttributeKeys) {
    if (scene[key]?.trim()) {
      parts.push(attributeLabels[key].emoji + ' ' + (scene[key].length > 12 ? scene[key].slice(0, 12) + '…' : scene[key]))
      if (parts.length >= 2) break
    }
  }
  return parts.join(' ') || 'Empty scene'
}
</script>

<template>
  <div class="space-y-6 pt-4">
    <!-- Persona picker -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Persona</h2>
        <UButton to="/personas" variant="link" size="xs" trailing-icon="i-lucide-arrow-right">Manage</UButton>
      </div>
      <div class="overflow-x-auto pb-2">
        <div class="inline-flex gap-3">
          <button
            class="shrink-0 w-44 p-3 rounded-xl border-2 text-left transition-all"
            :class="activePersonId === null ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70' : 'border-slate-200 bg-white hover:border-slate-300'"
            @click="emit('update:activePersonId', null)"
          >
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-sm shrink-0">—</div>
              <span class="font-medium text-sm text-slate-600">None</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-1 pl-10">Free-form prompt only</p>
          </button>
          <button
            v-for="person in persons"
            :key="person.id"
            class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
            :class="activePersonId === person.id ? 'ring-2 ring-violet-400 border-violet-200 bg-violet-50/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
            @click="emit('update:activePersonId', person.id)"
          >
            <div class="flex items-center gap-2.5 mb-1.5">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                :class="activePersonId === person.id ? 'bg-violet-200 text-violet-700' : 'bg-slate-100 text-slate-500'"
              >{{ person.name.charAt(0).toUpperCase() }}</div>
              <span class="font-medium text-sm text-slate-700 truncate">{{ person.name }}</span>
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ personSummary(person) }}</p>
          </button>
        </div>
      </div>
    </section>

    <!-- Scene picker -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Scenes <span class="text-slate-400 font-normal normal-case tracking-normal">(select one or more)</span>
          </h2>
          <UButton v-if="selectedSceneIds.length > 0" variant="ghost" color="error" size="xs" icon="i-lucide-x" @click="emit('update:selectedSceneIds', [])">
            Clear {{ selectedSceneIds.length }}
          </UButton>
        </div>
        <UButton to="/personas" variant="link" size="xs" trailing-icon="i-lucide-arrow-right">Manage</UButton>
      </div>
      <div class="overflow-x-auto pb-2">
        <div class="inline-flex gap-3">
          <button
            v-for="scene in scenes"
            :key="scene.id"
            class="shrink-0 w-52 p-3 rounded-xl border-2 text-left transition-all"
            :class="selectedSceneIds.includes(scene.id) ? 'ring-2 ring-cyan-400 border-cyan-200 bg-cyan-50/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'"
            @click="emit('toggleScene', scene.id)"
          >
            <div class="flex items-center gap-2.5 mb-1.5">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                :class="selectedSceneIds.includes(scene.id) ? 'bg-cyan-200 text-cyan-700' : 'bg-slate-100 text-slate-500'"
              >{{ attributeLabels.scene.emoji }}</div>
              <span class="font-medium text-sm text-slate-700 truncate">{{ scene.name }}</span>
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-2 pl-[42px]">{{ sceneSummary(scene) }}</p>
          </button>
          <button
            class="shrink-0 w-44 p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/30 flex flex-col items-center justify-center gap-1 transition-all"
            @click="emit('addRandomScene')"
          >
            <span class="text-2xl text-cyan-400">🎲</span>
            <span class="text-[11px] font-medium text-slate-600">Random Scene</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Per-scene count -->
    <CountSelector :model-value="countPerScene" @update:model-value="emit('update:countPerScene', $event)" label="Per scene" :options="[1, 2, 4]">
      <p v-if="scenePayloads.length > 0" class="text-xs text-slate-500 ml-auto">
        {{ scenePayloads.length }} scene(s) × {{ countPerScene }} =
        <strong>{{ personaTotal }} image{{ personaTotal !== 1 ? 's' : '' }}</strong>
      </p>
    </CountSelector>

    <!-- Base prompt override -->
    <div>
      <UButton variant="link" size="xs" color="neutral" @click="emit('update:showBasePrompt', !showBasePrompt)">
        {{ showBasePrompt ? 'Hide' : 'Show' }} base prompt
      </UButton>
      <div v-if="showBasePrompt" class="mt-2 space-y-2">
        <PromptInput :model-value="basePrompt" @update:model-value="emit('update:basePrompt', $event)" label="Base Prompt" placeholder="e.g. beautiful high-quality photograph of" :disabled="disabled">
          <template #actions>
            <template v-if="presetBasePrompts.length > 0">
              <UButton
                v-for="bp in presetBasePrompts.slice(0, 5)"
                :key="bp"
                size="xs"
                variant="outline"
                color="neutral"
                @click="emit('update:basePrompt', bp)"
              >
                {{ bp.length > 35 ? bp.slice(0, 35) + '…' : bp }}
              </UButton>
            </template>
          </template>
        </PromptInput>
      </div>
    </div>

    <!-- Prompt preview -->
    <UCard v-if="promptPreview.length > 0" variant="subtle">
      <div class="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Prompt preview</div>
      <div class="space-y-2">
        <div v-for="(item, i) in promptPreview" :key="i" class="flex gap-2">
          <UBadge size="xs" variant="subtle">{{ item.name }}</UBadge>
          <p class="text-xs text-slate-600 leading-relaxed line-clamp-2">{{ item.prompt }}</p>
        </div>
      </div>
    </UCard>
  </div>
</template>
