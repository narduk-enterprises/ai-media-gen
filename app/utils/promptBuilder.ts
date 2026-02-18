/**
 * Prompt Builder — composable for building prompts with randomizable attributes.
 *
 * Extracts scene, pose, style, lighting, mood, and camera into structured
 * attributes that can be individually set, randomized, or varied per image.
 */

export const attributePresets = {
  scene: [
    'futuristic city skyline', 'enchanted forest glade', 'underwater ancient ruins',
    'neon-lit rainy alleyway', 'mountain temple at dawn', 'space station interior',
    'desert oasis at sunset', 'cyberpunk marketplace', 'frozen tundra landscape',
    'rooftop garden above the clouds', 'abandoned cathedral', 'bioluminescent cave',
    'tropical beach at golden hour', 'steampunk workshop', 'floating island archipelago',
  ],
  pose: [
    'standing confidently', 'sitting cross-legged', 'mid-action dynamic leap',
    'reclining elegantly', 'walking toward camera', 'dramatic side profile',
    'kneeling with hands extended', 'arms crossed looking away',
    'dancing gracefully', 'meditating peacefully', 'running in motion blur',
    'leaning against a wall', 'reaching upward',
  ],
  style: [
    'photorealistic', 'anime', 'oil painting', 'watercolor', 'cyberpunk',
    'art nouveau', 'comic book', 'cinematic', 'digital illustration',
    'studio ghibli', 'baroque', 'vaporwave', 'film noir', 'pop art',
    'hyperrealism', 'impressionist', 'minimalist',
  ],
  lighting: [
    'golden hour warmth', 'dramatic chiaroscuro', 'neon glow', 'soft diffused ambient',
    'harsh single spotlight', 'moonlit silver', 'backlit silhouette',
    'volumetric fog rays', 'candlelit warm', 'studio rim lighting',
    'bioluminescent glow', 'overcast moody', 'sunrise gradient',
  ],
  mood: [
    'serene', 'intense', 'mysterious', 'joyful', 'melancholic',
    'epic', 'whimsical', 'ethereal', 'dark and brooding', 'dreamlike',
    'nostalgic', 'triumphant', 'ominous', 'romantic', 'psychedelic',
  ],
  camera: [
    'wide angle establishing shot', 'close-up portrait', 'bird\'s eye view',
    'low angle heroic', 'dutch angle dramatic', 'macro detail', 'panoramic vista',
    'medium shot', 'over the shoulder', 'fisheye lens',
    'telephoto bokeh', 'symmetrical composition', 'rule of thirds',
  ],
} as const

export type AttributeKey = keyof typeof attributePresets

export const attributeLabels: Record<AttributeKey, { emoji: string; label: string; suffix: string }> = {
  scene: { emoji: '🏔️', label: 'Scene', suffix: '' },
  pose: { emoji: '🧍', label: 'Pose', suffix: '' },
  style: { emoji: '🎨', label: 'Style', suffix: 'style' },
  lighting: { emoji: '💡', label: 'Lighting', suffix: 'lighting' },
  mood: { emoji: '🎭', label: 'Mood', suffix: 'mood' },
  camera: { emoji: '📷', label: 'Camera', suffix: '' },
}

export const attributeKeys = Object.keys(attributePresets) as AttributeKey[]

/**
 * Pick a random element from an array.
 */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/**
 * Build a composed prompt from a base prompt and attribute values.
 * Attributes with a `suffix` in `attributeLabels` get that suffix appended.
 *
 * Example: base="a warrior", style="anime" → "a warrior, anime style"
 */
export function buildPrompt(basePrompt: string, attributes: Record<AttributeKey, string>): string {
  const parts: string[] = []

  const trimmedBase = basePrompt.trim()
  if (trimmedBase) parts.push(trimmedBase)

  for (const key of attributeKeys) {
    const value = attributes[key]?.trim()
    if (!value) continue
    const info = attributeLabels[key]
    parts.push(info.suffix ? `${value} ${info.suffix}` : value)
  }

  return parts.join(', ')
}

/**
 * Build a prompt where all non-empty attributes are replaced with random
 * picks from their preset pools. The base prompt stays the same.
 *
 * When `randomizeAll` is true, every attribute gets a random value
 * regardless of whether it was originally set.
 */
export function buildRandomVariantPrompt(
  basePrompt: string,
  attributes: Record<AttributeKey, string>,
  randomizeAll: boolean = true,
): string {
  const parts: string[] = []

  const trimmedBase = basePrompt.trim()
  if (trimmedBase) parts.push(trimmedBase)

  for (const key of attributeKeys) {
    const hasValue = attributes[key]?.trim()
    if (!randomizeAll && !hasValue) continue
    const info = attributeLabels[key]
    const randomVal = pickRandom(attributePresets[key])
    parts.push(info.suffix ? `${randomVal} ${info.suffix}` : randomVal)
  }

  return parts.join(', ')
}

/**
 * Generate an array of varied prompts, one per image.
 * Each gets different random attributes, all sharing the same base prompt.
 */
export function buildVariedPrompts(
  basePrompt: string,
  attributes: Record<AttributeKey, string>,
  count: number,
): string[] {
  return Array.from({ length: count }, () =>
    buildRandomVariantPrompt(basePrompt, attributes, true)
  )
}

/**
 * Count how many attributes currently have a value.
 */
export function countActiveAttributes(attributes: Record<AttributeKey, string>): number {
  return attributeKeys.filter(k => attributes[k]?.trim()).length
}

/**
 * Create a fresh empty attributes object.
 */
export function createEmptyAttributes(): Record<AttributeKey, string> {
  return Object.fromEntries(attributeKeys.map(k => [k, ''])) as Record<AttributeKey, string>
}

/**
 * Randomize all attributes in-place and return the object.
 */
export function randomizeAllAttributes(attributes: Record<AttributeKey, string>): Record<AttributeKey, string> {
  for (const key of attributeKeys) {
    attributes[key] = pickRandom(attributePresets[key])
  }
  return attributes
}

/**
 * Clear all attributes in-place.
 */
export function clearAllAttributes(attributes: Record<AttributeKey, string>): Record<AttributeKey, string> {
  for (const key of attributeKeys) {
    attributes[key] = ''
  }
  return attributes
}
