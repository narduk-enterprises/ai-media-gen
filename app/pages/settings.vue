<script setup lang="ts">
definePageMeta({ middleware: 'auth', ssr: false })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()
const { runpodEndpoint, customEndpoint } = useAppSettings()

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

    <!-- ═══ AI Backend ═══ -->
    <UCard class="mb-6" variant="outline">
      <template #header>
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">AI Backend</h2>
      </template>

      <p class="text-xs text-slate-500 mb-4">
        Choose a RunPod serverless endpoint. The active endpoint is used for all image and video generation.
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UButton
          v-for="ep in [
            { id: '', label: 'Default', desc: 'Uses built-in endpoint' },
            { id: 'https://api.runpod.ai/v2/yvk1vz61cjhvlc', label: 'RunPod GPU A', desc: 'yvk1vz61cjhvlc' },
            { id: 'https://api.runpod.ai/v2/nsfh5rqe7bvdl7', label: 'RunPod GPU B', desc: 'nsfh5rqe7bvdl7' },
          ]"
          :key="ep.id"
          :variant="runpodEndpoint === ep.id ? 'soft' : 'outline'"
          :color="runpodEndpoint === ep.id ? 'primary' : 'neutral'"
          block
          @click="runpodEndpoint = ep.id as any"
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
          <UInput v-model="customEndpoint" placeholder="https://your-pod-url/api" size="sm" />
        </UFormField>
        <div v-if="customEndpoint" class="mt-1 flex items-center gap-2">
          <span class="text-[10px] text-emerald-600">Custom endpoint active</span>
          <UButton variant="link" color="error" size="xs" @click="customEndpoint = ''">Clear</UButton>
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
