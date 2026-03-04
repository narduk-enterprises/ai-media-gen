<script setup lang="ts">
definePageMeta({ middleware: 'auth', ssr: false })
useSeo({
  title: 'GPU Pods',
  description: 'Manage your active AI generation instances.'
})
useWebPageSchema()

interface Pod {
  id: string
  name: string
  status: string
  gpuName?: string
  gpuCount: number
  costPerHr?: number
  gpuUtilPercent: number
  gpuMemoryPercent: number
  memoryUsedGb: number
  memoryTotalGb: number
  memoryPercent: number
  volumeInGb?: number
  ip?: string
  imageName?: string
  dockerId?: string
  runtime?: string
  comfy_ready?: boolean
}

interface GpuType {
  id: string
  displayName: string
  name: string
  vram: number
  vram_free: number
  securePrice: number
  communityPrice: number
  price: number
  valueScore: number
  memoryInGb: number
}

interface DataCenter {
  id: string
  name: string
}

interface TemplateOption {
  id: string
  name: string
}

interface Option {
  label: string
  value: string
  disabled?: boolean
  memoryInGb?: number
  securePrice?: number
  communityPrice?: number
}

// Active pods with live job counts (for display only — routing is server-side)
const { data: activePodData } = useFetch<{ pods: { id: string; activeJobs: number }[] }>('/api/runpod/active-pods', { default: () => ({ pods: [] }) })
function getActiveJobs(podId: string): number {
  const found = activePodData.value?.pods?.find((p) => p.id === podId)
  return found?.activeJobs ?? 0
}

// ─── Fetch Pods ─────────────────────────────────────────────────────────────
const { data, pending, error, refresh } = useFetch<{ pods: Pod[] }>('/api/runpod/pods', { server: false })

// ─── Deploy Pod ─────────────────────────────────────────────────────────────
const showDeployModal = ref(false)
const optionsPending = ref(false)
const templates = ref<Option[]>([])
const gpuTypes = ref<Option[]>([])
const dataCenters = ref<Option[]>([])
const availableDataCenters = ref<string[]>([])
const loadingAvailability = ref(false)

const deployState = reactive({
  name: 'GPU Pod',
  template: '',
  gpuType: 'NVIDIA RTX A6000',
  gpuCount: 1,
  cloudType: 'SECURE' as 'SECURE' | 'COMMUNITY' | 'ALL',
  dataCenter: 'ANY',
  volumeInGb: 40,
  containerDiskInGb: 40,
  modelGroups: ['juggernaut', 'upscale'] as string[],
})

// Model group definitions with estimated sizes
const MODEL_GROUPS = [
  { value: 'juggernaut', label: 'Juggernaut XL', icon: '🖼️', sizeGb: 7, category: 'Image' },
  { value: 'pony', label: 'CyberRealistic Pony', icon: '🐴', sizeGb: 7, category: 'Image' },
  { value: 'extra_checkpoints', label: 'Extra Checkpoints', icon: '🎨', sizeGb: 30, category: 'Image' },
  { value: 'qwen', label: 'Qwen Image', icon: '✨', sizeGb: 12, category: 'Image' },
  { value: 'flux2', label: 'Flux2 Dev + Turbo', icon: '⚡', sizeGb: 15, category: 'Image' },
  { value: 'z_image', label: 'Z-Image (HQ)', icon: '💎', sizeGb: 10, category: 'Image' },
  { value: 'z_image_turbo', label: 'Z-Image Turbo', icon: '🚀', sizeGb: 8, category: 'Image' },
  { value: 'wan22', label: 'Wan 2.2 T2V/I2V', icon: '🎬', sizeGb: 40, category: 'Video' },
  { value: 'wan22_t2v', label: 'Wan 2.2 T2V Only', icon: '🎬', sizeGb: 80, category: 'Video' },
  { value: 'ltx2', label: 'LTX-2 19B', icon: '🎥', sizeGb: 25, category: 'Video' },
  { value: 'ltx2_camera', label: 'LTX-2 Camera LoRAs', icon: '📷', sizeGb: 2, category: 'Video' },
  { value: 'upscale', label: 'RealESRGAN Upscale', icon: '🔍', sizeGb: 1, category: 'Shared' },
  { value: 'shared', label: 'AI Caption (VL)', icon: '💬', sizeGb: 5, category: 'Shared' },
  { value: 'prompt_refine', label: 'Prompt Refinement', icon: '✍️', sizeGb: 16, category: 'Shared' },
  { value: 'video_prompt', label: 'Video-to-Prompt (AWQ)', icon: '📝', sizeGb: 5, category: 'Shared' },
]
const LOG_SOURCES = ['admin', 'comfy'] as const

