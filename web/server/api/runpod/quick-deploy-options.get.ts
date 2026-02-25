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

  // Filter to GPUs that have stock (lowestPrice exists and > 0) and sort cheapest first
  const gpus = (data.gpuTypes || [])
    .filter((g: any) => g.lowestPrice?.uninterruptablePrice > 0 || g.lowestPrice?.minimumBidPrice > 0)
    .map((g: any) => ({
      id: g.id,
      name: g.displayName,
      vram: g.memoryInGb,
      securePrice: g.securePrice,
      communityPrice: g.communityPrice,
      lowestPrice: g.lowestPrice?.uninterruptablePrice ? g.lowestPrice.uninterruptablePrice / 100 : (g.lowestPrice?.minimumBidPrice ? g.lowestPrice.minimumBidPrice / 100 : null),
      spotPrice: g.lowestPrice?.minimumBidPrice ? g.lowestPrice.minimumBidPrice / 100 : null,
    }))
    .sort((a: any, b: any) => (a.lowestPrice || 999) - (b.lowestPrice || 999))

  return {
    gpus,
    templateId: defaultTemplate?.id || templates[0]?.id || '',
    templateName: defaultTemplate?.name || templates[0]?.name || '',
  }
})
