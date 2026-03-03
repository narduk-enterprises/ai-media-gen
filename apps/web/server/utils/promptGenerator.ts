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

  return items.at(-1)!.value
}

// ─── Template Filling ───────────────────────────────────────

/**
 * Replace [placeholder] tags in a template with randomly selected attributes.
 */
function fillTemplate(
  template: string,
  attrsByCategory: Record<string, WeightedItem[]>,
): string {
  return template.replaceAll(/\[([^\]]+)\]/g, (match, category) => {
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
    .replaceAll(/[^a-z\s]/g, '')
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
        timeout: 15_000, // Short timeout — if pod is busy, fall back to raw prompt fast
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

    // Cache refill is handled by the cron — don't trigger here to avoid storms

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

  // Cache refill is handled by the cron — don't trigger here to avoid storms

  // ── Fallback: instant raw template (no pod call) ──────────
  // The cache is the primary refined prompt source. When empty, return a raw
  // template fill instantly. Don't call the pod here — it's busy batch-filling
  // the cache, and waiting 15s for a 429/timeout wastes user time.
  console.log(`[PromptGen] Cache empty for type=${mediaType}, serving raw template`)

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

  // 3. Fill template (instant — no LLM, no pod call)
  const rawPrompt = fillTemplate(template.template, attrsByCategory)
  const similarityHash = computeSimilarityHash(rawPrompt)

  console.warn(`[PromptGen] ⚠️ Serving UNREFINED prompt (cache empty) — raw template output`)

  // 4. Store in generation log
  const id = crypto.randomUUID()
  await db.insert(promptGenerationLog).values({
    id,
    templateId: template.id,
    rawPrompt,
    refinedPrompt: rawPrompt, // same since not refined
    similarityHash,
    userId: userId || null,
    createdAt: new Date().toISOString(),
  })

  return {
    id,
    templateId: template.id,
    templateName: template.name,
    rawPrompt,
    refinedPrompt: rawPrompt,
    similarityHash,
    mediaType: mediaType !== 'any' ? mediaType : (template.mediaType || 'any'),
    modelHint: template.modelHint,
    wasRefined: false,
    refineError: 'Cache empty — serving raw template',
  }
}

/**
 * Fire-and-forget cache fill: generates raw prompts locally (instant),
 * sends them all to the pod's /generate/batch-refine endpoint, and returns
 * immediately. The pod refines them in a background thread (no time limits,
 * model loads once) and webhooks each result back to /api/prompt-builder/cache-webhook.
 *
 * Returns the number of prompts sent to the pod (not the number cached — that
 * happens asynchronously via the webhook).
 */
export async function fillPromptCache(
  db: any,
  ai: any,
  count: number = 10,
  mediaType?: 'image' | 'video',
): Promise<number> {
  // Build template query with optional media type filter
  const conditions = [eq(promptTemplates.isActive, true)]
  if (mediaType) {
    conditions.push(
      or(
        eq(promptTemplates.mediaType, mediaType),
        eq(promptTemplates.mediaType, 'any'),
      )! as any,
    )
  }

  const templates = await db
    .select()
    .from(promptTemplates)
    .where(and(...conditions))

  if (templates.length === 0) {
    throw new Error(`No active ${mediaType || ''} templates found.`)
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

  // ── Generate raw prompts locally (instant — no LLM needed) ──
  const prompts: Array<{
    raw_prompt: string
    template_id: string
    template_name: string
    media_type: string
    model_hint: string | null
  }> = []

  for (let i = 0; i < count; i++) {
    const template = templates[Math.floor(Math.random() * templates.length)]!
    const rawPrompt = fillTemplate(template.template, attrsByCategory)
    prompts.push({
      raw_prompt: rawPrompt,
      template_id: template.id,
      template_name: template.name,
      media_type: mediaType || template.mediaType || 'any',
      model_hint: template.modelHint || null,
    })
  }

  // ── Send batch to pod — fire and forget ─────────────────────
  try {
    const { resolveApiUrl } = await import('./ai')
    const podUrl = await resolveApiUrl(undefined, undefined, ['prompt_refine'])

    const config = useRuntimeConfig() as any
    const siteUrl = config.public?.siteUrl || config.siteUrl || 'https://ai-media-gen.nard.uk'
    const callbackUrl = `${siteUrl}/api/prompt-builder/cache-webhook`
    const callbackSecret = config.webhookSecret || ''

    const response = await $fetch<{ batch_id: string; status: string; count: number }>(
      `${podUrl}/generate/batch-refine`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          prompts,
          callback_url: callbackUrl,
          callback_secret: callbackSecret,
          temperature: 0.9,
        },
        timeout: 10_000, // Just needs to accept the batch, doesn't wait for refinement
      },
    )

    console.log(`[PromptGen] 🚀 Batch ${response.batch_id?.slice(0, 8)} sent: ${count} prompts → pod will refine and webhook results back`)
    return count
  } catch (e: any) {
    console.warn(`[PromptGen] ❌ Batch refine failed: ${e.message}`)
    return 0
  }
}

// ─── Auto-Refill ────────────────────────────────────────────

const CACHE_TARGET = 1000
const CACHE_PER_TYPE = 500 // aim for 500 image + 500 video = 1000 total
const BATCH_SIZE = 20  // prompts per batch-refine call

/**
 * Check cache count and top up to CACHE_TARGET if below.
 * Fills whichever media type (image/video) has fewer cached prompts.
 * Uses DB-based timing guard instead of in-memory flag (serverless-safe).
 */
export async function autoRefillCache(db: any, ai: any): Promise<void> {
  // Count by media type
  const countResult = await db
    .select({
      mediaType: promptCache.mediaType,
      count: sql<number>`count(*)`,
    })
    .from(promptCache)
    .groupBy(promptCache.mediaType)

  const counts: Record<string, number> = {}
  let total = 0
  for (const row of countResult) {
    counts[row.mediaType || 'unknown'] = row.count
    total += row.count
  }

  if (total >= CACHE_TARGET) return // already full

  // No timing guard — the pod's 429 ("batch already in progress")
  // naturally prevents overlapping batches. This way the cron fires
  // every minute and always tries, keeping the GPU busy 100%.

  // Pick the media type with fewer cached prompts
  const imageCount = counts['image'] || 0
  const videoCount = counts['video'] || 0
  const targetType: 'image' | 'video' = imageCount <= videoCount ? 'image' : 'video'

  const deficit = Math.min(CACHE_PER_TYPE - (targetType === 'image' ? imageCount : videoCount), BATCH_SIZE)
  if (deficit <= 0) {
    // This type is full, try the other
    const otherType = targetType === 'image' ? 'video' : 'image'
    const otherCount = otherType === 'image' ? imageCount : videoCount
    const otherDeficit = Math.min(CACHE_PER_TYPE - otherCount, BATCH_SIZE)
    if (otherDeficit <= 0) return // both types full
    console.log(`[PromptGen] Cache: ${imageCount} image, ${videoCount} video — filling ${otherDeficit} ${otherType} prompts`)
    try {
      await fillPromptCache(db, ai, otherDeficit, otherType)
    } catch (e: any) {
      console.warn(`[PromptGen] fillPromptCache error: ${e.message}`)
    }
    return
  }

  console.log(`[PromptGen] Cache: ${imageCount} image, ${videoCount} video — filling ${deficit} ${targetType} prompts`)

  try {
    await fillPromptCache(db, ai, deficit, targetType)
  } catch (e: any) {
    console.warn(`[PromptGen] fillPromptCache error: ${e.message}`)
  }
}
