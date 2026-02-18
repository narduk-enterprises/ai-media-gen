export interface MediaItemResult {
  id: string
  type: string
  url: string | null
  status: string
  parentId: string | null
  qualityScore: number | null
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
