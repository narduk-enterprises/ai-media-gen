<script setup lang="ts">
definePageMeta({ middleware: 'auth', ssr: false })
useSeoMeta({ title: 'GPU Pods' })

const { gpuServerUrl } = useAppSettings()

// ─── Fetch Pods ─────────────────────────────────────────────────────────────
const { data, pending, error, refresh } = useFetch('/api/runpod/pods')

// ─── Start / Stop Pods ────────────────────────────────────────────────────
const actionLoading = ref<Record<string, boolean>>({})

async function startPod(podId: string) {
  actionLoading.value[podId] = true
  try {
    await $fetch('/api/runpod/start', {
      method: 'POST',
      body: { podId }
    })
    // RunPod API takes a few seconds to reflect desiredStatus changes, so we wait before refreshing
    setTimeout(refresh, 2000)
  } catch (e: any) {
    alert(`Failed to start pod: ${e?.data?.message || e.message}`)
  } finally {
    actionLoading.value[podId] = false
  }
}

async function stopPod(podId: string) {
  if (!confirm('Are you sure you want to stop this pod? Generations will fail if it goes offline.')) return

  actionLoading.value[podId] = true
  try {
    await $fetch('/api/runpod/stop', {
      method: 'POST',
      body: { podId }
    })
    setTimeout(refresh, 2000)
  } catch (e: any) {
    alert(`Failed to stop pod: ${e?.data?.message || e.message}`)
  } finally {
    actionLoading.value[podId] = false
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function getProxyUrl(podId: string, port = 8188) {
  return `https://${podId}-${port}.proxy.runpod.net`
}

const copyStatus = ref<Record<string, boolean>>({})
function copyUrl(podId: string) {
  const url = getProxyUrl(podId)
  navigator.clipboard.writeText(url)
  copyStatus.value[podId] = true
  setTimeout(() => { copyStatus.value[podId] = false }, 2000)
}

function isActive(podId: string) {
  return gpuServerUrl.value?.includes(podId)
}

function setAsTarget(podId: string) {
  gpuServerUrl.value = getProxyUrl(podId)
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-display text-2xl sm:text-3xl font-bold text-slate-800">GPU Pods</h1>
        <p class="text-sm text-slate-500 mt-1">Manage your active AI generation instances.</p>
      </div>
      <UButton 
        icon="i-heroicons-arrow-path" 
        color="neutral" 
        variant="ghost" 
        :loading="pending" 
        @click="refresh"
      />
    </div>

    <!-- Error State -->
    <UAlert
      v-if="error"
      color="error"
      title="Failed to Load Pods"
      :description="error?.data?.statusMessage || error?.message || 'Check your RunPod API key configuration.'"
      class="mb-6"
      icon="i-heroicons-exclamation-triangle"
    />

    <!-- Loading State -->
    <div v-if="pending && !data?.pods" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <USkeleton v-for="i in 2" :key="i" class="h-48 w-full" />
    </div>

    <!-- Pods List -->
    <div v-else-if="data?.pods" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-if="data.pods.length === 0" class="col-span-full py-12 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-100">
        <UIcon name="i-heroicons-server" class="w-8 h-8 mx-auto text-slate-300 mb-2" />
        <p>No RunPod instances found on your account.</p>
      </div>

      <UCard 
        v-for="pod in data.pods" 
        :key="pod.id" 
        class="transition-all"
        :class="isActive(pod.id) ? 'ring-2 ring-primary-500 border-transparent shadow-sm' : ''"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm text-slate-500">{{ pod.id }}</span>
              <UBadge v-if="isActive(pod.id)" color="primary" variant="subtle" size="sm">Active Target</UBadge>
            </div>
            
            <div class="flex items-center gap-1.5">
              <span class="relative flex h-2.5 w-2.5">
                 <span v-if="pod.status === 'RUNNING'" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                 <span class="relative inline-flex rounded-full h-2.5 w-2.5" :class="[pod.status === 'RUNNING' ? 'bg-emerald-500' : pod.status === 'EXITED' ? 'bg-slate-400' : 'bg-amber-400']"></span>
              </span>
              <span class="text-xs font-semibold tracking-wider text-slate-600">
                {{ pod.status === 'EXITED' ? 'STOPPED' : pod.status }}
              </span>
            </div>
          </div>
        </template>

        <div class="space-y-4">
          <div>
            <h3 class="font-semibold text-slate-800 text-lg truncate">{{ pod.name }}</h3>
            <p class="text-xs text-slate-500">Machine: <span class="font-mono">{{ pod.machineId || 'N/A' }}</span></p>
          </div>

          <!-- Network details (only if running) -->
          <div v-if="pod.status === 'RUNNING'" class="bg-slate-50 rounded p-3 text-xs font-mono space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-500">IP:</span>
              <span class="text-slate-800">{{ pod.ip || 'Pending...' }}</span>
            </div>
            <div class="flex justify-between items-center group">
              <span class="text-slate-500">Proxy:</span>
              <div class="flex items-center gap-2">
                <span class="text-slate-800 truncate max-w-[150px]">{{ getProxyUrl(pod.id) }}</span>
                <UButton 
                  :icon="copyStatus[pod.id] ? 'i-heroicons-check' : 'i-heroicons-clipboard'" 
                  color="neutral" 
                  variant="ghost" 
                  size="xs" 
                  class="opacity-0 group-hover:opacity-100 transition-opacity p-0"
                  @click="copyUrl(pod.id)"
                  :ui="{ rounded: 'rounded-full' }"
                />
              </div>
            </div>
          </div>
          <div v-else class="bg-slate-50 rounded p-3 text-xs text-slate-400 italic text-center">
            Network info unavailable while stopped
          </div>
        </div>

        <template #footer>
          <div class="flex justify-between items-center gap-2">
            <div>
              <UButton
                v-if="pod.status === 'EXITED' || pod.status === 'STOPPED'"
                icon="i-heroicons-play"
                color="primary"
                size="sm"
                :loading="actionLoading[pod.id]"
                @click="startPod(pod.id)"
              >
                Start Pod
              </UButton>
              <UButton
                v-else-if="pod.status === 'RUNNING'"
                icon="i-heroicons-stop"
                color="error"
                variant="outline"
                size="sm"
                :loading="actionLoading[pod.id]"
                @click="stopPod(pod.id)"
              >
                Stop Pod
              </UButton>
            </div>
            
            <UButton 
              v-if="pod.status === 'RUNNING' && !isActive(pod.id)" 
              color="neutral" 
              variant="soft" 
              size="sm" 
              icon="i-heroicons-link" 
              @click="setAsTarget(pod.id)"
            >
              Use as Target
            </UButton>
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
