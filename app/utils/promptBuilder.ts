/**
 * Prompt Builder — composable for building prompts with randomizable attributes.
 *
 * Includes scene/environment attributes and character appearance attributes
 * (hair, eyes, body type, skin tone, clothing).
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

  // ─── Character Appearance ───────────────────────────────────────────
  hair: [
    'long flowing black hair', 'short platinum blonde pixie cut', 'curly auburn hair',
    'braided silver hair', 'messy dark brown hair', 'slicked-back red hair',
    'wavy golden blonde hair', 'buzz cut', 'long white hair with bangs',
    'twin tails pink hair', 'dreadlocks', 'undercut with fade',
    'voluminous afro', 'half-up half-down chestnut hair', 'mohawk',
  ],
  eyes: [
    'piercing blue eyes', 'deep brown eyes', 'striking green eyes',
    'golden amber eyes', 'heterochromia eyes', 'glowing violet eyes',
    'sharp grey eyes', 'warm hazel eyes', 'crimson red eyes',
    'ice-white eyes', 'dark obsidian eyes', 'cat-like emerald eyes',
    'soft doe eyes', 'almond-shaped dark eyes', 'bright teal eyes',
  ],
  bodyType: [
    'athletic build', 'slim and slender', 'curvy figure', 'muscular and toned',
    'petite frame', 'tall and statuesque', 'stocky and broad-shouldered',
    'lean and wiry', 'hourglass figure', 'average build',
    'plus-size', 'lithe and graceful', 'compact and powerful',
  ],
  skinTone: [
    'fair porcelain skin', 'warm olive skin', 'rich dark brown skin',
    'golden tan skin', 'pale ivory skin', 'deep ebony skin',
    'bronze sun-kissed skin', 'cool beige skin', 'warm caramel skin',
    'rosy peach skin', 'light brown skin', 'dark olive skin',
    'freckled fair skin', 'luminous medium skin',
  ],
  clothing: [
    'elegant evening gown', 'tactical combat gear', 'casual streetwear',
    'flowing kimono', 'futuristic armor suit', 'vintage Victorian dress',
    'leather jacket and jeans', 'royal court attire', 'athletic sportswear',
    'cyberpunk neon outfit', 'minimalist white outfit', 'gothic black ensemble',
    'bohemian layered outfit', 'sleek business suit', 'fantasy wizard robes',
    'medieval knight armor', 'summer dress with floral print',
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
  hair: { emoji: '💇', label: 'Hair', suffix: '' },
  eyes: { emoji: '👁️', label: 'Eyes', suffix: '' },
  bodyType: { emoji: '🏋️', label: 'Body Type', suffix: '' },
  skinTone: { emoji: '🎨', label: 'Skin Tone', suffix: '' },
  clothing: { emoji: '👗', label: 'Clothing', suffix: '' },
}

export const attributeKeys = Object.keys(attributePresets) as AttributeKey[]

/** Attribute keys that belong to a character/person (appearance traits). */
export const characterAttributeKeys = ['hair', 'eyes', 'bodyType', 'skinTone', 'clothing'] as const satisfies readonly AttributeKey[]
export type CharacterAttributeKey = (typeof characterAttributeKeys)[number]

/** Attribute keys that belong to a scene/environment (non-character traits). */
export const sceneAttributeKeys = ['scene', 'pose', 'style', 'lighting', 'mood', 'camera'] as const satisfies readonly AttributeKey[]
export type SceneAttributeKey = (typeof sceneAttributeKeys)[number]

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
 * Each gets different random attributes. When `basePrompts` is provided,
 * each image also gets a random base prompt from the pool.
 */
export function buildVariedPrompts(
  basePrompt: string,
  attributes: Record<AttributeKey, string>,
  count: number,
  basePrompts?: string[],
): string[] {
  return Array.from({ length: count }, () => {
    const prompt = basePrompts?.length
      ? pickRandom(basePrompts)
      : basePrompt
    return buildRandomVariantPrompt(prompt, attributes, true)
  })
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

/**
 * Build a composed prompt from a base prompt, person appearance attributes,
 * and scene/environment attributes. Used by the Personas page.
 */
export function buildPersonaPrompt(
  basePrompt: string,
  personAttrs: Record<string, string>,
  sceneAttrs: Record<string, string>,
  personDescription?: string,
): string {
  const parts: string[] = []

  const trimmedBase = basePrompt.trim()
  if (trimmedBase) parts.push(trimmedBase)

  const trimmedDesc = personDescription?.trim()
  if (trimmedDesc) parts.push(trimmedDesc)

  // Person appearance traits
  for (const key of characterAttributeKeys) {
    const value = personAttrs[key]?.trim()
    if (!value) continue
    const info = attributeLabels[key]
    parts.push(info.suffix ? `${value} ${info.suffix}` : value)
  }

  // Scene/environment traits
  for (const key of sceneAttributeKeys) {
    const value = sceneAttrs[key]?.trim()
    if (!value) continue
    const info = attributeLabels[key]
    parts.push(info.suffix ? `${value} ${info.suffix}` : value)
  }

  return parts.join(', ')
}

/**
 * Generate prompts for batch generation: one persona × multiple scenes × countPerScene.
 * Each scene's empty attributes are filled with random presets (per prompt for variation).
 * Returns array of { sceneIndex, prompt } for total of scenes.length * countPerScene prompts.
 */
export function buildBatchPrompts(
  persona: { description?: string } & Record<string, string>,
  scenes: Record<string, string>[],
  countPerScene: number,
  basePrompts?: string[],
): { sceneIndex: number; prompt: string }[] {
  const result: { sceneIndex: number; prompt: string }[] = []
  const personAttrs: Record<string, string> = {}
  for (const key of characterAttributeKeys) {
    const v = persona[key]?.trim()
    if (v) personAttrs[key] = v
  }
  const description = persona.description?.trim()

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const sceneTemplate = scenes[sceneIndex]!
    for (let i = 0; i < countPerScene; i++) {
      const sceneAttrs: Record<string, string> = {}
      for (const key of sceneAttributeKeys) {
        const val = sceneTemplate[key]?.trim()
        sceneAttrs[key] = val || pickRandom(attributePresets[key])
      }
      const base = basePrompts?.length ? pickRandom(basePrompts) : ''
      const prompt = buildPersonaPrompt(base, personAttrs, sceneAttrs, description)
      result.push({ sceneIndex, prompt })
    }
  }
  return result
}
