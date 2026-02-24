/**
 * Types matching the flattened shape returned by GET /api/generations.
 * The API spreads generation columns at the top level alongside items.
 */

export interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
  prompt?: string | null
  qualityScore?: number | null
}

export interface GenerationResult {
  id: string
  prompt: string
  imageCount: number
  status: string
  settings?: string | null
  createdAt: string
  items: MediaItemResult[]
}
