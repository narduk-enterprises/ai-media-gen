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
 * Refine a raw prompt using Workers AI LLM.
 * Uses high temperature for creative variety.
 */
export async function refineWithLLM(
  rawPrompt: string,
  ai: any,
): Promise<string> {
  if (!ai) return rawPrompt // fallback if no AI binding

  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'You are a creative prompt engineer for AI image and video generation. Enhance the given prompt into a vivid, detailed description while preserving its core meaning. Add sensory details, atmosphere, and specific visual elements. Vary your style for uniqueness. Output ONLY the enhanced prompt, nothing else.',
        },
        {
          role: 'user',
          content: `Enhance into a vivid description: ${rawPrompt}`,
        },
      ],
      temperature: 0.9,
      max_tokens: 256,
    })

    const refined = response?.response?.trim()
    return refined || rawPrompt
  } catch (e: any) {
    console.warn(`[PromptGen] LLM refinement failed: ${e.message}`)
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