// ─── Quick Deploy Presets ────────────────────────────────────────────────────
interface QuickDeployPreset {
  id: string
  label: string
  icon: string
  description: string
  modelGroups: string[]
  minVram: number
  color: string
  isVideo?: boolean
}

const QUICK_DEPLOY_PRESETS: QuickDeployPreset[] = [
  { id: 'juggernaut', label: 'JuggernautXL', icon: '🖼️', description: 'High-quality photorealistic images', modelGroups: ['juggernaut', 'upscale', 'shared'], minVram: 12, color: 'from-violet-500 to-purple-600' },
  { id: 'pony', label: 'CyberRealistic Pony', icon: '🐴', description: 'Stylized & creative images', modelGroups: ['pony', 'upscale', 'shared'], minVram: 12, color: 'from-pink-500 to-rose-600' },
  { id: 'flux2', label: 'Flux2', icon: '⚡', description: 'Fast dev & turbo image gen', modelGroups: ['flux2', 'upscale', 'shared'], minVram: 24, color: 'from-amber-500 to-orange-600' },
  { id: 'wan22_video', label: 'Wan 2.2 Video', icon: '🎬', description: 'Text/image-to-video (Wan)', modelGroups: ['wan22', 'upscale', 'shared'], minVram: 80, color: 'from-cyan-500 to-blue-600', isVideo: true },
  { id: 'wan22_t2v', label: 'Wan 2.2 T2V Slim', icon: '⚡🎬', description: 'Text-to-video only — no I2V, fast deploy', modelGroups: ['wan22_t2v', 'upscale'], minVram: 80, color: 'from-sky-500 to-indigo-600', isVideo: true },
  { id: 'ltx2_video', label: 'LTX-2 Video', icon: '🎥', description: 'LTX-2 19B video generation', modelGroups: ['ltx2', 'ltx2_camera', 'upscale', 'shared'], minVram: 24, color: 'from-emerald-500 to-teal-600', isVideo: true },
  { id: 'all_image', label: 'All Image Models', icon: '🎨', description: 'Every image checkpoint + upscale', modelGroups: ['juggernaut', 'pony', 'extra_checkpoints', 'qwen', 'flux2', 'z_image', 'z_image_turbo', 'upscale', 'shared'], minVram: 24, color: 'from-indigo-500 to-blue-600' },
  { id: 'full_stack', label: 'Full Stack', icon: '💎', description: 'All models — image + video', modelGroups: MODEL_GROUPS.map(g => g.value), minVram: 80, color: 'from-slate-700 to-slate-900', isVideo: true },
  { id: 'video_prompt', label: 'Video-to-Prompt', icon: '📝', description: 'Analyze videos → structured prompts', modelGroups: ['video_prompt', 'shared'], minVram: 12, color: 'from-fuchsia-500 to-pink-600' },
  { id: 'prompt_refine', label: 'Prompt Refinement', icon: '✍️', description: 'Dolphin 8B — prompt enhancement', modelGroups: ['prompt_refine'], minVram: 16, color: 'from-teal-500 to-cyan-600' },
]

const showQuickDeploy = ref(false)
const quickDeployPreset = ref<QuickDeployPreset | null>(null)
const quickDeployLoading = ref(false)
const quickDeployGpus = ref<GpuType[]>([])
const quickDeployTemplateId = ref('')
const quickDeployError = ref('')
const quickDeploying = ref(false)

const bestValueGpuIds = computed(() => {
  if (quickDeployGpus.value.length === 0) return []
  const cheapest = quickDeployGpus.value[0]
  if (!cheapest) return []
  
  // Sort all GPUs by valueScore descending to find the top values
  const sortedByValue = [...quickDeployGpus.value].sort((a, b) => b.valueScore - a.valueScore)
  
  // Filter out the absolute cheapest from being marked as a "Value" upgrade
  // and take the top 3 remaining highest-value options
  const topValues = sortedByValue
    .filter(g => g.id !== cheapest.id)
    .slice(0, 3)
    .map(g => g.id)
    
  return topValues
})

function calcPresetDisk(preset: QuickDeployPreset): number {
  return preset.modelGroups.reduce((sum, g) => {
    const group = MODEL_GROUPS.find(mg => mg.value === g)
    return sum + (group?.sizeGb || 5)
  }, 0)
}

