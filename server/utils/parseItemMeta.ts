/**
 * parseItemMeta — safely parse the JSON metadata string on a media item.
 *
 * Replaces the repeated `try { meta = item.metadata ? JSON.parse(item.metadata) : {} } catch {}`
 * pattern scattered across queue processing, background completion, and API routes.
 */
export function parseItemMeta(item: { metadata?: string | null }): Record<string, any> {
  if (!item.metadata) return {}
  try {
    return JSON.parse(item.metadata)
  } catch {
    return {}
  }
}
