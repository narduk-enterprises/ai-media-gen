/**
 * GET /api/runpod/quick-deploy-options
 *
 * Returns all GPU types with real-time pricing (lowestPrice) and the
 * user's templates, for the Quick Deploy feature.
 * GPUs are sorted cheapest-first and filtered to those with stock.
 */
import { fetchRunPodGraphQL } from '../../utils/runpod'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const query = `
    query {
      myself {
        podTemplates {
          id
          name
        }
      }
      gpuTypes {
        id
        displayName
        memoryInGb
        securePrice
        communityPrice
        lowestPrice(input: { gpuCount: 1 }) {
          minimumBidPrice
          uninterruptablePrice
        }
      }
    }
  `

  const data = await fetchRunPodGraphQL<any>(query)

  const templates = (data.myself?.podTemplates || []).map((t: any) => ({
    id: t.id,
    name: t.name,
  }))

  // Find the default template
  const defaultTemplate = templates.find((t: any) => t.name.includes('ai-media-gen'))

  // Heuristic speed scores for common RunPod GPUs (higher = faster AI generation)
  const GPU_SPEED_SCORES: Record<string, number> = {
    'NVIDIA H100 80GB HBM3': 250,
    'NVIDIA H100 PCIe': 200,
    'NVIDIA A100 80GB PCIe': 150,
    'NVIDIA A100-SXM4-80GB': 150,
    'NVIDIA A100-PCIE-40GB': 120,
    'NVIDIA RTX 6000 Ada Generation': 110,
    'NVIDIA GeForce RTX 4090': 100,
    'NVIDIA L40S': 100,
    'NVIDIA L40': 80,
    'NVIDIA GeForce RTX 3090 Ti': 75,
    'NVIDIA RTX A6000': 70,
    'NVIDIA GeForce RTX 3090': 70,
    'NVIDIA GeForce RTX 4080': 60,
    'NVIDIA RTX A5000': 50,
    'NVIDIA GeForce RTX 3080 Ti': 50,
    'NVIDIA RTX 4000 Ada Generation': 50,
    'NVIDIA GeForce RTX 3080': 45,
    'NVIDIA RTX A4500': 40,
    'NVIDIA RTX A4000': 30,
    'NVIDIA GeForce RTX 3070': 30,
    'NVIDIA TITAN RTX': 30,
    'Tesla V100-SXM2-32GB': 25,
    'Tesla V100-PCIE-16GB': 20,
    'Tesla V100-SXM2-16GB': 20,
    'NVIDIA RTX A2000': 15,
  }

  const getSpeedScore = (name: string) => Math.max(10, GPU_SPEED_SCORES[name] || 20)

  // Filter to GPUs that have stock (lowestPrice exists and > 0) and sort cheapest first
  const gpus = (data.gpuTypes || [])
    .filter((g: any) => g.lowestPrice?.uninterruptablePrice > 0 || g.lowestPrice?.minimumBidPrice > 0)
    .map((g: any) => {
      const price = g.lowestPrice?.uninterruptablePrice ? g.lowestPrice.uninterruptablePrice / 100 : (g.lowestPrice?.minimumBidPrice ? g.lowestPrice.minimumBidPrice / 100 : null)
      const spot = g.lowestPrice?.minimumBidPrice ? g.lowestPrice.minimumBidPrice / 100 : null
      const speedScore = getSpeedScore(g.displayName)
      // valueScore is speed per dollar. If price is 0, give it a massive score.
      const valueScore = price ? Math.round(speedScore / price) : 9999
      
      return {
        id: g.id,
        name: g.displayName,
        vram: g.memoryInGb,
        securePrice: g.securePrice,
        communityPrice: g.communityPrice,
        lowestPrice: price,
        spotPrice: spot,
        speedScore,
        valueScore,
      }
    })
    .sort((a: any, b: any) => (a.lowestPrice || 999) - (b.lowestPrice || 999))

  return {
    gpus,
    templateId: defaultTemplate?.id || templates[0]?.id || '',
    templateName: defaultTemplate?.name || templates[0]?.name || '',
  }
})