async function openQuickDeploy(preset: QuickDeployPreset) {
  quickDeployPreset.value = preset
  quickDeployGpus.value = []
  quickDeployError.value = ''
  quickDeployTemplateId.value = ''
  showQuickDeploy.value = true
  quickDeployLoading.value = true

  try {
    const res = await $fetch<{ gpus: GpuType[]; templateId: string }>('/api/runpod/quick-deploy-options')
    quickDeployTemplateId.value = res.templateId
    // Filter GPUs to those with enough VRAM for this preset
    quickDeployGpus.value = res.gpus.map(g => ({
      ...g,
      vram: g.vram || g.memoryInGb || 0,
      price: g.price || g.communityPrice || 0
    })).filter((g) => g.vram >= preset.minVram)
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    quickDeployError.value = err?.data?.statusMessage || err?.message || 'Failed to load GPU availability'
  } finally {
    quickDeployLoading.value = false
  }
}

async function quickDeploy(gpu: GpuType) {
  const preset = quickDeployPreset.value
  if (!preset || !quickDeployTemplateId.value) return

  const diskEstimate = calcPresetDisk(preset)
  const volumeInGb = Math.max(40, Math.ceil(diskEstimate * 1.3))
  const containerDiskInGb = preset.isVideo ? 20 : 10

  quickDeploying.value = true
  try {
    const res = await $fetch<{ podId: string }>('/api/runpod/deploy', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: {
        name: `${preset.label}`,
        templateId: quickDeployTemplateId.value,
        gpuTypeId: gpu.id,
        gpuCount: 1,
        cloudType: gpu.communityPrice ? 'COMMUNITY' : 'SECURE',
        volumeInGb,
        containerDiskInGb,
        modelGroups: preset.modelGroups,
      },
    })
    showQuickDeploy.value = false
    startSetupPolling(res.podId)
    setTimeout(refresh, 3000)
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    alert(`Deploy failed: ${err?.data?.statusMessage || err.message}`)
  } finally {
    quickDeploying.value = false
  }
}

const estimatedDiskGb = computed(() => {
  return deployState.modelGroups.reduce((sum, g) => {
    const group = MODEL_GROUPS.find(mg => mg.value === g)
    return sum + (group?.sizeGb || 5)
  }, 0)
})

// Auto-update volume when groups change
/* vue-official allow-deep-watch */
watch(() => deployState.modelGroups, () => {
  deployState.volumeInGb = Math.max(40, Math.ceil(estimatedDiskGb.value * 1.3)) // 30% headroom
}, { deep: true })

function toggleGroup(value: string) {
  const idx = deployState.modelGroups.indexOf(value)
  if (idx >= 0) deployState.modelGroups.splice(idx, 1)
  else deployState.modelGroups.push(value)
}

function selectPreset(preset: 'image' | 'video' | 'all' | 'none') {
  const presets: Record<string, string[]> = {
    image: ['juggernaut', 'pony', 'extra_checkpoints', 'qwen', 'flux2', 'z_image', 'z_image_turbo', 'upscale'],
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
const syncedGroups = ref<Record<string, { synced: boolean; partial: boolean; files_present: number; files_total: number }>>({}) 
const loadingSynced = ref(false)

async function openSyncModal(podId: string) {
  syncTargetPod.value = podId
  syncGroups.value = []
  syncVerify.value = false
  syncedGroups.value = {}
  showSyncModal.value = true
  // Fetch synced groups in background
  loadingSynced.value = true
  try {
    syncedGroups.value = await $fetch<Record<string, { synced: boolean; partial: boolean; files_present: number; files_total: number }>>('/api/runpod/synced-groups', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      params: { podId },
    })
  } catch {
    // Pod may not support this endpoint yet
  } finally {
    loadingSynced.value = false
  }
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
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(`Failed: ${err?.data?.message || err.message}`)
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
      const res = await $fetch<{ templates: TemplateOption[], gpuTypes: GpuType[], dataCenters: DataCenter[] }>('/api/runpod/options')
      
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
      })) as Option[]

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
    } catch (e: unknown) {
      const err = e as { message?: string }
      alert(`Failed to load options: ${err?.message}`)
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
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    alert(`Failed to deploy pod: ${err?.data?.statusMessage || err.message}`)
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
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(`Failed to start pod: ${err?.data?.message || err.message}`)
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
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(`Failed to stop pod: ${err?.data?.message || err.message}`)
  }
}

