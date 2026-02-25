#!/usr/bin/env node
/**
 * Beach Video Parameter Sweep
 * 
 * Submits T2V and pipeline (T2I→V) jobs across WAN 2.2 + LTX-2 models
 * with varied parameters. Results appear in the gallery for narduk@mac.com.
 * 
 * Usage: node web/scripts/batch-beach-sweep.mjs
 */

const API_BASE = 'https://ai-media-gen.narduk.workers.dev'
const SESSION_COOKIE = 'session=1b9b689f-2179-475b-baf6-0e8746eab371'

// ─── Prompt variations ─────────────────────────────────────
// Theme: clothed Texas sorority girl running on a sunny beach

const T2V_PROMPTS = [
  // 1. Classic beach run — emphasis on motion and hair
  `Beautiful tanned college girl in a white bikini top and denim cutoff shorts, running barefoot along a sunny Texas beach at midday, long sun-bleached blonde hair bouncing and flowing behind her, athletic build, big bright smile, turquoise Gulf Coast waves crashing in background, warm golden sunlight, cinematic slow motion, shot on RED camera, shallow depth of field`,

  // 2. Playful surf splashing — emphasis on water interaction
  `Gorgeous young woman in a coral sundress and straw hat, splashing through the shallow surf on a bright Texas beach, laughing joyfully, sundress flowing in the ocean breeze, crystal clear water spraying around her ankles, blazing midday sun, vivid saturated colors, dynamic handheld camera tracking shot, professional cinematography`,

  // 3. Action tracking shot — emphasis on camera movement
  `Athletic blonde sorority girl in a light blue crop top and white beach shorts, sprinting down a pristine sandy beach at noon, camera tracking alongside her at full speed, hair streaming behind her, sand kicking up from her feet, intense bright sunlight, ocean sparkling in background, slow motion 120fps look, cinematic anamorphic lens flare`,

  // 4. Golden hour run (edge case — different lighting)
  `Stunning young woman in a flowing white linen coverup over a swimsuit, jogging along the waterline on a Texas Gulf Coast beach, late afternoon golden hour light, long wavy hair catching the warm light, gentle breeze rippling her clothes, calm turquoise water, drone tracking shot pulling back to reveal the vast empty beach, cinematic 4K quality`,
]

const NEGATIVE_PROMPT = 'worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo, static, no motion, frozen, ugly, extra limbs, extra fingers'

// ─── T2V Parameter grids ───────────────────────────────────

// WAN 2.2 — varies steps, cfg, and frame count
const WAN_PARAMS = []
for (const steps of [20, 25, 30]) {
  for (const cfg of [2.5, 4.0]) {
    for (const numFrames of [81, 121]) {
      WAN_PARAMS.push({ steps, cfg, numFrames, width: 768, height: 768 })
    }
  }
}

// LTX-2 — varies steps, loraStrength, and frame count
const LTX_PARAMS = []
for (const steps of [20, 30, 35]) {
  for (const loraStrength of [0.7, 1.0]) {
    for (const numFrames of [81, 161]) {
      LTX_PARAMS.push({ steps, loraStrength, numFrames, width: 832, height: 480, fps: 24 })
    }
  }
}

// ─── Pipeline (T2I→V) configs ──────────────────────────────
// Generate an image first, then animate it

const PIPELINE_CONFIGS = [
  // WAN video from high-quality Pony image
  { imageModel: 'cyberrealistic_pony', imgSteps: 30, imgCfg: 5.0, videoModel: 'wan22', videoSteps: 25, videoFrames: 81, videoFps: 16 },
  { imageModel: 'cyberrealistic_pony', imgSteps: 30, imgCfg: 5.0, videoModel: 'wan22', videoSteps: 30, videoFrames: 121, videoFps: 16 },
  // LTX-2 video from Pony image
  { imageModel: 'cyberrealistic_pony', imgSteps: 30, imgCfg: 5.0, videoModel: 'ltx2', videoSteps: 30, videoFrames: 121, videoFps: 24 },
  { imageModel: 'cyberrealistic_pony', imgSteps: 30, imgCfg: 5.0, videoModel: 'ltx2', videoSteps: 35, videoFrames: 161, videoFps: 24 },
  // EpicRealism image model instead
  { imageModel: 'epicrealism', imgSteps: 25, imgCfg: 4.5, videoModel: 'ltx2', videoSteps: 30, videoFrames: 121, videoFps: 24 },
  { imageModel: 'epicrealism', imgSteps: 25, imgCfg: 4.5, videoModel: 'wan22', videoSteps: 25, videoFrames: 81, videoFps: 16 },
  // Juggernaut
  { imageModel: 'juggernaut', imgSteps: 25, imgCfg: 5.0, videoModel: 'ltx2', videoSteps: 30, videoFrames: 121, videoFps: 24 },
  { imageModel: 'juggernaut', imgSteps: 25, imgCfg: 5.0, videoModel: 'wan22', videoSteps: 25, videoFrames: 81, videoFps: 16 },
]

