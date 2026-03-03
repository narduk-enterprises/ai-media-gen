<script setup lang="ts">
definePageMeta({ middleware: 'auth', ssr: false })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()

// ─── Active Pods (read-only, fetched from RunPod API) ──────────────────────
const { data: activePods, pending: podsPending, refresh: refreshPods } = useFetch<{ pods: { id: string; name: string; url: string; activeJobs: number }[] }>('/api/runpod/active-pods', {
  default: () => ({ pods: [] }),
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

    <!-- ═══ GPU Pods (Read-Only Status) ═══ -->
    <UCard class="mb-6" variant="outline">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider">GPU Pods</h2>
          <div class="flex items-center gap-2">
            <UBadge v-if="activePods?.pods?.length" color="success" variant="subtle" size="sm">
              {{ activePods.pods.length }} running
            </UBadge>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-arrow-path" :loading="podsPending" @click="refreshPods()" />
          </div>
        </div>
      </template>

      <p class="text-xs text-slate-500 mb-4">
        Running pods are auto-discovered from RunPod. Jobs are automatically routed to the least-loaded pod.
        Manage pods on the <NuxtLink to="/pods" class="text-primary-500 hover:underline">Pods</NuxtLink> page.
      </p>

      <!-- Loading -->
      <div v-if="podsPending && !activePods?.pods?.length" class="py-6 text-center text-slate-400">
        <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin mx-auto mb-2" />
        <p class="text-xs">Checking running pods...</p>
      </div>

      <!-- No pods -->
      <div v-else-if="!activePods?.pods?.length" class="text-center py-6 text-slate-400">
        <UIcon name="i-heroicons-server" class="w-6 h-6 mx-auto mb-2 text-slate-300" />
        <p class="text-xs">No running pods detected.</p>
        <p class="text-[10px] mt-1">Deploy or start a pod from the <NuxtLink to="/pods" class="text-primary-500 hover:underline">Pods</NuxtLink> page.</p>
      </div>

      <!-- Pod list (read-only) -->
      <div v-else class="space-y-2">
        <div v-for="pod in activePods.pods" :key="pod.id" class="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div class="flex items-center gap-3">
            <span class="relative flex h-2.5 w-2.5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <div>
              <p class="text-sm font-medium text-slate-800">{{ pod.name || pod.id }}</p>
              <p class="text-[10px] font-mono text-slate-400">{{ pod.url }}</p>
            </div>
          </div>
          <UBadge
            :color="pod.activeJobs > 0 ? 'warning' : 'success'"
            variant="subtle"
            size="sm"
          >
            {{ pod.activeJobs > 0 ? `${pod.activeJobs} active` : 'Idle' }}
          </UBadge>
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
