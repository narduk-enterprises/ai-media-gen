import { fetchRunPodGraphQL } from '../../utils/runpod'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const gpuType = query.gpuType as string
  const gpuCount = parseInt(query.gpuCount as string) || 1
  const dcs = query.dataCenters as string

  if (!gpuType || !dcs) {
    throw createError({ statusCode: 400, statusMessage: 'gpuType and dataCenters are required' })
  }

  const dataCenters = dcs.split(',')
  
  // Chunking the datacenters into groups of 11 to avoid 500 Internal Server Errors from RunPod
  // due to overloading their pricing resolver with too many nested fields in a single query.
  const numChunks = 4
  const chunkSize = Math.ceil(dataCenters.length / numChunks)
  const promises = []

  for (let i = 0; i < dataCenters.length; i += chunkSize) {
    const chunk = dataCenters.slice(i, i + chunkSize)
    const aliases = chunk.map(dc => {
      const alias = dc.replace(/-/g, '_')
      return `${alias}: lowestPrice(input: {gpuCount: ${gpuCount}, dataCenterId: "${dc}"}) { uninterruptablePrice }`
    }).join('\n')

    const gql = `
      query {
        gpuTypes {
          id
          ${aliases}
        }
      }
    `
    promises.push(fetchRunPodGraphQL<any>(gql))
  }

  const results = await Promise.all(promises)
  const availableDatacenters: string[] = []

  results.forEach(res => {
    // extract just our target GPU from the massive payload response
    const gpuInfo = res.gpuTypes?.find((x: any) => x.id === gpuType)
    if (gpuInfo) {
      Object.keys(gpuInfo).forEach(k => {
        if (k !== 'id' && gpuInfo[k]?.uninterruptablePrice) {
          availableDatacenters.push(k.replace(/_/g, '-'))
        }
      })
    }
  })

  return { available: availableDatacenters }
})
