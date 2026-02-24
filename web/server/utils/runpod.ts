/**
 * runpod.ts — Wrapper for the RunPod GraphQL API
 */

export interface RunPodInfo {
  id: string
  name: string
  status: string
  uptimeSeconds: number
  ip: string
  ports: string
  podType: string
  machineId: string
  // Metrics
  gpuName: string
  gpuCount: number
  gpuUtilPercent: number
  gpuMemoryPercent: number
  cpuUtilPercent: number
  memoryPercent: number
  memoryUsedGb: number
  memoryTotalGb: number
  diskUsedGb: number
  diskTotalGb: number
  vcpuCount: number
  costPerHr: number
  volumeInGb: number
  containerDiskInGb: number
}

/**
 * Execute a GraphQL query against RunPod.
 */
export async function fetchRunPodGraphQL<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const config = useRuntimeConfig()
  const apiKey = config.runpodApiKey || process.env.RUNPOD_API_KEY || process.env.AI_API_KEY
  
  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'RunPod API Key is not configured (RUNPOD_API_KEY / AI_API_KEY)' })
  }

  const response = await $fetch<{ data: T; errors?: any[] }>('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: { query, variables },
  })

  if (response.errors && response.errors.length > 0) {
    console.error('RunPod GraphQL Error:', response.errors)
    throw createError({ statusCode: 502, statusMessage: response.errors[0].message })
  }

  return response.data
}

/**
 * Get all pods for the current user.
 */
export async function getRunPods(): Promise<RunPodInfo[]> {
  const query = `
    query {
      myself {
        pods {
          id
          name
          desiredStatus
          runtime {
            uptimeInSeconds
            gpus {
              id
              gpuUtilPercent
              memoryUtilPercent
            }
            container {
              cpuPercent
              memoryPercent
            }
            ports {
              ip
              isIpPublic
              privatePort
              publicPort
              type
            }
          }
          volumeInGb
          volumeMountPath
          containerDiskInGb
          machine {
            gpuDisplayName
            costPerHr
          }
          gpuCount
          vcpuCount
          memoryInGb
          machineId
          podType
          costPerHr
        }
      }
    }
  `

  const data = await fetchRunPodGraphQL<any>(query)
  
  return data.myself.pods.map((pod: any) => {
    const gpus = pod.runtime?.gpus || []
    const avgGpuUtil = gpus.length > 0
      ? gpus.reduce((sum: number, g: any) => sum + (g.gpuUtilPercent || 0), 0) / gpus.length
      : 0
    const avgGpuMemUtil = gpus.length > 0
      ? gpus.reduce((sum: number, g: any) => sum + (g.memoryUtilPercent || 0), 0) / gpus.length
      : 0
    const container = pod.runtime?.container || {}

    return {
      id: pod.id,
      name: pod.name,
      status: pod.desiredStatus,
      uptimeSeconds: pod.runtime?.uptimeInSeconds || 0,
      ip: pod.runtime?.ports?.[0]?.ip || '',
      ports: pod.runtime?.ports?.map((p: any) => `${p.publicPort}->${p.privatePort}`).join(', ') || '',
      podType: pod.podType,
      machineId: pod.machineId,
      // Metrics
      gpuName: pod.machine?.gpuDisplayName || '',
      gpuCount: pod.gpuCount || 1,
      gpuUtilPercent: Math.round(avgGpuUtil),
      gpuMemoryPercent: Math.round(avgGpuMemUtil),
      cpuUtilPercent: Math.round(container.cpuPercent || 0),
      memoryPercent: Math.round(container.memoryPercent || 0),
      memoryTotalGb: pod.memoryInGb || 0,
      memoryUsedGb: Math.round(((container.memoryPercent || 0) / 100) * (pod.memoryInGb || 0) * 10) / 10,
      diskUsedGb: 0,
      diskTotalGb: (pod.volumeInGb || 0) + (pod.containerDiskInGb || 0),
      vcpuCount: pod.vcpuCount || 0,
      costPerHr: pod.costPerHr || pod.machine?.costPerHr || 0,
      volumeInGb: pod.volumeInGb || 0,
      containerDiskInGb: pod.containerDiskInGb || 0,
    }
  })
}

/**
 * Start (Resume) a stopped pod.
 */
export async function startRunPod(podId: string): Promise<void> {
  const query = `
    mutation($input: PodResumeInput!) {
      podResume(input: $input) {
        id
        desiredStatus
      }
    }
  `
  await fetchRunPodGraphQL(query, { input: { podId, gpuCount: 1 } })
}

