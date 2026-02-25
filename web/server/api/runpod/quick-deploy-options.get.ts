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
    'AMD Instinct MI300X OAM': 250,
    'NVIDIA B200': 300,
    'NVIDIA B300 SXM6 AC': 350,
    'NVIDIA H200': 280,
    'NVIDIA H200 NVL': 280,
    'NVIDIA H100 80GB HBM3': 250,
    'NVIDIA H100 NVL': 250,
    'NVIDIA H100 PCIe': 200,
    'NVIDIA A100 80GB PCIe': 150,
    'NVIDIA A100-SXM4-80GB': 150,
    'NVIDIA A100-PCIE-40GB': 120,
    'NVIDIA RTX PRO 6000 Blackwell Server Edition': 180,
    'NVIDIA RTX PRO 6000 Blackwell Workstation Edition': 180,
    'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition': 160,
    'NVIDIA RTX PRO 4500 Blackwell': 120,
    'NVIDIA GeForce RTX 5090': 220,
    'NVIDIA GeForce RTX 5080': 160,
    'NVIDIA RTX 6000 Ada Generation': 110,
    'NVIDIA RTX 5000 Ada Generation': 90,
    'NVIDIA GeForce RTX 4090': 100,
    'NVIDIA L40S': 100,
    'NVIDIA L40': 80,
    'NVIDIA GeForce RTX 3090 Ti': 75,
    'NVIDIA RTX A6000': 70,
    'NVIDIA GeForce RTX 3090': 70,
    'NVIDIA GeForce RTX 4080 SUPER': 65,
    'NVIDIA GeForce RTX 4080': 60,
    'NVIDIA GeForce RTX 4070 Ti': 50,
    'NVIDIA RTX 4000 Ada Generation': 50,
    'NVIDIA RTX 4000 SFF Ada Generation': 45,
    'NVIDIA RTX A5000': 50,
    'NVIDIA GeForce RTX 3080 Ti': 50,
    'NVIDIA GeForce RTX 3080': 45,
    'NVIDIA RTX A4500': 40,
    'NVIDIA L4': 35,
    'NVIDIA RTX A4000': 30,
    'NVIDIA A40': 35,
    'NVIDIA A30': 30,
    'NVIDIA GeForce RTX 3070': 30,
    'NVIDIA TITAN RTX': 30,
    'Tesla V100-SXM2-32GB': 25,
    'Tesla V100-PCIE-16GB': 20,
    'Tesla V100-SXM2-16GB': 20,
    'NVIDIA RTX 2000 Ada Generation': 20,
    'NVIDIA RTX A2000': 15,
  }

  const getSpeedScore = (name: string) => Math.max(10, GPU_SPEED_SCORES[name] || 20)

  // Filter to GPUs that have either community or secure pricing and sort by community price first
  const gpus = (data.gpuTypes || [])
    .filter((g: any) => g.communityPrice > 0 || g.securePrice > 0 || g.lowestPrice?.uninterruptablePrice > 0)
    .map((g: any) => {
      // Prioritize community price, fallback to lowest price uninterruptable, then secure
      const price = g.communityPrice > 0 ? g.communityPrice : (g.lowestPrice?.uninterruptablePrice || g.securePrice)
      
      const spot = g.lowestPrice?.minimumBidPrice || null
      const speedScore = getSpeedScore(g.displayName)
      
      // valueScore is speed per dollar based on the community/primary price.
      const valueScore = price ? Math.round(speedScore / price) : (speedScore * 100) // Huge value if somehow 0
      
      return {
        id: g.id,
        name: g.displayName,
        vram: g.memoryInGb,
        securePrice: g.securePrice > 0 ? g.securePrice : null,
        communityPrice: g.communityPrice > 0 ? g.communityPrice : null,
        spotPrice: spot,
        price, // The primary price we use for sorting and value
        speedScore,
        valueScore,
      }
    })
    .sort((a: any, b: any) => {
       // Sort by primary price (which prefers community) ascending
       const priceA = a.price || 9999
       const priceB = b.price || 9999
       if (priceA !== priceB) return priceA - priceB
       // If prices are equal, sort by speed descending
       return b.speedScore - a.speedScore
    })

  return {
    gpus,
    templateId: defaultTemplate?.id || templates[0]?.id || '',
    templateName: defaultTemplate?.name || templates[0]?.name || '',
  }
})
