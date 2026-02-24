<script setup lang="ts">
definePageMeta({ middleware: 'auth', ssr: false })
useSeoMeta({ title: 'GPU Pods' })

// Active pods with live job counts (for display only — routing is server-side)
const { data: activePodData } = useFetch<{ pods: { id: string; activeJobs: number }[] }>('/api/runpod/active-pods', { default: () => ({ pods: [] }) })
function getActiveJobs(podId: string): number {
  const found = activePodData.value?.pods?.find((p: any) => p.id === podId)
  return found?.activeJobs ?? 0
}

// ─── Fetch Pods ─────────────────────────────────────────────────────────────
const { data, pending, error, refresh } = useFetch('/api/runpod/pods', { server: false })

// ─── Deploy Pod ─────────────────────────────────────────────────────────────
const showDeployModal = ref(false)
const optionsPending = ref(false)
const templates = ref<any[]>([])
const gpuTypes = ref<any[]>([])
const dataCenters = ref<any[]>([])
const availableDataCenters = ref<string[]>([])
const loadingAvailability = ref(false)

const deployState = reactive({
  name: 'GPU Pod',
  template: '',
  gpuType: 'NVIDIA RTX A6000',
  gpuCount: 1,
  cloudType: 'SECURE',
  dataCenter: 'ANY',
  volumeInGb: 20,
  containerDiskInGb: 40,
  modelGroups: ['juggernaut', 'upscale'] as string[],
})

// Model group definitions with estimated sizes
const MODEL_GROUPS = [
  { value: 'juggernaut', label: 'Juggernaut XL', icon: '🖼️', sizeGb: 7, category: 'Image' },
  { value: 'pony', label: 'CyberRealistic Pony', icon: '🐴', sizeGb: 7, category: 'Image' },
  { value: 'qwen', label: 'Qwen Image', icon: '✨', sizeGb: 12, category: 'Image' },
  { value: 'flux2', label: 'Flux2 Dev + Turbo', icon: '⚡', sizeGb: 15, category: 'Image' },
  { value: 'z_image', label: 'Z-Image (HQ)', icon: '💎', sizeGb: 10, category: 'Image' },
  { value: 'z_image_turbo', label: 'Z-Image Turbo', icon: '🚀', sizeGb: 8, category: 'Image' },
  { value: 'wan22', label: 'Wan 2.2 T2V/I2V', icon: '🎬', sizeGb: 40, category: 'Video' },
  { value: 'ltx2', label: 'LTX-2 19B', icon: '🎥', sizeGb: 25, category: 'Video' },
  { value: 'ltx2_camera', label: 'LTX-2 Camera LoRAs', icon: '📷', sizeGb: 2, category: 'Video' },
  { value: 'upscale', label: 'RealESRGAN Upscale', icon: '🔍', sizeGb: 1, category: 'Shared' },
  { value: 'shared', label: 'AI Remix + Caption', icon: '💬', sizeGb: 8, category: 'Shared' },
]

const estimatedDiskGb = computed(() => {
  return deployState.modelGroups.reduce((sum, g) => {
    const group = MODEL_GROUPS.find(mg => mg.value === g)
    return sum + (group?.sizeGb || 5)
  }, 0)
})

// Auto-update volume when groups change
watch(() => deployState.modelGroups, () => {
  deployState.volumeInGb = Math.ceil(estimatedDiskGb.value * 1.3) // 30% headroom
}, { deep: true })

function toggleGroup(value: string) {
  const idx = deployState.modelGroups.indexOf(value)
  if (idx >= 0) deployState.modelGroups.splice(idx, 1)
  else deployState.modelGroups.push(value)
}

function selectPreset(preset: 'image' | 'video' | 'all' | 'none') {
  const presets: Record<string, string[]> = {
    image: ['juggernaut', 'pony', 'qwen', 'flux2', 'z_image', 'z_image_turbo', 'upscale'],
    video: ['wan22', 'ltx2', 'ltx2_camera', 'upscale', 'shared'],
    all: MODEL_GROUPS.map(g => g.value),
    none: [],
  }
  deployState.modelGroups = [...(presets[preset] || [])]
}

// On-demand sync for running pods
const showSyncModal = ref(false)
const syncTargetPod = ref('')
const syncGroups = ref<string[]>([])
const syncVerify = ref(false)
const syncing = ref(false)

