<script setup lang="ts">
definePageMeta({ middleware: 'auth', ssr: false })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()
const { gpuServerUrl } = useAppSettings()

// ─── Health Check ────────────────────────────────────────────────
const healthStatus = ref<'idle' | 'checking' | 'ok' | 'error'>('idle')
const healthInfo = ref('')

async function checkHealth() {
  const url = gpuServerUrl.value?.trim()
  if (!url) return
  healthStatus.value = 'checking'
  healthInfo.value = ''
  try {
    const result = await $fetch<{ ok: boolean; vram?: string; version?: string; mode?: string; devices?: string[]; error?: string }>('/api/generate/comfyui-health', {
      params: { url },
    })
    if (result.ok) {
      healthStatus.value = 'ok'
      const parts: string[] = []
      if (result.mode === 'pod_server') parts.push(`Pod Server v${result.version || '?'}`)
      if (result.vram) parts.push(result.vram)
      if (result.devices?.length) parts.push(result.devices[0]!)
      healthInfo.value = parts.join(' · ') || 'Connected'
    } else {
      healthStatus.value = 'error'
      healthInfo.value = result.error || 'Unreachable'
    }
  } catch (e: any) {
    healthStatus.value = 'error'
    healthInfo.value = e?.data?.message || e?.message || 'Check failed'
  }
}

// Auto-check on URL change (debounced)
let healthTimer: ReturnType<typeof setTimeout> | null = null
watch(gpuServerUrl, (val) => {
  healthStatus.value = 'idle'
  healthInfo.value = ''
  if (healthTimer) clearTimeout(healthTimer)
  if (val?.trim()) {
    healthTimer = setTimeout(() => checkHealth(), 1200)
  }
})

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

    <!-- ═══ GPU Server ═══ -->
    <UCard class="mb-6" variant="outline">
      <template #header>
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">GPU Server</h2>
      </template>

      <p class="text-xs text-slate-500 mb-4">
        Enter the URL of your GPU pod running
        <code class="bg-slate-100 px-1 rounded text-[11px]">pod_server.py</code>.
        All image and video generation will use this server.
      </p>

      <UFormField label="Server URL" size="sm">
        <div class="flex gap-2">
          <UInput
            v-model="gpuServerUrl"
            placeholder="https://your-pod-url.proxy.runpod.net"
            size="sm"
            class="flex-1"
          />
          <UButton
            size="sm"
            variant="outline"
            :color="healthStatus === 'ok' ? 'success' : healthStatus === 'error' ? 'error' : 'neutral'"
            :loading="healthStatus === 'checking'"
            @click="checkHealth"
          >
            {{ healthStatus === 'ok' ? '✓ Online' : healthStatus === 'error' ? '✕ Offline' : 'Check' }}
          </UButton>
        </div>
      </UFormField>

      <!-- Health status -->
      <div v-if="healthInfo" class="mt-2">
        <div
          class="px-3 py-2 rounded-lg text-xs flex items-center gap-2"
          :class="{
            'bg-emerald-50 text-emerald-700': healthStatus === 'ok',
            'bg-red-50 text-red-600': healthStatus === 'error',
          }"
        >
          <span v-if="healthStatus === 'ok'" class="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span v-if="healthStatus === 'error'" class="inline-block w-2 h-2 bg-red-500 rounded-full" />
          {{ healthInfo }}
        </div>
      </div>

      <div v-if="gpuServerUrl" class="mt-1">
        <UButton variant="link" color="error" size="xs" @click="gpuServerUrl = ''; healthStatus = 'idle'; healthInfo = ''">Clear</UButton>
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