const podUpdating = ref<Record<string, boolean>>({})
async function updatePod(podId: string) {
  if (!confirm('Update this pod? This will pull latest code and rerun setup (no reboot).')) return
  podUpdating.value[podId] = true
  try {
    const result = await $fetch<{ success: boolean; message: string; output?: string }>('/api/runpod/update-pod', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId },
    })
    alert(result.message)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(`Update failed: ${err?.data?.message || err.message}`)
  } finally {
    podUpdating.value[podId] = false
  }
}

const podRestarting = ref<Record<string, boolean>>({})
async function restartPod(podId: string) {
  if (!confirm('Restart this pod? It will stop, then start with latest code and verify all models. This takes ~60-90 seconds.')) return
  podRestarting.value[podId] = true
  try {
    const result = await $fetch<{ success: boolean; message: string }>('/api/runpod/restart', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: { podId },
    })
    alert(result.message)
    setTimeout(refresh, 5000)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(`Restart failed: ${err?.data?.message || err.message}`)
  } finally {
    podRestarting.value[podId] = false
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
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(`Failed to terminate pod: ${err?.data?.message || err.message}`)
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
  for (const t of Object.values(setupTimers.value)) clearInterval(t)
  for (const t of Object.values(podLogsTimers.value)) clearInterval(t)
  if (podsRefreshTimer) clearInterval(podsRefreshTimer)
  if (healthRefreshTimer) clearInterval(healthRefreshTimer)
})

// ─── Template Helpers ──────────────────────────────────────────────────────
function getPodDiskUsage(podId: string) {
  const health = podHealth.value[podId]
  if (!health?.disk?.total_gb || health.disk.used_gb == null) return null
  return health.disk.used_gb / health.disk.total_gb
}

function getPodDiskStroke(podId: string) {
  const usage = getPodDiskUsage(podId)
  if (usage === null) return '#10b981'
  return usage > 0.85 ? '#ef4444' : '#10b981'
}

function getPodDiskDashArray(podId: string) {
  const usage = getPodDiskUsage(podId)
  if (usage === null) return '0, 100'
  return `${Math.round(usage * 100)}, 100`
}

function getPodDiskPercentText(podId: string) {
  const usage = getPodDiskUsage(podId)
  if (usage === null) return '...'
  return `${Math.round(usage * 100)}%`
}

function getDiskTitle(pod: Pod) {
  return getPodDiskTitle(pod.id, pod.volumeInGb)
}

function getPodDiskTitle(podId: string, volumeInGb?: number) {
  const health = podHealth.value[podId]
  if (health?.disk?.total_gb) {
    return `Disk: ${health.disk.used_gb?.toFixed(1)}GB / ${health.disk.total_gb?.toFixed(1)}GB\nFree: ${health.disk.free_gb?.toFixed(1)}GB`
  }
  return `Volume: ${volumeInGb}GB`
}

function _setLogSrc(podId: string, src: 'admin' | 'comfy') {
  switchLogSource(podId, src)
}

function _getLogClass(podId: string, src: string) {
  const active = (podLogsSource.value[podId] || 'admin') === src
  return active ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
}

function logClassFor(pod: { id: string }) {
  return (src: string) => {
    const active = (podLogsSource.value[pod.id] || 'admin') === src
    return active ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
  }
}

function logSrcClickFor(pod: { id: string }) {
  return (src: 'admin' | 'comfy') => switchLogSource(pod.id, src)
}

function getSetupStatusLabel(podId: string) {
  const s = setupStatus.value[podId]?.status
  if (s === 'starting') return '🚀 Booting...'
  if (s === 'installing') return '⚙️ Setting up...'
  if (s === 'ready') return '✅ Ready!'
  return ''
}

function getSetupStatusClass(podId: string) {
  const s = setupStatus.value[podId]?.status
  if (s === 'installing') return 'bg-amber-50 text-amber-700'
  if (s === 'starting') return 'bg-blue-50 text-blue-700'
  if (s === 'ready') return 'bg-emerald-50 text-emerald-700'
  return ''
}

function getModelGroupLabel(value: string) {
  return MODEL_GROUPS.find(mg => mg.value === value)?.label || value
}