function openSyncModal(podId: string) {
  syncTargetPod.value = podId
  syncGroups.value = []
  syncVerify.value = false
  showSyncModal.value = true
}

function toggleSyncGroup(value: string) {
  const idx = syncGroups.value.indexOf(value)
  if (idx >= 0) syncGroups.value.splice(idx, 1)
  else syncGroups.value.push(value)
}

async function triggerSync() {
  if (syncGroups.value.length === 0) return alert('Select at least one model group')
  syncing.value = true
  try {
    await $fetch('/api/runpod/sync-models', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId: syncTargetPod.value, groups: syncGroups.value, verify: syncVerify.value },
    })
    showSyncModal.value = false
    alert(`✅ Sync started for: ${syncGroups.value.join(', ')}. Check pod logs for progress.`)
  } catch (e: any) {
    alert(`Failed: ${e?.data?.message || e.message}`)
  } finally {
    syncing.value = false
  }
}

const cloudTypes = [
  { label: 'Secure Cloud', value: 'SECURE' },
  { label: 'Community Cloud', value: 'COMMUNITY' },
  { label: 'Any', value: 'ALL' }
]

watch(showDeployModal, async (open) => {
  if (open && templates.value.length === 0) {
    optionsPending.value = true
    try {
      const res = await $fetch<{ templates: any[], gpuTypes: any[], dataCenters: any[] }>('/api/runpod/options')
      
      // Nuxt UI 4 requires objects with `label` and `value` properties.
      templates.value = (res.templates || []).map(t => ({
        label: t.name,
        value: t.id
      }))
      
      gpuTypes.value = (res.gpuTypes || []).map(g => ({
        label: g.displayName,
        value: g.id,
        memoryInGb: g.memoryInGb,
        securePrice: g.securePrice,
        communityPrice: g.communityPrice
      }))

      dataCenters.value = [
        { label: 'Any Data Center', value: 'ANY' },
        ...(res.dataCenters || []).map(d => ({
          label: d.name,
          value: d.id
        }))
      ]
      
      const defaultTemplate = templates.value.find(t => t.label.includes('ai-media-gen'))
      if (defaultTemplate) deployState.template = defaultTemplate.value
      
      const defaultGpu = gpuTypes.value.find(g => g.label === 'NVIDIA RTX A6000')
      if (defaultGpu) {
        deployState.gpuType = defaultGpu.value
        setTimeout(checkAvailability, 50)
      }
    } catch (e: any) {
      alert(`Failed to load options: ${e?.message}`)
    } finally {
      optionsPending.value = false
    }
  }
})

const computedDataCenters = computed(() => {
  return dataCenters.value.map(dc => {
    if (dc.value === 'ANY') return dc
    // If not loaded yet, assume available so we don't flash everything disabled
    const isAvail = availableDataCenters.value.length === 0 || availableDataCenters.value.includes(dc.value)
    return {
      label: isAvail ? dc.label : `${dc.label} (Out of Stock)`,
      value: dc.value,
      disabled: !isAvail && availableDataCenters.value.length > 0
    }
  })
})

async function checkAvailability() {
  if (!deployState.gpuType || dataCenters.value.length === 0) return
  loadingAvailability.value = true
  try {
    const dcQuery = dataCenters.value.filter(d => d.value !== 'ANY').map(d => d.value).join(',')
    const res = await $fetch<{ available: string[] }>(`/api/runpod/availability`, {
      query: { gpuType: deployState.gpuType, gpuCount: deployState.gpuCount, dataCenters: dcQuery }
    })
    availableDataCenters.value = res.available
    
    // Auto-select "ANY" if current selection is completely out of stock globally
    if (deployState.dataCenter !== 'ANY' && !availableDataCenters.value.includes(deployState.dataCenter)) {
      deployState.dataCenter = 'ANY'
    }
  } catch(e) {
    console.warn("Failed to fetch availability", e)
  } finally {
    loadingAvailability.value = false
  }
}

watch([() => deployState.gpuType, () => deployState.gpuCount], () => {
  checkAvailability()
})

async function deployPod() {
  try {
    const payload = {
      name: deployState.name,
      templateId: deployState.template,
      gpuTypeId: deployState.gpuType,
      gpuCount: deployState.gpuCount,
      cloudType: deployState.cloudType,
      dataCenterId: deployState.dataCenter,
      volumeInGb: deployState.volumeInGb,
      containerDiskInGb: deployState.containerDiskInGb,
      modelGroups: deployState.modelGroups,
    }
    const res = await $fetch<{ podId: string }>('/api/runpod/deploy', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: payload
    })
    showDeployModal.value = false
    // Start polling setup status for the new pod
    startSetupPolling(res.podId)
    setTimeout(refresh, 3000)
  } catch (e: any) {
    alert(`Failed to deploy pod: ${e?.data?.statusMessage || e.message}`)
  }
}