const PIPELINE_PROMPTS = [
  `Beautiful tanned Texas sorority girl with long blonde hair in a white bikini top and denim cutoffs, running barefoot along a sunny Gulf Coast beach at noon, athletic figure, bright smile, turquoise ocean waves, clear blue sky, midday sun`,
  `Gorgeous athletic young woman in a coral sundress, running joyfully through the shallow surf on a sunny Texas beach, long wavy hair flowing, crystal water splashing, blazing midday sunlight, vivid colors, cinematic quality`,
]

const PIPELINE_VIDEO_PROMPTS = [
  `She runs along the beach toward camera with hair bouncing and flowing, ocean waves crashing behind her, sand spraying from bare feet, warm sunlight, cinematic slow motion tracking shot`,
  `Dynamic tracking shot as she splashes through shallow surf, water droplets catching the sunlight, sundress flowing in the breeze, joyful laughter, cinematic slow motion`,
]

// ─── API helpers ───────────────────────────────────────────

async function api(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': SESSION_COOKIE,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`${resp.status}: ${text.slice(0, 300)}`)
  }
  return resp.json()
}

async function getQueueDepth() {
  try {
    const resp = await fetch(`${API_BASE}/api/generate/my-queue`, {
      headers: { 'Cookie': SESSION_COOKIE, 'x-requested-with': 'XMLHttpRequest' },
    })
    if (!resp.ok) return 99
    const data = await resp.json()
    const items = data.items || []
    const active = items.filter(i => i.status === 'queued' || i.status === 'processing').length
    return active
  } catch {
    return 99
  }
}

