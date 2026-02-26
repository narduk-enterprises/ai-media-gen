import { eq, and, or, asc, sql, isNull } from 'drizzle-orm'
import {
  promptTemplates,
  promptAttributes,
  promptGenerationLog,
  promptCache,
} from '../database/schema'

// ─── Weighted Random Selection ──────────────────────────────

interface WeightedItem {
  value: string
  weight: number
}

function weightedRandom(items: WeightedItem[]): string {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  let random = Math.random() * totalWeight

  for (const item of items) {
    random -= item.weight
    if (random <= 0) return item.value
  }

  return items[items.length - 1]!.value
}

// ─── Template Filling ───────────────────────────────────────

/**
 * Replace [placeholder] tags in a template with randomly selected attributes.
 */
function fillTemplate(
  template: string,
  attrsByCategory: Record<string, WeightedItem[]>,
): string {
  return template.replace(/\[([^\]]+)\]/g, (match, category) => {
    const items = attrsByCategory[category]
    if (!items || items.length === 0) return match
    return weightedRandom(items)
  })
}

// ─── Similarity Detection ───────────────────────────────────

/**
 * Lightweight similarity hash from the key nouns/adjectives in a prompt.
 * Sort them alphabetically so order doesn't matter.
 */
export function computeSimilarityHash(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3) // ignore tiny words
    .sort()

  // Take every 3rd word to create a sparse fingerprint
  const sparse = words.filter((_, i) => i % 3 === 0).join('|')
  return sparse
}

/**
 * Check if a similar prompt was generated recently.
 */
async function isDuplicate(db: any, hash: string): Promise<boolean> {
  const existing = await db
    .select({ id: promptGenerationLog.id })
    .from(promptGenerationLog)
    .where(eq(promptGenerationLog.similarityHash, hash))
    .limit(1)

  return existing.length > 0
}

// ─── LLM Refinement ─────────────────────────────────────────

export interface RefineResult {
  text: string
  wasRefined: boolean
  refineError?: string
}

/**
 * Refine a raw prompt using the GPU pod's Qwen 2.5 3B model.
 * Calls /generate/refine-prompt on the pod for unrestricted creative enhancement.
 * Returns { text, wasRefined } so callers know if LLM actually enhanced it.
 */