function getPresetDiskEstimate(preset: QuickDeployPreset) {
  return Math.ceil(calcPresetDisk(preset) * 1.3)
}
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

    <!-- Quick Deploy Section -->
    <div class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-slate-700 text-sm uppercase tracking-wider">⚡ Quick Deploy</h2>
        <span class="text-xs text-slate-400">Click a model to see real-time pricing</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <button
          v-for="preset in QUICK_DEPLOY_PRESETS"
          :key="preset.id"
          class="group relative overflow-hidden rounded-xl p-3 text-left transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-[0.98] border border-slate-200 bg-white"
          @click="openQuickDeploy(preset)"
        >
          <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-linear-to-br" :class="preset.color" />
          <div class="relative z-10">
            <span class="text-2xl block mb-1">{{ preset.icon }}</span>
            <h3 class="font-semibold text-sm text-slate-800 group-hover:text-white transition-colors">{{ preset.label }}</h3>
            <p class="text-[10px] text-slate-400 group-hover:text-white/70 transition-colors mt-0.5 leading-snug">{{ preset.description }}</p>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 group-hover:bg-white/20 group-hover:text-white/80 transition-colors">
                ~{{ calcPresetDisk(preset) }}GB
              </span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 group-hover:bg-white/20 group-hover:text-white/80 transition-colors">
                {{ preset.minVram }}GB+ VRAM
              </span>
            </div>
          </div>
        </button>
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
                  <path
d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#8b5cf6" stroke-width="3"
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
                  <path
d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#a78bfa" stroke-width="3"
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
                  <path