// ─── Start / Stop Pods ────────────────────────────────────────────────────
async function startPod(podId: string) {
  try {
    await $fetch('/api/runpod/start', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId }
    })
    // RunPod API takes a few seconds to reflect desiredStatus changes, so we wait before refreshing
    setTimeout(refresh, 2000)
  } catch (e: any) {
    alert(`Failed to start pod: ${e?.data?.message || e.message}`)
  }
}

async function stopPod(podId: string) {
  if (!confirm('Are you sure you want to stop this pod? Generations will fail if it goes offline.')) return

  try {
    await $fetch('/api/runpod/stop', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId }
    })
    setTimeout(refresh, 2000)
  } catch (e: any) {
    alert(`Failed to stop pod: ${e?.data?.message || e.message}`)
  }
}

const podUpdating = ref<Record<string, boolean>>({})
async function updatePod(podId: string) {
  if (!confirm('Update this pod? This will pull latest code and restart ComfyUI + Admin server.')) return
  podUpdating.value[podId] = true
  try {
    const result = await $fetch<{ success: boolean; message: string; output?: string }>('/api/runpod/update-pod', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId },
    })
    alert(result.message)
  } catch (e: any) {
    alert(`Update failed: ${e?.data?.message || e.message}`)
  } finally {
    podUpdating.value[podId] = false
  }
}

async function terminatePod(podId: string) {
  if (!confirm('⚠️ This will PERMANENTLY DELETE this pod and its volume. This cannot be undone. Continue?')) return

  try {
    await $fetch('/api/runpod/terminate', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId }
    })
    setTimeout(refresh, 2000)
  } catch (e: any) {
    alert(`Failed to terminate pod: ${e?.data?.message || e.message}`)
  }
}

// ─── Pod Logs ──────────────────────────────────────────────────────────────
const podLogs = ref<Record<string, string>>({})
const podLogsOpen = ref<Record<string, boolean>>({})
const podLogsSource = ref<Record<string, 'admin' | 'comfy'>>({})
const podLogsTimers = ref<Record<string, ReturnType<typeof setInterval>>>({})
const podLogsLoading = ref<Record<string, boolean>>({})

async function fetchLogs(podId: string) {
  podLogsLoading.value[podId] = true
  try {
    const source = podLogsSource.value[podId] || 'admin'
    const res = await $fetch<{ logs: string }>('/api/runpod/logs', {
      params: { podId, source, lines: 100 },
    })
    podLogs.value[podId] = res.logs
  } catch {
    podLogs.value[podId] = '⚠️ Failed to fetch logs'
  } finally {
    podLogsLoading.value[podId] = false
  }
}

function toggleLogs(podId: string) {
  const isOpen = !podLogsOpen.value[podId]
  podLogsOpen.value[podId] = isOpen

  if (isOpen) {
    if (!podLogsSource.value[podId]) podLogsSource.value[podId] = 'admin'
    fetchLogs(podId)
    // Auto-refresh every 5s while open
    podLogsTimers.value[podId] = setInterval(() => fetchLogs(podId), 5000)
  } else {
    clearInterval(podLogsTimers.value[podId])
    delete podLogsTimers.value[podId]
  }
}

