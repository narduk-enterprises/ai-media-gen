<script setup lang="ts">
import type { PodEndpoint, PodProfile } from '~/composables/useAppSettings'

definePageMeta({ middleware: 'auth', ssr: false })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()
const { pods, addPod, removePod, updatePod, gpuServerUrl } = useAppSettings()

const profileOptions = [
  { label: 'Image Only', value: 'image' as PodProfile },
  { label: 'Video Only', value: 'video' as PodProfile },
  { label: 'Full (All)', value: 'full' as PodProfile },
]

// ─── Health Check ────────────────────────────────────────────────
const healthStatuses = ref<Record<number, 'idle' | 'checking' | 'ok' | 'error'>>({})
const healthInfos = ref<Record<number, string>>({})

async function checkPodHealth(index: number) {
  const pod = pods.value[index]
  if (!pod?.url?.trim()) return
  healthStatuses.value[index] = 'checking'
  healthInfos.value[index] = ''
  try {
    const result = await $fetch<{ ok: boolean; vram?: string; version?: string; mode?: string; devices?: string[]; error?: string }>('/api/generate/comfyui-health', {
      params: { url: pod.url },
    })
    if (result.ok) {
      healthStatuses.value[index] = 'ok'
      const parts: string[] = []
      if (result.mode === 'pod_server') parts.push(`Pod Server v${result.version || '?'}`)
      if (result.vram) parts.push(result.vram)
      if (result.devices?.length) parts.push(result.devices[0]!)
      healthInfos.value[index] = parts.join(' · ') || 'Connected'
    } else {
      healthStatuses.value[index] = 'error'
      healthInfos.value[index] = result.error || 'Unreachable'
    }
  } catch (e: any) {
    healthStatuses.value[index] = 'error'
    healthInfos.value[index] = e?.data?.message || e?.message || 'Check failed'
  }
}

function handleAddPod() {
  addPod({ url: '', profile: 'full', label: '' })
}

function handleRemovePod(index: number) {
  removePod(index)
  delete healthStatuses.value[index]
  delete healthInfos.value[index]
}

function handleUpdatePodUrl(index: number, url: string) {
  const pod = pods.value[index]!
  updatePod(index, { ...pod, url })
  healthStatuses.value[index] = 'idle'
  healthInfos.value[index] = ''
}

function handleUpdatePodProfile(index: number, profile: PodProfile) {
  const pod = pods.value[index]!
  updatePod(index, { ...pod, profile })
}

function handleUpdatePodLabel(index: number, label: string) {
  const pod = pods.value[index]!
  updatePod(index, { ...pod, label })
}

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