export async function refineWithLLM(
  rawPrompt: string,
  _ai?: any, // kept for backward compat but no longer used
): Promise<RefineResult> {
  try {
    const { resolveApiUrl } = await import('./ai')
    const podUrl = await resolveApiUrl(undefined, undefined, ['prompt_refine'])

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
    if (refined && refined !== rawPrompt) {
      return { text: refined, wasRefined: true }
    }
    // Pod returned same text or empty — treat as unrefined
    return { text: rawPrompt, wasRefined: false, refineError: 'Pod returned same or empty text' }
  } catch (e: any) {
    const errMsg = e?.message || e?.statusMessage || String(e)
    console.warn(`[PromptGen] Pod LLM refinement failed: ${errMsg}`)
    return { text: rawPrompt, wasRefined: false, refineError: errMsg }
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
  mediaType?: string
  modelHint?: string | null
  wasRefined?: boolean
  refineError?: string
}

export interface GenerateOptions {
  mediaType?: 'image' | 'video' | 'any'
  modelHint?: string | null
}

/**
 * Full prompt generation pipeline:
 * 1. Pick random active template (filtered by media type + model hint)
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
  options?: GenerateOptions,
  event?: any,
): Promise<GenerateResult> {
  const mediaType = options?.mediaType || 'any'
  const modelHint = options?.modelHint || null

  // ── Step 0: Try to consume a cached prompt first ──────────
  // Build cache query conditions for media type match
  const cacheConditions = []
  if (mediaType !== 'any') {
    // Match exact type OR 'any' (generic templates work for everything)
    cacheConditions.push(
      or(
        eq(promptCache.mediaType, mediaType),
        eq(promptCache.mediaType, 'any'),
      ),
    )
  }
  if (modelHint) {
    // Match model hint OR null (generic templates work for any model)
    cacheConditions.push(
      or(
        eq(promptCache.modelHint, modelHint),
        isNull(promptCache.modelHint),
      ),
    )
  }

  const cacheQuery = cacheConditions.length > 0
    ? db.select().from(promptCache).where(and(...cacheConditions)).orderBy(asc(promptCache.createdAt)).limit(1)
    : db.select().from(promptCache).orderBy(asc(promptCache.createdAt)).limit(1)

  const cached = await cacheQuery

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

    // Auto-refill: top up cache in the background
    const refillPromise = autoRefillCache(db, ai).catch(e => console.warn(`[PromptGen] Background refill failed: ${e.message}`))
    if (event?.waitUntil) {
      event.waitUntil(refillPromise)
    }

    console.log(`[PromptGen] Served from cache (id=${entry.id}, type=${entry.mediaType || 'any'})`)
    return {
      id: logId,
      templateId: entry.templateId,
      templateName: entry.templateName,
      rawPrompt: entry.rawPrompt,
      refinedPrompt: entry.refinedPrompt,
      similarityHash: entry.similarityHash,
      mediaType: entry.mediaType || 'any',
      modelHint: entry.modelHint,
      wasRefined: true, // cached prompts are always refined
    }
  }

  // ── Cache was empty — kick off background refill ──────────
  const refillPromise = autoRefillCache(db, ai).catch(e => console.warn(`[PromptGen] Background refill failed: ${e.message}`))
  if (event?.waitUntil) {
    event.waitUntil(refillPromise)
  }

  // ── Fallback: live generation ─────────────────────────────
  console.log(`[PromptGen] Cache empty for type=${mediaType}, generating live...`)

  // 1. Fetch templates filtered by media type + model hint
  const templateConditions = [eq(promptTemplates.isActive, true)]

  if (mediaType !== 'any') {
    templateConditions.push(
      or(
        eq(promptTemplates.mediaType, mediaType),
        eq(promptTemplates.mediaType, 'any'),
      )! as any,
    )
  }
  if (modelHint) {
    templateConditions.push(
      or(
        eq(promptTemplates.modelHint, modelHint),
        isNull(promptTemplates.modelHint),
      )! as any,
    )
  }

  const templates = await db
    .select()
    .from(promptTemplates)
    .where(and(...templateConditions))

  if (templates.length === 0) {
    // Fall back to all active templates if none match the filter
    const fallback = await db.select().from(promptTemplates).where(eq(promptTemplates.isActive, true))
    if (fallback.length === 0) {
      throw new Error('No active templates found. Create at least one template first.')
    }
    templates.push(...fallback)
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

  let refineError: string | undefined
  let wasRefined = false
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    rawPrompt = fillTemplate(template.template, attrsByCategory)
    const refineResult = await refineWithLLM(rawPrompt, ai)
    refinedPrompt = refineResult.text
    wasRefined = refineResult.wasRefined
    refineError = refineResult.refineError
    similarityHash = computeSimilarityHash(refinedPrompt)

    const duplicate = await isDuplicate(db, similarityHash)
    if (!duplicate) break

    if (attempt === maxRetries - 1) {
      // Last attempt — use it anyway
      console.warn(`[PromptGen] Could not avoid similarity after ${maxRetries} attempts, using last result`)
    }
  }

  if (!wasRefined) {
    console.warn(`[PromptGen] ⚠️ Serving UNREFINED prompt (pod unavailable) — raw template output`)
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
    mediaType: template.mediaType || 'any',
    modelHint: template.modelHint,
    wasRefined,
    refineError,
  }
}

// ─── Cache Fill ─────────────────────────────────────────────

/**
 * Pre-generate prompts and store them in the cache table.
 * Generates a balanced mix of media types.
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
  let skipped = 0
  for (let i = 0; i < count; i++) {
    const template = templates[Math.floor(Math.random() * templates.length)]!
    const rawPrompt = fillTemplate(template.template, attrsByCategory)
    const refineResult = await refineWithLLM(rawPrompt, ai)

    // Only cache actually-refined prompts — skip if pod was unavailable
    if (!refineResult.wasRefined) {
      skipped++
      if (skipped === 1) {
        console.warn(`[PromptGen] Pod unavailable — stopping cache fill (would store unrefined prompts)`)
      }
      // If first prompt fails refinement, pod is likely down — stop trying
      if (skipped >= 2) break
      continue
    }

    const similarityHash = computeSimilarityHash(refineResult.text)

    await db.insert(promptCache).values({
      id: crypto.randomUUID(),
      templateId: template.id,
      templateName: template.name,
      rawPrompt,
      refinedPrompt: refineResult.text,
      similarityHash,
      mediaType: template.mediaType || 'any',
      modelHint: template.modelHint || null,
      createdAt: new Date().toISOString(),
    })
    added++
  }

  if (skipped > 0) {
    console.warn(`[PromptGen] Cache fill: ${added} added, ${skipped} skipped (unrefined)`)
  } else {
    console.log(`[PromptGen] Filled cache with ${added} prompts`)
  }
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