/**
 * Stop a running pod.
 */
export async function stopRunPod(podId: string): Promise<void> {
  const query = `
    mutation($input: PodStopInput!) {
      podStop(input: $input) {
        id
        desiredStatus
      }
    }
  `
  await fetchRunPodGraphQL(query, { input: { podId } })
}

/**
 * Terminate (permanently delete) a pod.
 */
export async function terminateRunPod(podId: string): Promise<void> {
  const query = `
    mutation($input: PodTerminateInput!) {
      podTerminate(input: $input)
    }
  `
  await fetchRunPodGraphQL(query, { input: { podId } })
}

/**
 * Get available RunPod templates and GPU types.
 */
export async function getRunPodOptions(): Promise<{ templates: any[], gpuTypes: any[], dataCenters: any[] }> {
  const query = `
    query {
      myself {
        podTemplates {
          id
          name
          imageName
        }
      }
      gpuTypes {
        id
        displayName
        memoryInGb
        securePrice
        communityPrice
      }
      dataCenters {
        id
        name
      }
    }
  `
  const data = await fetchRunPodGraphQL<any>(query)
  return {
    templates: data.myself?.podTemplates || [],
    gpuTypes: data.gpuTypes || [],
    dataCenters: data.dataCenters || []
  }
}

/**
 * Deploy a new pod on demand with automated setup.
 *
 * Injects env vars (GITHUB_PAT, MODEL_GROUPS) and a dockerArgs command
 * that clones the repo and runs bootstrap.sh on first boot.
 */
export async function deployRunPod(
  name: string,
  templateId: string,
  gpuTypeId: string,
  gpuCount: number,
  options?: {
    cloudType?: string,
    dataCenterId?: string,
    volumeInGb?: number,
    containerDiskInGb?: number,
    modelGroups?: string[],
  }
): Promise<string> {
  const config = useRuntimeConfig() as any
  const githubPat = config.githubPat || process.env.GITHUB_PAT || ''
  const repoUrl = 'loganrenz/ai-media-gen'
  const modelGroups = options?.modelGroups || []

  const query = `
    mutation($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
      }
    }
  `

  // Build the bootstrap one-liner that runs as dockerArgs.
  // It clones the repo using GITHUB_PAT and runs bootstrap.sh.
  const bootstrapCmd = [
    'bash -c \'',
    'apt-get update -qq && apt-get install -y -qq git > /dev/null 2>&1;',
    'REPO_DIR=/workspace/_repo;',
    'if [ -d "$REPO_DIR/.git" ]; then cd "$REPO_DIR" && git pull --ff-only 2>/dev/null || true;',
    'else git clone --depth 1 https://${GITHUB_PAT}@github.com/${REPO_URL}.git "$REPO_DIR"; fi;',
    'bash "$REPO_DIR/pod/scripts/bootstrap.sh"',
    '\'',
  ].join(' ')

  // Estimated sizes per group (GB) for auto volume sizing
  const GROUP_SIZE_GB: Record<string, number> = {
    juggernaut: 7, pony: 7, qwen: 12, flux2: 15,
    z_image: 10, z_image_turbo: 8, wan22: 40, ltx2: 25,
    ltx2_camera: 2, upscale: 1, shared: 8,
  }
  const estimatedSize = modelGroups.length > 0
    ? modelGroups.reduce((sum, g) => sum + (GROUP_SIZE_GB[g] || 5), 0)
    : 120 // default: full ~120GB
  const defaultVolume = Math.ceil(estimatedSize * 1.3) // 30% headroom

  const input: any = {
    gpuCount,
    volumeInGb: options?.volumeInGb || defaultVolume,
    containerDiskInGb: options?.containerDiskInGb || 40,
    minVcpuCount: 2,
    minMemoryInGb: 15,
    gpuTypeId,
    name,
    templateId,
    env: [
      { key: 'GITHUB_PAT', value: githubPat },
      { key: 'MODEL_GROUPS', value: modelGroups.join(',') },
      { key: 'REPO_URL', value: repoUrl },
    ],
    dockerArgs: bootstrapCmd,
  }

  if (options?.cloudType) {
    input.cloudType = options.cloudType
  } else {
    input.cloudType = "ALL"
  }

  if (options?.dataCenterId && options.dataCenterId !== 'ANY') {
    input.dataCenterId = options.dataCenterId
  }

  const data = await fetchRunPodGraphQL<any>(query, { input })
  return data.podFindAndDeployOnDemand.id
}