async function waitForQueue(maxDepth = 10) {
  while (true) {
    const depth = await getQueueDepth()
    if (depth < maxDepth) return depth
    process.stdout.write(`  ⏳ Queue: ${depth} active, waiting 45s...\r`)
    await sleep(45000)
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const t2vWanJobs = T2V_PROMPTS.length * WAN_PARAMS.length
  const t2vLtxJobs = T2V_PROMPTS.length * LTX_PARAMS.length
  const pipelineJobs = PIPELINE_PROMPTS.length * PIPELINE_CONFIGS.length
  const totalJobs = t2vWanJobs + t2vLtxJobs + pipelineJobs

  console.log('═══════════════════════════════════════════════════')
  console.log('  🏖️  Beach Video Parameter Sweep')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  T2V WAN 2.2:   ${T2V_PROMPTS.length} prompts × ${WAN_PARAMS.length} param combos = ${t2vWanJobs}`)
  console.log(`  T2V LTX-2:     ${T2V_PROMPTS.length} prompts × ${LTX_PARAMS.length} param combos = ${t2vLtxJobs}`)
  console.log(`  Pipeline T2I→V: ${PIPELINE_PROMPTS.length} prompts × ${PIPELINE_CONFIGS.length} configs = ${pipelineJobs}`)
  console.log(`  ─────────────────────────────────────────────────`)
  console.log(`  Total: ${totalJobs} jobs`)
  console.log('═══════════════════════════════════════════════════')
  console.log()

  let submitted = 0
  let failed = 0
  let genId = null // reuse a single generation for grouping

  // ──────────── Phase 1: T2V — WAN 2.2 ────────────

  console.log('┌─────────────────────────────────────────────────┐')
  console.log('│  Phase 1: Text-to-Video — WAN 2.2              │')
  console.log('└─────────────────────────────────────────────────┘')

  for (let pi = 0; pi < T2V_PROMPTS.length; pi++) {
    const prompt = T2V_PROMPTS[pi]
    console.log(`\n  📝 Prompt ${pi + 1}/${T2V_PROMPTS.length}: "${prompt.slice(0, 60)}..."`)

    for (let si = 0; si < WAN_PARAMS.length; si++) {
      const p = WAN_PARAMS[si]
      await waitForQueue()

      const body = {
        prompt,
        negativePrompt: NEGATIVE_PROMPT,
        model: 'wan22',
        steps: p.steps,
        cfg: p.cfg,
        numFrames: p.numFrames,
        width: p.width,
        height: p.height,
        seed: -1,
        ...(genId ? { generationId: genId } : {}),
      }

      try {
        const result = await api('/api/generate/text2video', body)
        if (!genId) genId = result.generation?.id
        submitted++
        const tag = `WAN s=${p.steps} cfg=${p.cfg} f=${p.numFrames}`
        console.log(`    ✅ [${submitted}/${totalJobs}] ${tag} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
      } catch (e) {
        failed++
        console.error(`    ❌ WAN s=${p.steps} cfg=${p.cfg} f=${p.numFrames}: ${e.message}`)
      }

      await sleep(2000)
    }
  }

  // ──────────── Phase 2: T2V — LTX-2 ────────────

  console.log('\n┌─────────────────────────────────────────────────┐')
  console.log('│  Phase 2: Text-to-Video — LTX-2               │')
  console.log('└─────────────────────────────────────────────────┘')

  // New generation for LTX-2 group
  let ltxGenId = null

  for (let pi = 0; pi < T2V_PROMPTS.length; pi++) {
    const prompt = T2V_PROMPTS[pi]
    console.log(`\n  📝 Prompt ${pi + 1}/${T2V_PROMPTS.length}: "${prompt.slice(0, 60)}..."`)

    for (let si = 0; si < LTX_PARAMS.length; si++) {
      const p = LTX_PARAMS[si]
      await waitForQueue()

      const body = {
        prompt,
        negativePrompt: NEGATIVE_PROMPT,
        model: 'ltx2',
        steps: p.steps,
        loraStrength: p.loraStrength,
        numFrames: p.numFrames,
        width: p.width,
        height: p.height,
        fps: p.fps,
        seed: -1,
        audioPrompt: 'ocean waves crashing, seagulls calling, wind, sand footsteps, cinematic ambient',
        ...(ltxGenId ? { generationId: ltxGenId } : {}),
      }

      try {
        const result = await api('/api/generate/text2video', body)
        if (!ltxGenId) ltxGenId = result.generation?.id
        submitted++
        const tag = `LTX s=${p.steps} lora=${p.loraStrength} f=${p.numFrames}`
        console.log(`    ✅ [${submitted}/${totalJobs}] ${tag} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
      } catch (e) {
        failed++
        console.error(`    ❌ LTX s=${p.steps} lora=${p.loraStrength} f=${p.numFrames}: ${e.message}`)
      }

      await sleep(2000)
    }
  }

  // ──────────── Phase 3: Pipeline T2I → Video ────────────

  console.log('\n┌─────────────────────────────────────────────────┐')
  console.log('│  Phase 3: Pipeline — Image → Video             │')
  console.log('└─────────────────────────────────────────────────┘')

  let pipeGenId = null

  for (let pi = 0; pi < PIPELINE_PROMPTS.length; pi++) {
    const prompt = PIPELINE_PROMPTS[pi]
    const videoPrompt = PIPELINE_VIDEO_PROMPTS[pi]
    console.log(`\n  📝 Prompt ${pi + 1}/${PIPELINE_PROMPTS.length}: "${prompt.slice(0, 60)}..."`)

    for (let ci = 0; ci < PIPELINE_CONFIGS.length; ci++) {
      const c = PIPELINE_CONFIGS[ci]
      await waitForQueue()

      const body = {
        prompt,
        negativePrompt: NEGATIVE_PROMPT,
        width: c.videoModel === 'ltx2' ? 832 : 768,
        height: c.videoModel === 'ltx2' ? 480 : 768,
        steps: c.imgSteps,
        cfg: c.imgCfg,
        seed: -1,
        imageModel: c.imageModel,
        videoPrompt,
        videoModel: c.videoModel,
        videoSteps: c.videoSteps,
        videoFrames: c.videoFrames,
        videoFps: c.videoFps,
        loraStrength: 1.0,
        imageStrength: 1.0,
        ...(pipeGenId ? { generationId: pipeGenId } : {}),
      }

      try {
        const result = await api('/api/generate/text2image-video', body)
        if (!pipeGenId) pipeGenId = result.generation?.id
        submitted++
        const tag = `${c.imageModel}→${c.videoModel} vs=${c.videoSteps} vf=${c.videoFrames}`
        console.log(`    ✅ [${submitted}/${totalJobs}] ${tag} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
      } catch (e) {
        failed++
        console.error(`    ❌ ${c.imageModel}→${c.videoModel}: ${e.message}`)
      }

      await sleep(3000)
    }
  }

  // ──────────── Summary ────────────

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  🏖️  Beach Sweep Complete!`)
  console.log(`  ✅ Submitted: ${submitted}`)
  console.log(`  ❌ Failed:    ${failed}`)
  console.log(`  📊 Jobs will process via the cron queue.`)
  console.log(`  🖼️  Check gallery: ${API_BASE}/gallery`)
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