d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#3b82f6" stroke-width="3"
                    :stroke-dasharray="`${pod.memoryPercent}, 100`" stroke-linecap="round" />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">{{ pod.memoryPercent }}%</span>
              </div>
              <p class="text-[9px] text-slate-500 mt-0.5">Mem</p>
            </div>
            <!-- Disk -->
            <div
              class="text-center" 
              :title="getDiskTitle(pod)"
            >
              <div class="relative w-11 h-11 mx-auto">
                <svg viewBox="0 0 36 36" class="w-11 h-11">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3" />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                    fill="none"
                    :stroke="getPodDiskStroke(pod.id)"
                    stroke-width="3"
                    :stroke-dasharray="getPodDiskDashArray(pod.id)"
                    stroke-linecap="round" 
                  />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">
                  {{ getPodDiskPercentText(pod.id) }}
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
                v-for="src in LOG_SOURCES"
                :key="src"
                class="px-2 py-0.5 text-[10px] rounded font-medium uppercase tracking-wide transition-colors"
                :class="logClassFor(pod)(src)"
                @click="logSrcClickFor(pod)(src)"
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
          <div
            v-if="setupStatus[pod.id]" 
            class="mb-3 p-3 rounded-lg text-xs" 
            :class="getSetupStatusClass(pod.id)"
          >
            <div class="flex items-center gap-2">
              <UIcon v-if="setupStatus[pod.id]?.status !== 'ready'" name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" />
              <UIcon v-else name="i-heroicons-check-circle" class="w-3.5 h-3.5" />
              <span class="font-medium">
                {{ getSetupStatusLabel(pod.id) }}
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
                icon="i-heroicons-arrow-path"
                color="warning"
                variant="ghost"
                size="sm"
                :loading="podRestarting[pod.id]"
                @click="restartPod(pod.id)"
              >
                Restart
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
                      {{ item.label }} 
                      <span v-if="item.memoryInGb" class="text-xs text-slate-400 font-mono ml-1">({{ item.memoryInGb }}GB)</span>
                    </span>
                    <div class="flex items-center gap-3 text-xs font-mono ml-4">
                      <span v-if="item.communityPrice" class="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="Community Price">
                        ${{ item.communityPrice }}/hr
                      </span>
                      <span v-if="item.securePrice" class="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded" title="Secure Price">
                        ${{ item.securePrice }}/hr
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
            class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border relative"
            :class="[
              syncGroups.includes(group.value)
                ? 'bg-primary-50 border-primary-300 text-primary-700'
                : syncedGroups[group.value]?.synced
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : syncedGroups[group.value]?.partial
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            ]"
            @click="toggleSyncGroup(group.value)"
          >
            <span>{{ group.icon }}</span>
            <span class="truncate">{{ group.label }}</span>
            <span v-if="syncedGroups[group.value]?.synced" class="text-emerald-500 text-[10px]">✅</span>
            <span v-else-if="syncedGroups[group.value]?.partial" class="text-amber-500 text-[10px]">⚠️</span>
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

    <!-- Quick Deploy Slide-Over -->
    <USlideover
      v-model:open="showQuickDeploy"
      :title="quickDeployPreset?.label ? `Deploy ${quickDeployPreset.label}` : 'Quick Deploy'"
      :description="quickDeployPreset?.description || ''"
    >
      <template #body>
        <!-- Loading -->
        <div v-if="quickDeployLoading" class="py-16 flex flex-col items-center gap-3 text-slate-500">
          <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin" />
          <span class="text-sm">Querying GPU availability & pricing...</span>
        </div>

        <!-- Error -->
        <UAlert
          v-else-if="quickDeployError"
          color="error"
          variant="soft"
          :title="quickDeployError"
          icon="i-heroicons-exclamation-triangle"
          class="mb-4"
        />

        <!-- GPU List -->
        <div v-else-if="quickDeployPreset" class="space-y-3">
          <!-- Summary -->
          <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-slate-400">Models:</span>
                <span class="text-slate-700 font-medium ml-1">{{ quickDeployPreset.modelGroups.length }} groups</span>
              </div>
              <div>
                <span class="text-slate-400">Est. Disk:</span>
                <span class="text-slate-700 font-medium ml-1">~{{ calcPresetDisk(quickDeployPreset) }}GB</span>
              </div>
              <div>
                <span class="text-slate-400">Volume:</span>
                <span class="text-slate-700 font-medium ml-1">{{ getPresetDiskEstimate(quickDeployPreset) }}GB</span>
              </div>
              <div>
                <span class="text-slate-400">Min VRAM:</span>
                <span class="text-slate-700 font-medium ml-1">{{ quickDeployPreset.minVram }}GB</span>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="g in quickDeployPreset.modelGroups"
                :key="g"
                class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 font-medium"
              >
                {{ getModelGroupLabel(g) }}
              </span>
            </div>
          </div>

          <!-- No GPUs available -->
          <div v-if="quickDeployGpus.length === 0" class="py-8 text-center text-slate-400">
            <UIcon name="i-heroicons-server" class="w-8 h-8 mx-auto mb-2" />
            <p class="text-sm">No GPUs with {{ quickDeployPreset.minVram }}GB+ VRAM currently available.</p>
            <p class="text-xs mt-1">Try again later or use the full Deploy modal.</p>
          </div>

          <!-- GPU cards -->
          <div v-else class="space-y-2">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Available GPUs (cheapest first)</h3>
            <button
              v-for="(gpu, idx) in quickDeployGpus"
              :key="gpu.id"
              :disabled="quickDeploying"
              class="w-full text-left p-3 rounded-lg border transition-all duration-150 hover:shadow-md hover:border-primary-300 disabled:opacity-50 disabled:cursor-wait"
              :class="idx === 0 ? 'border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200' : 'border-slate-200 bg-white hover:bg-slate-50'"
              @click="quickDeploy(gpu)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span v-if="idx === 0" class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">Cheapest</span>
                  <span v-else-if="bestValueGpuIds.indexOf(gpu.id) === 0" class="text-[10px] font-bold uppercase tracking-wider text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded border border-purple-200" title="Highest Performance per Dollar">🥇 Best Value</span>
                  <span v-else-if="bestValueGpuIds.indexOf(gpu.id) === 1" class="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200" title="2nd Highest Performance per Dollar">🥈 Great Value</span>
                  <span v-else-if="bestValueGpuIds.indexOf(gpu.id) === 2" class="text-[10px] font-bold uppercase tracking-wider text-cyan-600 bg-cyan-100 px-1.5 py-0.5 rounded border border-cyan-200" title="3rd Highest Performance per Dollar">🥉 Good Value</span>
                  <span class="font-semibold text-sm text-slate-800">{{ gpu.name }}</span>
                  <span class="text-xs text-slate-400 font-mono">({{ gpu.vram }}GB)</span>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <div class="flex items-center gap-1.5" v-if="gpu.securePrice">
                    <span class="text-[10px] text-slate-400 font-medium">SECURE</span>
                    <span class="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                      ${{ gpu.securePrice.toFixed(2) }}/hr
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5" v-if="gpu.communityPrice || gpu.price">
                    <span class="text-[10px] text-emerald-600 font-medium">COMMUNITY</span>
                    <span class="text-xs font-mono px-1.5 py-0.5 rounded font-bold text-emerald-700 bg-emerald-100">
                      ${{ (gpu.communityPrice || gpu.price).toFixed(2) }}/hr
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="idx === 0" class="mt-1.5 text-[10px] text-emerald-600">
                ⚡ Click to deploy instantly
              </div>
            </button>
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>
