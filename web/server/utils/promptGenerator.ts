/**
 * promptGenerator.ts — Core prompt generation service.
 *
 * Pipeline: random template → weighted attribute fill → LLM refinement → similarity check → store.
 */
import { eq, desc, asc, sql } from 'drizzle-orm'
import { promptTemplates, promptAttributes, promptGenerationLog, promptCache } from '../database/schema'

// ─── Weighted Random Selection ──────────────────────────────

interface WeightedItem {
  value: string
  weight: number
}

/**
 * Select a random item using cumulative weight distribution.
 * Higher weight = higher probability of selection.
 */
export function weightedRandom(items: WeightedItem[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!.value

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  let random = Math.random() * totalWeight
  for (const item of items) {
    random -= item.weight
    if (random <= 0) return item.value
  }
  return items[items.length - 1]!.value
}

// ─── Template Slot Filling ──────────────────────────────────

/**
 * Extract slot names from a template string.
 * e.g. "A [adjective] [subject] in [setting]" → ['adjective', 'subject', 'setting']
 */
export function extractSlots(template: string): string[] {
  const matches = template.match(/\[([^\]]+)\]/g)
  if (!matches) return []
  return matches.map(m => m.slice(1, -1))
}

/**
 * Fill template slots with values from the attributes map.
 */
export function fillTemplate(
  template: string,
  attributesByCategory: Record<string, WeightedItem[]>,
): string {
  return template.replace(/\[([^\]]+)\]/g, (_, slotName: string) => {
    const items = attributesByCategory[slotName]
    if (!items || items.length === 0) return `[${slotName}]` // leave unfilled if no attrs
    return weightedRandom(items)
  })
}

// ─── Similarity Hashing ─────────────────────────────────────

/**
 * Compute a simple bigram-based hash for similarity checking.
 * Not cryptographic — used for fast dedup of recent generations.
 */
export function computeSimilarityHash(text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const words = normalized.split(/\s+/).sort()
  // Take first 8 sorted words as the "signature"
  return words.slice(0, 8).join('_')
}

/**
 * Check if a similar prompt was generated recently.
 */
export async function isDuplicate(
  db: any,
  hash: string,
  lookbackCount: number = 50,
): Promise<boolean> {
  const recent = await db
    .select({ similarityHash: promptGenerationLog.similarityHash })
    .from(promptGenerationLog)
    .orderBy(desc(promptGenerationLog.createdAt))
    .limit(lookbackCount)

  return recent.some((row: any) => row.similarityHash === hash)
}

// ─── LLM Refinement ─────────────────────────────────────────

/**
 * Refine a raw prompt using the GPU pod's Qwen 2.5 3B model.
 * Calls /generate/refine-prompt on the pod for unrestricted creative enhancement.
 */
export async function refineWithLLM(
  rawPrompt: string,
  _ai?: any, // kept for backward compat but no longer used
): Promise<string> {
  try {
    const { resolveApiUrl } = await import('./ai')
    const podUrl = await resolveApiUrl(undefined, undefined, ['shared'])

    const response = await $fetch<{ refined_prompt: string; elapsed_seconds: number }>(
      `${podUrl}/generate/refine-prompt`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { prompt: rawPrompt, temperature: 0.9 },
        timeout: 60_000,
      },
    )

    const refined = response?.refined_prompt?.trim()
    return refined || rawPrompt
  } catch (e: any) {
    console.warn(`[PromptGen] Pod LLM refinement failed: ${e.message}`)
    return rawPrompt
  }
}

// ─── Main Generator Pipeline ────────────────────────────────

export interface GenerateResult {
  id: string
  templateId: string | null
  templateName: string | null
  rawPrompt: string
  refinedPrompt: string
  similarityHash: string
}

/**
 * Full prompt generation pipeline:
 * 1. Pick random active template
 * 2. Fetch active attributes grouped by category
 * 3. Fill template with weighted random attributes
 * 4. Refine with LLM
 * 5. Check for similarity / deduplicate
 * 6. Store in generation log
 */
