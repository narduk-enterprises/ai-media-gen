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
            ports {
              ip
              isIpPublic
              privatePort
              publicPort
              type
            }
          }
          machineId
          podType
        }
      }
    }
  `

  const data = await fetchRunPodGraphQL<any>(query)
  
  return data.myself.pods.map((pod: any) => {
    return {
      id: pod.id,
      name: pod.name,
      status: pod.desiredStatus,
      uptimeSeconds: pod.runtime?.uptimeInSeconds || 0,
      ip: pod.runtime?.ports?.[0]?.ip || '',
      ports: pod.runtime?.ports?.map((p: any) => `${p.publicPort}->${p.privatePort}`).join(', ') || '',
      podType: pod.podType,
      machineId: pod.machineId,
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
 * Deploy a new pod on demand.
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
    containerDiskInGb?: number
  }
): Promise<string> {
  const query = `
    mutation($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
      }
    }
  `
  
  const input: any = {
    gpuCount,
    volumeInGb: options?.volumeInGb || 50,
    containerDiskInGb: options?.containerDiskInGb || 25,
    minVcpuCount: 2,
    minMemoryInGb: 15,
    gpuTypeId,
    name,
    templateId
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