function switchLogSource(podId: string, source: 'admin' | 'comfy') {
  podLogsSource.value[podId] = source
  fetchLogs(podId)
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

// ─── Live Pod Health (VRAM, Disk from admin server) ───────────────────────
interface PodHealth {
  comfy: { status: string; vram_free_gb?: number; vram_total_gb?: number; gpu_name?: string }
  disk: { total_gb?: number; used_gb?: number; free_gb?: number }
}
const podHealth = ref<Record<string, PodHealth>>({})

async function fetchPodHealth(podId: string) {
  // Call pod admin server directly from the browser (CORS: * enabled)
  // CF Workers can't reach RunPod proxy URLs, but the browser can
  const podUrl = `https://${podId}-8188.proxy.runpod.net`
  try {
    const result = await $fetch<PodHealth>(`${podUrl}/health`, { timeout: 8_000 })
    podHealth.value[podId] = result
  } catch {
    // Pod may not be reachable yet (still booting)
  }
}

// ─── Auto-Refresh Pods + Health ───────────────────────────────────────────
let podsRefreshTimer: ReturnType<typeof setInterval> | null = null
let healthRefreshTimer: ReturnType<typeof setInterval> | null = null

function startAutoRefresh() {
  // Refresh pod list every 15s
  podsRefreshTimer = setInterval(() => refresh(), 15_000)
  // Refresh health for all running pods every 10s
  healthRefreshTimer = setInterval(() => {
    const pods = data.value?.pods || []
    for (const pod of pods) {
      if (pod.status === 'RUNNING') {
        fetchPodHealth(pod.id)
      }
    }
  }, 10_000)
}

onMounted(() => {
  startAutoRefresh()
  // Initial health fetch after pods load
  setTimeout(() => {
    const pods = data.value?.pods || []
    for (const pod of pods) {
      if (pod.status === 'RUNNING') fetchPodHealth(pod.id)
    }
  }, 2000)
})

// ─── Setup Status Tracking ────────────────────────────────────────────────
const setupStatus = ref<Record<string, { status: string; message: string }>>({})
const setupTimers = ref<Record<string, ReturnType<typeof setInterval>>>({})

function startSetupPolling(podId: string) {
  setupStatus.value[podId] = { status: 'starting', message: 'Pod is booting...' }

  const timer = setInterval(async () => {
    try {
      const result = await $fetch<{ status: string; message: string }>('/api/runpod/setup-status', {
        params: { podId },
      })
      setupStatus.value[podId] = result

      if (result.status === 'ready') {
        clearInterval(timer)
        delete setupTimers.value[podId]
        refresh()
      }
    } catch {
      // Ignore transient errors during setup
    }
  }, 10_000)

  setupTimers.value[podId] = timer
}

onUnmounted(() => {
  Object.values(setupTimers.value).forEach(t => clearInterval(t))
  Object.values(podLogsTimers.value).forEach(t => clearInterval(t))
  if (podsRefreshTimer) clearInterval(podsRefreshTimer)
  if (healthRefreshTimer) clearInterval(healthRefreshTimer)
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-display text-2xl sm:text-3xl font-bold text-slate-800">GPU Pods</h1>
        <p class="text-sm text-slate-500 mt-1">Manage your active AI generation instances.</p>
      </div>
      <div class="flex items-center gap-3">
        <UButton 
          icon="i-heroicons-arrow-path" 
          color="neutral" 
          variant="ghost" 
          loading-auto
          @click="refresh()"
        />
        <UButton
          icon="i-heroicons-plus"
          color="primary"
          @click="showDeployModal = true"
        >
          Deploy Pod
        </UButton>
      </div>
    </div>

    <!-- Error State -->
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
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
      >
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm text-slate-500">{{ pod.id }}</span>
              <UBadge v-if="pod.status === 'RUNNING' && getActiveJobs(pod.id) > 0" color="warning" variant="subtle" size="sm">
                {{ getActiveJobs(pod.id) }} active {{ getActiveJobs(pod.id) === 1 ? 'job' : 'jobs' }}
              </UBadge>
              <UBadge v-else-if="pod.status === 'RUNNING'" color="success" variant="subtle" size="sm">Idle</UBadge>
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
            <div class="flex items-center gap-2 mt-1 text-xs text-slate-500">
              <span class="font-mono">🖥 {{ pod.gpuName || 'Unknown GPU' }} ×{{ pod.gpuCount }}</span>
              <span v-if="pod.costPerHr" class="text-emerald-600 font-semibold">${{ pod.costPerHr.toFixed(2) }}/hr</span>
            </div>
          </div>

          <!-- Metrics bar (only when running) -->
          <div v-if="pod.status === 'RUNNING'" class="grid grid-cols-4 gap-2">
            <!-- GPU Utilization -->
            <div class="text-center" :title="`GPU Utilization: ${pod.gpuUtilPercent}%\n${pod.gpuName}`">
              <div class="relative w-11 h-11 mx-auto">
                <svg viewBox="0 0 36 36" class="w-11 h-11">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#8b5cf6" stroke-width="3"
                    :stroke-dasharray="`${pod.gpuUtilPercent}, 100`" stroke-linecap="round" />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">{{ pod.gpuUtilPercent }}%</span>
              </div>
              <p class="text-[9px] text-slate-500 mt-0.5">GPU</p>
            </div>
            <!-- GPU Memory -->
            <div class="text-center" :title="`GPU Memory: ${pod.gpuMemoryPercent}%\n${pod.gpuName}`">
              <div class="relative w-11 h-11 mx-auto">
                <svg viewBox="0 0 36 36" class="w-11 h-11">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#a78bfa" stroke-width="3"
                    :stroke-dasharray="`${pod.gpuMemoryPercent}, 100`" stroke-linecap="round" />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">{{ pod.gpuMemoryPercent }}%</span>
              </div>
              <p class="text-[9px] text-slate-500 mt-0.5">VRAM</p>
            </div>
            <!-- CPU Memory -->
            <div class="text-center" :title="`Memory: ${pod.memoryPercent}% (${pod.memoryUsedGb.toFixed(1)}GB / ${pod.memoryTotalGb}GB)`">
              <div class="relative w-11 h-11 mx-auto">
                <svg viewBox="0 0 36 36" class="w-11 h-11">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#3b82f6" stroke-width="3"
                    :stroke-dasharray="`${pod.memoryPercent}, 100`" stroke-linecap="round" />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">{{ pod.memoryPercent }}%</span>
              </div>
              <p class="text-[9px] text-slate-500 mt-0.5">Mem</p>
            </div>
            <!-- Disk -->
            <div class="text-center" :title="podHealth[pod.id]?.disk?.total_gb
              ? `Disk: ${podHealth[pod.id]!.disk.used_gb?.toFixed(1)}GB / ${podHealth[pod.id]!.disk.total_gb?.toFixed(1)}GB\nFree: ${podHealth[pod.id]!.disk.free_gb?.toFixed(1)}GB`
              : `Volume: ${pod.volumeInGb}GB`">
              <div class="relative w-11 h-11 mx-auto">
                <svg viewBox="0 0 36 36" class="w-11 h-11">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none"
                    :stroke="(podHealth[pod.id]?.disk?.total_gb && (podHealth[pod.id]!.disk.used_gb! / podHealth[pod.id]!.disk.total_gb!) > 0.85) ? '#ef4444' : '#10b981'"
                    stroke-width="3"
                    :stroke-dasharray="`${podHealth[pod.id]?.disk?.total_gb
                      ? Math.round((podHealth[pod.id]!.disk.used_gb! / podHealth[pod.id]!.disk.total_gb!) * 100)
                      : 0}, 100`"
                    stroke-linecap="round" />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">
                  {{ podHealth[pod.id]?.disk?.used_gb != null
                    ? `${Math.round((podHealth[pod.id]!.disk.used_gb! / podHealth[pod.id]!.disk.total_gb!) * 100)}%`
                    : '...' }}
                </span>
              </div>
              <p class="text-[9px] text-slate-500 mt-0.5">Disk</p>
            </div>
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
                  class="opacity-0 group-hover:opacity-100 transition-opacity p-0! rounded-full"
                  @click="copyUrl(pod.id)"
                />
              </div>
            </div>
          </div>
          <div v-else class="bg-slate-50 rounded p-3 text-xs text-slate-400 italic text-center">
            Network info unavailable while stopped
          </div>
        </div>

        <!-- Collapsible Logs Panel -->
        <div v-if="pod.status === 'RUNNING'" class="mt-3">
          <button
            class="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors"
            @click="toggleLogs(pod.id)"
          >
            <UIcon :name="podLogsOpen[pod.id] ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5" />
            <UIcon name="i-heroicons-command-line" class="w-3.5 h-3.5" />
            Server Logs
            <UIcon v-if="podLogsLoading[pod.id]" name="i-heroicons-arrow-path" class="w-3 h-3 animate-spin ml-1" />
          </button>

          <div v-if="podLogsOpen[pod.id]" class="mt-2">
            <!-- Source switcher -->
            <div class="flex gap-1 mb-2">
              <button
                v-for="src in (['admin', 'comfy'] as const)"
                :key="src"
                class="px-2 py-0.5 text-[10px] rounded font-medium uppercase tracking-wide transition-colors"
                :class="(podLogsSource[pod.id] || 'admin') === src
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                @click="switchLogSource(pod.id, src)"
              >
                {{ src }}
              </button>
              <button
                class="ml-auto px-2 py-0.5 text-[10px] rounded bg-slate-100 text-slate-500 hover:bg-slate-200"
                @click="fetchLogs(pod.id)"
              >
                ↻ Refresh
              </button>
            </div>
            <!-- Log output -->
            <pre class="bg-slate-900 text-green-400 text-[10px] leading-relaxed p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre-wrap">{{ podLogs[pod.id] || 'Loading...' }}</pre>
          </div>
        </div>

        <template #footer>
          <!-- Setup progress indicator -->
          <div v-if="setupStatus[pod.id]" class="mb-3 p-3 rounded-lg text-xs" :class="{
            'bg-amber-50 text-amber-700': setupStatus[pod.id]?.status === 'installing',
            'bg-blue-50 text-blue-700': setupStatus[pod.id]?.status === 'starting',
            'bg-emerald-50 text-emerald-700': setupStatus[pod.id]?.status === 'ready',
          }">
            <div class="flex items-center gap-2">
              <UIcon v-if="setupStatus[pod.id]?.status !== 'ready'" name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" />
              <UIcon v-else name="i-heroicons-check-circle" class="w-3.5 h-3.5" />
              <span class="font-medium">
                {{ setupStatus[pod.id]?.status === 'starting' ? '🚀 Booting...' : setupStatus[pod.id]?.status === 'installing' ? '⚙️ Setting up...' : '✅ Ready!' }}
              </span>
            </div>
            <p class="mt-1 text-[10px] opacity-75">{{ setupStatus[pod.id]?.message }}</p>
          </div>

          <div class="flex justify-between items-center gap-2">
            <div>
              <UButton
                v-if="pod.status === 'EXITED' || pod.status === 'STOPPED'"
                icon="i-heroicons-play"
                color="primary"
                size="sm"
                loading-auto
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
                loading-auto
                @click="stopPod(pod.id)"
              >
                Stop Pod
              </UButton>
            </div>
            <div class="flex items-center gap-1">
              <UButton
                v-if="pod.status === 'RUNNING'"
                icon="i-heroicons-cloud-arrow-up"
                color="info"
                variant="ghost"
                size="sm"
                :loading="podUpdating[pod.id]"
                @click="updatePod(pod.id)"
              >
                Update
              </UButton>
              <UButton
                v-if="pod.status === 'RUNNING'"
                icon="i-heroicons-arrow-down-tray"
                color="primary"
                variant="ghost"
                size="sm"
                @click="openSyncModal(pod.id)"
              >
                Sync Models
              </UButton>
              <UButton
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                size="sm"
                loading-auto
                @click="terminatePod(pod.id)"
              >
                Terminate
              </UButton>
            </div>
          </div>
        </template>
      </UCard>
    </div>

    <!-- Deploy Modal -->
    <UModal 
      v-model:open="showDeployModal" 
      title="Deploy New GPU Pod"
      description="Configure a new RunPod instance for AI generation."
      :close="{ color: 'neutral', variant: 'ghost', icon: 'i-heroicons-x-mark' }"
    >
      <template #body>
        <div v-if="optionsPending" class="py-12 flex justify-center items-center gap-3 text-slate-500">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin" />
          <span>Loading templates and GPUs...</span>
        </div>
        
        <UForm v-else :state="deployState" @submit="deployPod" class="space-y-5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Pod Name" name="name" required>
              <UInput v-model="deployState.name" class="w-full" />
            </UFormField>
            
            <UFormField label="RunPod Template" name="template" required class="col-span-1 sm:col-span-2">
              <USelect
                v-model="deployState.template"
                :items="templates"
                placeholder="Select Template"
                class="w-full"
                size="lg"
              />
            </UFormField>

            <UFormField label="GPU Type" name="gpuType" required class="col-span-1 sm:col-span-2">
              <USelectMenu
                v-model="deployState.gpuType"
                :items="gpuTypes"
                value-key="value"
                placeholder="Select GPU"
                class="w-full"
                size="lg"
              >
                <template #item-label="{ item }">
                  <div class="flex items-center justify-between w-full">
                    <span>
                      {{ (item as any).label }} 
                      <span class="text-xs text-slate-400 font-mono ml-1">({{ (item as any).memoryInGb }}GB)</span>
                    </span>
                    <div class="flex items-center gap-3 text-xs font-mono ml-4">
                      <span v-if="(item as any).communityPrice" class="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="Community Price">
                        ${{ (item as any).communityPrice }}/hr
                      </span>
                      <span v-if="(item as any).securePrice" class="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded" title="Secure Price">
                        ${{ (item as any).securePrice }}/hr
                      </span>
                    </div>
                  </div>
                </template>
              </USelectMenu>
            </UFormField>

            <UFormField label="GPU Count" name="gpuCount" required>
              <UInput v-model="deployState.gpuCount" type="number" min="1" max="8" class="w-full" size="lg" />
            </UFormField>

            <UFormField label="Cloud Type" name="cloudType" required>
              <USelect
                v-model="deployState.cloudType"
                :items="cloudTypes"
                class="w-full"
                size="lg"
              />
            </UFormField>

            <UFormField label="Data Center" name="dataCenter" required>
              <template #label>
                <div class="flex items-center gap-2">
                  <span>Data Center</span>
                  <UIcon v-if="loadingAvailability" name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin text-primary" />
                </div>
              </template>
              <USelect
                v-model="deployState.dataCenter"
                :items="computedDataCenters"
                :disabled="loadingAvailability"
                class="w-full"
                size="lg"
              />
            </UFormField>

            <UFormField label="Workspace Volume (GB)" name="volumeInGb" required>
              <UInput v-model="deployState.volumeInGb" type="number" min="1" class="w-full" size="lg" />
            </UFormField>

            <UFormField label="Container Disk (GB)" name="containerDiskInGb" required>
              <UInput v-model="deployState.containerDiskInGb" type="number" min="1" class="w-full" size="lg" />
            </UFormField>

            <div class="col-span-1 sm:col-span-2">
              <label class="block text-sm font-medium text-slate-700 mb-2">Model Groups</label>
              <!-- Preset buttons -->
              <div class="flex gap-1.5 mb-3">
                <button v-for="p in (['image', 'video', 'all', 'none'] as const)" :key="p" type="button" class="px-2 py-0.5 text-[10px] rounded font-medium uppercase tracking-wide bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors" @click="selectPreset(p)">{{ p }}</button>
              </div>
              <!-- Group checkboxes -->
              <div class="grid grid-cols-2 gap-1.5">
                <button
                  v-for="group in MODEL_GROUPS"
                  :key="group.value"
                  type="button"
                  class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
                  :class="deployState.modelGroups.includes(group.value)
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'"
                  @click="toggleGroup(group.value)"
                >
                  <span>{{ group.icon }}</span>
                  <span class="truncate">{{ group.label }}</span>
                  <span class="ml-auto text-[10px] opacity-60">{{ group.sizeGb }}GB</span>
                </button>
              </div>
              <p class="text-xs mt-2 font-medium" :class="estimatedDiskGb > 100 ? 'text-amber-600' : 'text-slate-500'">
                Estimated: ~{{ estimatedDiskGb }}GB models → {{ deployState.volumeInGb }}GB volume
              </p>
            </div>
          </div>
          
          <div class="flex justify-end gap-3 pt-6 border-t border-slate-100 mt-2">
            <UButton color="neutral" variant="ghost" size="lg" @click="showDeployModal = false">Cancel</UButton>
            <UButton type="submit" color="primary" size="lg" loading-auto>Deploy Instance</UButton>
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Sync Models Modal -->
    <UModal
      v-model:open="showSyncModal"
      title="Sync Models to Pod"
      description="Select model groups to download on the running pod."
      :close="{ color: 'neutral', variant: 'ghost', icon: 'i-heroicons-x-mark' }"
    >
      <template #body>
        <div class="grid grid-cols-2 gap-1.5 mb-4">
          <button
            v-for="group in MODEL_GROUPS"
            :key="group.value"
            class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
            :class="syncGroups.includes(group.value)
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'"
            @click="toggleSyncGroup(group.value)"
          >
            <span>{{ group.icon }}</span>
            <span class="truncate">{{ group.label }}</span>
            <span class="ml-auto text-[10px] opacity-60">{{ group.sizeGb }}GB</span>
          </button>
        </div>
        <label class="flex items-center gap-2 px-1 py-2 cursor-pointer select-none">
          <input v-model="syncVerify" type="checkbox" class="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
          <span class="text-xs text-slate-600">Verify checksums (re-download if corrupted)</span>
        </label>
        <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <UButton color="neutral" variant="ghost" @click="showSyncModal = false">Cancel</UButton>
          <UButton color="primary" :loading="syncing" :disabled="syncGroups.length === 0" @click="triggerSync">
            Start Sync ({{ syncGroups.length }} groups)
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
