/**
 * parseItemMeta — safely parse the JSON metadata string on a media item.
 *
 * pattern scattered across queue processing, background completion, and API routes.
 */

export interface MediaItemMeta {
  comfyInput?: Record<string, unknown>
  pendingCaptioning?: boolean
  anyMachine?: boolean
  apiUrl?: string
  podUrl?: string
  podJobId?: string
  _retryCount?: number
  _retryAfter?: number
  _failedPods?: string[]
  _lastError?: string
  [key: string]: unknown
}

export function parseItemMeta(item: { metadata?: string | null }): MediaItemMeta {
  if (!item.metadata) return {}
  try {
    return JSON.parse(item.metadata) as MediaItemMeta
  } catch {
    return {}
  }
}
