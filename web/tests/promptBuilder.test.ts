import { describe, it, expect, vi } from 'vitest'
import {
  attributePresets,
  attributeKeys,
  attributeLabels,
  pickRandom,
  buildPrompt,
  buildPersonaPrompt,
  buildRandomVariantPrompt,
  buildVariedPrompts,
  buildBatchPrompts,
  countActiveAttributes,
  createEmptyAttributes,
  randomizeAllAttributes,
  clearAllAttributes,
  type AttributeKey,
} from '../app/utils/promptBuilder'

// ─── Data Integrity ─────────────────────────────────────────────────────

describe('attributePresets', () => {
  it('has all 11 required attribute categories', () => {
    expect(attributeKeys).toEqual([
      'scene', 'pose', 'style', 'lighting', 'mood', 'camera',
      'hair', 'eyes', 'bodyType', 'skinTone', 'clothing',
    ])
  })

  it('every category has at least 5 presets', () => {
    for (const key of attributeKeys) {
      expect(attributePresets[key].length).toBeGreaterThanOrEqual(5)
    }
  })

  it('all presets are non-empty trimmed strings', () => {
    for (const key of attributeKeys) {
      for (const preset of attributePresets[key]) {
        expect(preset.trim()).not.toBe('')
        expect(preset).toBe(preset.trim())
      }
    }
  })

  it('no duplicate presets within a category', () => {
    for (const key of attributeKeys) {
      const presets = attributePresets[key]
      const uniquePresets = new Set(presets)
      expect(uniquePresets.size).toBe(presets.length)
    }
  })
})

describe('attributeLabels', () => {
  it('has a label entry for every attribute key', () => {
    for (const key of attributeKeys) {
      expect(attributeLabels[key]).toBeDefined()
      expect(attributeLabels[key].emoji).toBeTruthy()
      expect(attributeLabels[key].label).toBeTruthy()
    }
  })

  it('style, lighting, mood have suffixes; others do not', () => {
    expect(attributeLabels.style.suffix).toBe('style')
    expect(attributeLabels.lighting.suffix).toBe('lighting')
    expect(attributeLabels.mood.suffix).toBe('mood')
    expect(attributeLabels.scene.suffix).toBe('')
    expect(attributeLabels.pose.suffix).toBe('')
    expect(attributeLabels.camera.suffix).toBe('')
    expect(attributeLabels.hair.suffix).toBe('')
    expect(attributeLabels.eyes.suffix).toBe('')
    expect(attributeLabels.bodyType.suffix).toBe('')
    expect(attributeLabels.skinTone.suffix).toBe('')
    expect(attributeLabels.clothing.suffix).toBe('')
  })
})

// ─── pickRandom ─────────────────────────────────────────────────────────

describe('pickRandom', () => {
  it('returns an element from the array', () => {
    const arr = ['a', 'b', 'c']
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(pickRandom(arr))
    }
  })

  it('returns the only element from a single-element array', () => {
    expect(pickRandom(['only'])).toBe('only')
  })
})

// ─── buildPrompt ────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('returns just the base prompt when no attributes are set', () => {
    const attrs = createEmptyAttributes()
    expect(buildPrompt('a warrior', attrs)).toBe('a warrior')
  })

  it('returns empty string when both base and attributes are empty', () => {
    const attrs = createEmptyAttributes()
    expect(buildPrompt('', attrs)).toBe('')
  })

  it('appends single attribute without suffix', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'enchanted forest'
    expect(buildPrompt('a warrior', attrs)).toBe('a warrior, enchanted forest')
  })

  it('appends attribute WITH suffix for style, lighting, mood', () => {
    const attrs = createEmptyAttributes()
    attrs.style = 'anime'
    expect(buildPrompt('a warrior', attrs)).toBe('a warrior, anime style')

    attrs.lighting = 'golden hour warmth'
    expect(buildPrompt('a warrior', attrs)).toBe('a warrior, anime style, golden hour warmth lighting')

    attrs.mood = 'epic'
    expect(buildPrompt('a warrior', attrs)).toBe('a warrior, anime style, golden hour warmth lighting, epic mood')
  })

  it('combines all attributes in the correct order', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'desert'
    attrs.pose = 'standing'
    attrs.style = 'cinematic'
    attrs.lighting = 'neon glow'
    attrs.mood = 'intense'
    attrs.camera = 'wide angle'

    const result = buildPrompt('a hero', attrs)
    expect(result).toBe('a hero, desert, standing, cinematic style, neon glow lighting, intense mood, wide angle')
  })

  it('skips empty attributes and only includes set ones', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'forest'
    attrs.camera = 'close-up'
    // pose, style, lighting, mood are empty
    const result = buildPrompt('a girl', attrs)
    expect(result).toBe('a girl, forest, close-up')
  })

  it('trims whitespace from base prompt and attributes', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = '  space station  '
    expect(buildPrompt('  a robot  ', attrs)).toBe('a robot, space station')
  })

  it('works with no base prompt but attributes set', () => {
    const attrs = createEmptyAttributes()
    attrs.style = 'watercolor'
    attrs.mood = 'serene'
    expect(buildPrompt('', attrs)).toBe('watercolor style, serene mood')
  })

  it('treats whitespace-only attributes as empty', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = '   '
    attrs.pose = ''
    expect(buildPrompt('base', attrs)).toBe('base')
  })
})