async function handleLogout() {
  await logout()
  navigateTo('/')
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <h1 class="font-display text-2xl sm:text-3xl font-bold text-slate-800 mb-8">Settings</h1>

    <!-- Account info -->
    <UCard class="mb-6" variant="outline">
      <div class="flex flex-wrap items-center gap-x-8 gap-y-4">
        <UFormField label="Email" size="sm">
          <p class="text-sm text-slate-800">{{ user?.email || '—' }}</p>
        </UFormField>
        <UFormField label="Name" size="sm">
          <p class="text-sm text-slate-800">{{ user?.name || 'Not set' }}</p>
        </UFormField>
      </div>
    </UCard>

    <!-- ═══ GPU Pods ═══ -->
    <UCard class="mb-6" variant="outline">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">GPU Pods</h2>
          <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-plus" @click="handleAddPod">
            Add Pod
          </UButton>
        </div>
      </template>

      <p class="text-xs text-slate-500 mb-4">
        Configure GPU pods for media generation. Each pod can be assigned a profile:
        <strong>Image</strong> (SDXL checkpoints, upscalers),
        <strong>Video</strong> (LTX-2, Wan 2.2),
        or <strong>Full</strong> (everything).
        Requests are automatically routed to the right pod.
      </p>

      <!-- Empty state -->
      <div v-if="pods.length === 0" class="text-center py-8 text-slate-400">
        <p class="text-sm mb-2">No GPU pods configured</p>
        <p class="text-xs">Add a pod to enable image and video generation.</p>
      </div>

      <!-- Pod list -->
      <div v-for="(pod, index) in pods" :key="index" class="mb-4 p-4 rounded-lg border border-slate-200 bg-slate-50/50">
        <div class="flex items-start gap-3">
          <!-- Profile badge -->
          <UBadge
            :color="pod.profile === 'image' ? 'info' : pod.profile === 'video' ? 'warning' : 'success'"
            variant="subtle"
            size="sm"
            class="mt-1 shrink-0"
          >
            {{ pod.profile === 'image' ? '🖼️ Image' : pod.profile === 'video' ? '🎬 Video' : '⚡ Full' }}
          </UBadge>

          <div class="flex-1 space-y-2">
            <!-- Label -->
            <UInput
              :model-value="pod.label || ''"
              placeholder="Pod label (optional)"
              size="xs"
              class="w-full"
              @update:model-value="handleUpdatePodLabel(index, $event as string)"
            />

            <!-- URL + health check -->
            <div class="flex gap-2">
              <UInput
                :model-value="pod.url"
                placeholder="https://your-pod-url.proxy.runpod.net"
                size="sm"
                class="flex-1"
                @update:model-value="handleUpdatePodUrl(index, $event as string)"
              />
              <UButton
                size="sm"
                variant="outline"
                :color="healthStatuses[index] === 'ok' ? 'success' : healthStatuses[index] === 'error' ? 'error' : 'neutral'"
                :loading="healthStatuses[index] === 'checking'"
                @click="checkPodHealth(index)"
              >
                {{ healthStatuses[index] === 'ok' ? '✓' : healthStatuses[index] === 'error' ? '✕' : '⚡' }}
              </UButton>
            </div>

            <!-- Profile selector -->
            <USelect
              :model-value="pod.profile"
              :items="profileOptions"
              size="xs"
              class="w-40"
              @update:model-value="handleUpdatePodProfile(index, $event as PodProfile)"
            />

            <!-- Health info -->
            <div v-if="healthInfos[index]" class="mt-1">
              <div
                class="px-2 py-1 rounded text-[11px] inline-flex items-center gap-1"
                :class="{
                  'bg-emerald-50 text-emerald-700': healthStatuses[index] === 'ok',
                  'bg-red-50 text-red-600': healthStatuses[index] === 'error',
                }"
              >
                <span
                  v-if="healthStatuses[index] === 'ok'"
                  class="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"
                />
                <span
                  v-if="healthStatuses[index] === 'error'"
                  class="inline-block w-1.5 h-1.5 bg-red-500 rounded-full"
                />
                {{ healthInfos[index] }}
              </div>
            </div>
          </div>

          <!-- Remove button -->
          <UButton
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            @click="handleRemovePod(index)"
          />
        </div>
      </div>

      <!-- Recovery -->
      <div class="mt-5 pt-4 border-t border-slate-100">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="text-xs font-medium text-slate-700">Recover Lost Generations</p>
            <p class="text-[10px] text-slate-400">Re-poll the API for any pending jobs that may have completed.</p>
          </div>
          <UButton size="xs" variant="outline" color="neutral" :loading="recovering" @click="recoverGenerations">
            Recover
          </UButton>
        </div>
        <div v-if="recoverResult" class="mt-2 p-3 rounded-lg text-xs" :class="recoverResult.recovered > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'">
          <template v-if="recoverResult.total === 0">No pending jobs found.</template>
          <template v-else>
            {{ recoverResult.recovered }} recovered, {{ recoverResult.failed }} failed, {{ recoverResult.stillProcessing }} still processing out of {{ recoverResult.total }} total.
          </template>
        </div>
        <div v-if="recoverError" class="mt-2 p-3 rounded-lg bg-red-50 text-red-600 text-xs">
          {{ recoverError }}
        </div>
      </div>
    </UCard>

    <SettingsProjectPresets />

    <SettingsPersons />

    <!-- Danger zone -->
    <UCard class="border-red-100" variant="outline">
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Session</h2>
      <UButton color="error" variant="outline" @click="handleLogout">Sign Out</UButton>
    </UCard>
  </div>
</template>