export async function generatePrompt(
  db: any,
  ai: any,
  userId?: string,
  maxRetries: number = 3,
): Promise<GenerateResult> {
  // ── Step 0: Try to consume a cached prompt first ──────────
  const cached = await db
    .select()
    .from(promptCache)
    .orderBy(asc(promptCache.createdAt))
    .limit(1)

  if (cached.length > 0) {
    const entry = cached[0]!
    // Delete from cache (consume it)
    await db.delete(promptCache).where(eq(promptCache.id, entry.id))

    // Copy to generation log for history tracking
    const logId = crypto.randomUUID()
    await db.insert(promptGenerationLog).values({
      id: logId,
      templateId: entry.templateId,
      rawPrompt: entry.rawPrompt,
      refinedPrompt: entry.refinedPrompt,
      similarityHash: entry.similarityHash,
      userId: userId || null,
      createdAt: new Date().toISOString(),
    })

    // Auto-refill: top up cache to 100 in the background
    autoRefillCache(db, ai).catch(e => console.warn(`[PromptGen] Background refill failed: ${e.message}`))

    console.log(`[PromptGen] Served from cache (id=${entry.id})`)
    return {
      id: logId,
      templateId: entry.templateId,
      templateName: entry.templateName,
      rawPrompt: entry.rawPrompt,
      refinedPrompt: entry.refinedPrompt,
      similarityHash: entry.similarityHash,
    }
  }

  // ── Fallback: live generation ─────────────────────────────
  console.log('[PromptGen] Cache empty, generating live...')

  // 1. Fetch a random active template
  const templates = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.isActive, true))

  if (templates.length === 0) {
    throw new Error('No active templates found. Create at least one template first.')
  }

  const template = templates[Math.floor(Math.random() * templates.length)]!

  // 2. Fetch all active attributes grouped by category
  const allAttrs = await db
    .select({
      category: promptAttributes.category,
      value: promptAttributes.value,
      weight: promptAttributes.weight,
    })
    .from(promptAttributes)
    .where(eq(promptAttributes.isActive, true))

  const attrsByCategory: Record<string, WeightedItem[]> = {}
  for (const attr of allAttrs) {
    if (!attrsByCategory[attr.category]) {
      attrsByCategory[attr.category] = []
    }
    attrsByCategory[attr.category]!.push({ value: attr.value, weight: attr.weight ?? 1.0 })
  }

  // 3 & 4 & 5. Fill, refine, check — with retry on similarity
  let rawPrompt = ''
  let refinedPrompt = ''
  let similarityHash = ''

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    rawPrompt = fillTemplate(template.template, attrsByCategory)
    refinedPrompt = await refineWithLLM(rawPrompt, ai)
    similarityHash = computeSimilarityHash(refinedPrompt)

    const duplicate = await isDuplicate(db, similarityHash)
    if (!duplicate) break

    if (attempt === maxRetries - 1) {
      // Last attempt — use it anyway
      console.warn(`[PromptGen] Could not avoid similarity after ${maxRetries} attempts, using last result`)
    }
  }

  // 6. Store in generation log
  const id = crypto.randomUUID()
  await db.insert(promptGenerationLog).values({
    id,
    templateId: template.id,
    rawPrompt,
    refinedPrompt,
    similarityHash,
    userId: userId || null,
    createdAt: new Date().toISOString(),
  })

  return {
    id,
    templateId: template.id,
    templateName: template.name,
    rawPrompt,
    refinedPrompt,
    similarityHash,
  }
}

// ─── Cache Fill ─────────────────────────────────────────────

/**
 * Pre-generate prompts and store them in the cache table.
 * Used by the fill-cache admin endpoint.
 */
export async function fillPromptCache(
  db: any,
  ai: any,
  count: number = 10,
): Promise<number> {
  const templates = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.isActive, true))

  if (templates.length === 0) {
    throw new Error('No active templates found. Create at least one template first.')
  }

  const allAttrs = await db
    .select({
      category: promptAttributes.category,
      value: promptAttributes.value,
      weight: promptAttributes.weight,
    })
    .from(promptAttributes)
    .where(eq(promptAttributes.isActive, true))

  const attrsByCategory: Record<string, WeightedItem[]> = {}
  for (const attr of allAttrs) {
    if (!attrsByCategory[attr.category]) {
      attrsByCategory[attr.category] = []
    }
    attrsByCategory[attr.category]!.push({ value: attr.value, weight: attr.weight ?? 1.0 })
  }

  let added = 0
  for (let i = 0; i < count; i++) {
    const template = templates[Math.floor(Math.random() * templates.length)]!
    const rawPrompt = fillTemplate(template.template, attrsByCategory)
    const refinedPrompt = await refineWithLLM(rawPrompt, ai)
    const similarityHash = computeSimilarityHash(refinedPrompt)

    await db.insert(promptCache).values({
      id: crypto.randomUUID(),
      templateId: template.id,
      templateName: template.name,
      rawPrompt,
      refinedPrompt,
      similarityHash,
      createdAt: new Date().toISOString(),
    })
    added++
  }

  console.log(`[PromptGen] Filled cache with ${added} prompts`)
  return added
}

// ─── Auto-Refill ────────────────────────────────────────────

const CACHE_TARGET = 100
let isRefilling = false

/**
 * Check cache count and top up to CACHE_TARGET if below.
 * Uses an in-memory lock to prevent concurrent refill storms.
 */
async function autoRefillCache(db: any, ai: any): Promise<void> {
  if (isRefilling) return // already refilling

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(promptCache)

  const current = countResult[0]?.count ?? 0
  if (current >= CACHE_TARGET) return // already full

  const deficit = CACHE_TARGET - current
  console.log(`[PromptGen] Cache at ${current}/${CACHE_TARGET}, refilling ${deficit} prompts...`)

  isRefilling = true
  try {
    await fillPromptCache(db, ai, deficit)
  } finally {
    isRefilling = false
  }
}