// ─── buildRandomVariantPrompt ───────────────────────────────────────────

describe('buildRandomVariantPrompt', () => {
  it('returns a prompt with the base + random values for all attrs when randomizeAll=true', () => {
    const attrs = createEmptyAttributes()
    const result = buildRandomVariantPrompt('a cat', attrs, true)
    // Should have the base prompt + 11 attribute segments
    const parts = result.split(', ')
    expect(parts[0]).toBe('a cat')
    expect(parts.length).toBe(12) // base + 11 attributes
  })

  it('only randomizes populated attributes when randomizeAll=false', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'forest'
    attrs.style = 'anime'
    const result = buildRandomVariantPrompt('a cat', attrs, false)
    const parts = result.split(', ')
    expect(parts[0]).toBe('a cat')
    // Only scene + style should be present (2 attributes)
    expect(parts.length).toBe(3)
  })

  it('uses presets from the correct categories', () => {
    const attrs = createEmptyAttributes()
    const result = buildRandomVariantPrompt('test', attrs, true)

    // The result should contain exactly one element from each category
    // Check that style has " style" suffix
    expect(result).toMatch(/ style/)
    expect(result).toMatch(/ lighting/)
    expect(result).toMatch(/ mood/)
  })

  it('produces different results on repeated calls (randomness test)', () => {
    const attrs = createEmptyAttributes()
    const results = new Set<string>()
    for (let i = 0; i < 50; i++) {
      results.add(buildRandomVariantPrompt('test', attrs, true))
    }
    // With 6 categories of 10+ presets each, we should get variety
    expect(results.size).toBeGreaterThan(1)
  })
})

// ─── buildVariedPrompts ─────────────────────────────────────────────────

describe('buildVariedPrompts', () => {
  it('returns the correct number of prompts', () => {
    const attrs = createEmptyAttributes()
    const prompts = buildVariedPrompts('test', attrs, 4)
    expect(prompts).toHaveLength(4)
  })

  it('each prompt starts with the base prompt', () => {
    const attrs = createEmptyAttributes()
    const prompts = buildVariedPrompts('a dragon', attrs, 8)
    for (const p of prompts) {
      expect(p.startsWith('a dragon')).toBe(true)
    }
  })

  it('produces variety across prompts', () => {
    const attrs = createEmptyAttributes()
    const prompts = buildVariedPrompts('test', attrs, 16)
    const unique = new Set(prompts)
    // With randomness, 16 prompts should not all be identical
    expect(unique.size).toBeGreaterThan(1)
  })

  it('all prompts are valid non-empty strings', () => {
    const attrs = createEmptyAttributes()
    const prompts = buildVariedPrompts('base', attrs, 4)
    for (const p of prompts) {
      expect(p.trim()).not.toBe('')
      expect(typeof p).toBe('string')
    }
  })
})

// ─── Attribute helpers ──────────────────────────────────────────────────

describe('createEmptyAttributes', () => {
  it('creates an object with all keys set to empty strings', () => {
    const attrs = createEmptyAttributes()
    for (const key of attributeKeys) {
      expect(attrs[key]).toBe('')
    }
  })

  it('has exactly 11 keys', () => {
    const attrs = createEmptyAttributes()
    expect(Object.keys(attrs)).toHaveLength(11)
  })
})

describe('countActiveAttributes', () => {
  it('returns 0 for empty attributes', () => {
    expect(countActiveAttributes(createEmptyAttributes())).toBe(0)
  })

  it('counts only non-empty attributes', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'forest'
    attrs.pose = 'standing'
    expect(countActiveAttributes(attrs)).toBe(2)
  })

  it('ignores whitespace-only values', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = '   '
    expect(countActiveAttributes(attrs)).toBe(0)
  })

  it('returns 11 when all attributes are set', () => {
    const attrs = createEmptyAttributes()
    randomizeAllAttributes(attrs)
    expect(countActiveAttributes(attrs)).toBe(11)
  })
})

describe('randomizeAllAttributes', () => {
  it('fills all attributes with non-empty values', () => {
    const attrs = createEmptyAttributes()
    randomizeAllAttributes(attrs)
    for (const key of attributeKeys) {
      expect(attrs[key].trim()).not.toBe('')
    }
  })

  it('each value comes from its corresponding preset pool', () => {
    const attrs = createEmptyAttributes()
    randomizeAllAttributes(attrs)
    for (const key of attributeKeys) {
      expect(attributePresets[key] as readonly string[]).toContain(attrs[key])
    }
  })

  it('returns the same object (mutates in place)', () => {
    const attrs = createEmptyAttributes()
    const result = randomizeAllAttributes(attrs)
    expect(result).toBe(attrs)
  })
})

describe('clearAllAttributes', () => {
  it('resets all attributes to empty strings', () => {
    const attrs = createEmptyAttributes()
    randomizeAllAttributes(attrs)
    clearAllAttributes(attrs)
    for (const key of attributeKeys) {
      expect(attrs[key]).toBe('')
    }
  })

  it('returns the same object (mutates in place)', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'test'
    const result = clearAllAttributes(attrs)
    expect(result).toBe(attrs)
  })
})

// ─── Integration: end-to-end prompt building ────────────────────────────

describe('end-to-end prompt building', () => {
  it('full workflow: create → randomize → build → clear → build', () => {
    const attrs = createEmptyAttributes()
    expect(buildPrompt('hero', attrs)).toBe('hero')

    randomizeAllAttributes(attrs)
    const full = buildPrompt('hero', attrs)
    expect(full.startsWith('hero')).toBe(true)
    expect(full.split(', ').length).toBe(12) // base + 11

    clearAllAttributes(attrs)
    expect(buildPrompt('hero', attrs)).toBe('hero')
  })

  it('partial attributes: only set 2, varied prompts only randomize those 2', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'forest'
    attrs.style = 'anime'

    // Build with randomizeAll=false should only have base + 2 parts
    const variant = buildRandomVariantPrompt('test', attrs, false)
    const parts = variant.split(', ')
    expect(parts.length).toBe(3)
  })

  it('varied prompts for batch generation all contain base prompt', () => {
    const attrs = createEmptyAttributes()
    attrs.scene = 'city'
    const batch = buildVariedPrompts('a woman', attrs, 8)

    expect(batch).toHaveLength(8)
    for (const p of batch) {
      expect(p).toContain('a woman')
    }
  })
})

describe('buildPersonaPrompt', () => {
  it('combines base, description, person attrs, and scene attrs', () => {
    const personAttrs = { hair: 'blonde', eyes: 'blue', bodyType: '', skinTone: '', clothing: '' }
    const sceneAttrs = { scene: 'forest', pose: 'standing', style: 'anime', lighting: '', mood: '', camera: '' }
    const out = buildPersonaPrompt('a woman', personAttrs, sceneAttrs, '25 years old')
    expect(out).toContain('a woman')
    expect(out).toContain('25 years old')
    expect(out).toContain('blonde')
    expect(out).toContain('blue')
    expect(out).toContain('forest')
    expect(out).toContain('standing')
    expect(out).toContain('anime style')
  })
})

describe('buildBatchPrompts', () => {
  it('returns scenes.length * countPerScene entries', () => {
    const persona = { description: '', hair: 'black', eyes: 'brown', bodyType: '', skinTone: '', clothing: 'suit' }
    const scenes = [
      { scene: 'city', pose: 'standing', style: 'cinematic', lighting: '', mood: '', camera: '' },
      { scene: 'beach', pose: '', style: '', lighting: 'golden hour', mood: '', camera: '' },
    ]
    const result = buildBatchPrompts(persona, scenes, 2, ['base prompt'])
    expect(result).toHaveLength(4) // 2 scenes * 2 per scene
    expect(result.every(r => r.prompt.includes('base prompt'))).toBe(true)
    expect(result.every(r => r.prompt.includes('black') && r.prompt.includes('brown') && r.prompt.includes('suit'))).toBe(true)
    expect(result.filter(r => r.sceneIndex === 0)).toHaveLength(2)
    expect(result.filter(r => r.sceneIndex === 1)).toHaveLength(2)
  })

  it('fills empty scene fields with random presets', () => {
    const persona = { description: '', hair: '', eyes: '', bodyType: '', skinTone: '', clothing: '' }
    const scenes = [{ scene: 'only this', pose: '', style: '', lighting: '', mood: '', camera: '' }]
    const result = buildBatchPrompts(persona, scenes, 1, ['base'])
    expect(result).toHaveLength(1)
    expect(result[0]!.prompt).toContain('base')
    expect(result[0]!.prompt).toContain('only this')
  })
})
