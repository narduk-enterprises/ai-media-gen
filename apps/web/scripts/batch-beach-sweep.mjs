#!/usr/bin/env node
/**
 * Beach Video Parameter Sweep — v2 (Focused & Fast)
 * 
 * Smaller, smarter job set that tests the key quality knobs:
 *   - LTX-2 T2V: fast, supports audio, best for finding sweet spot
 *   - WAN 2.2 T2V fast (4 steps): quick baseline comparisons 
 *   - Pipeline T2I→V: best image models → LTX-2 video
 * 
 * Total: ~24 jobs (runs in ~30-60 min)
 * Usage: node web/scripts/batch-beach-sweep.mjs
 */

const API_BASE = 'https://ai-media-gen.narduk.workers.dev'
const SESSION_COOKIE = 'session=1b9b689f-2179-475b-baf6-0e8746eab371'

// ─── Two focused prompts ───────────────────────────────────
// Short, direct, motion-rich descriptors that video models respond to best

const PROMPTS = [
  // Prompt A: Classic beach run with motion emphasis
  `Beautiful tanned college girl with long sun-bleached blonde hair in a white bikini top and denim cutoff shorts, running barefoot along a sunny Texas beach, hair bouncing behind her, athletic build, bright smile, turquoise waves crashing, warm midday sunlight, cinematic slow motion, shallow depth of field`,

  // Prompt B: Surf splashing — water interaction
  `Gorgeous young blonde woman in a flowing coral sundress, splashing joyfully through shallow surf on a bright tropical beach, dress flowing in ocean breeze, crystal water spraying around her ankles, blazing noon sun, vivid colors, dynamic tracking shot, professional cinematography`,
]

const NEGATIVE = 'worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo, static, no motion, frozen, ugly, extra limbs'

// ─── Phase 1: LTX-2 T2V — the main quality sweep ──────────
// LTX-2 is fast (~30-60s per job) and supports audio — ideal for parameter exploration

const LTX_SWEEP = [
  // Vary steps: find the quality vs speed sweet spot
  { steps: 20, loraStrength: 1.0, numFrames: 97,  fps: 24, width: 832, height: 480, label: 'LTX 20s/97f' },
  { steps: 30, loraStrength: 1.0, numFrames: 97,  fps: 24, width: 832, height: 480, label: 'LTX 30s/97f' },
  { steps: 35, loraStrength: 1.0, numFrames: 97,  fps: 24, width: 832, height: 480, label: 'LTX 35s/97f' },
  // Vary lora strength at best steps
  { steps: 30, loraStrength: 0.7, numFrames: 97,  fps: 24, width: 832, height: 480, label: 'LTX 30s/lora0.7' },
  { steps: 30, loraStrength: 0.5, numFrames: 97,  fps: 24, width: 832, height: 480, label: 'LTX 30s/lora0.5' },
  // Longer clip
  { steps: 30, loraStrength: 1.0, numFrames: 161, fps: 24, width: 832, height: 480, label: 'LTX 30s/161f' },
  // HD resolution test
  { steps: 30, loraStrength: 1.0, numFrames: 97,  fps: 24, width: 1280, height: 720, label: 'LTX 30s/HD' },
]

// ─── Phase 2: WAN 2.2 T2V fast mode (4 steps) ─────────────
// Quick ~30s jobs for comparison against LTX-2

const WAN_FAST = [
  { steps: 4, numFrames: 81,  width: 832, height: 480, loraStrength: 1.0, label: 'WAN-fast 4s/81f' },
  { steps: 4, numFrames: 81,  width: 768, height: 768, loraStrength: 1.0, label: 'WAN-fast 4s/square' },
]

// ─── Phase 3: Pipeline T2I → Video ─────────────────────────
// Generate a quality still image first, then animate with LTX-2

const PIPELINE_JOBS = [
  // CyberRealistic Pony → LTX-2  (best image quality for photorealism)
  { imageModel: 'cyberrealistic_pony', imgSteps: 30, imgCfg: 5.0, videoModel: 'ltx2', videoSteps: 30, videoFrames: 121, videoFps: 24, label: 'Pony→LTX' },
  // Juggernaut XL → LTX-2
  { imageModel: 'juggernaut', imgSteps: 30, imgCfg: 5.0, videoModel: 'ltx2', videoSteps: 30, videoFrames: 121, videoFps: 24, label: 'Juggernaut→LTX' },
  // CyberRealistic Pony → LTX-2 with more video steps
  { imageModel: 'cyberrealistic_pony', imgSteps: 30, imgCfg: 5.0, videoModel: 'ltx2', videoSteps: 35, videoFrames: 161, videoFps: 24, label: 'Pony→LTX-long' },
]

const PIPELINE_VIDEO_PROMPT = `She runs along the beach toward camera with hair bouncing and flowing, ocean waves crashing behind her, sand spraying from bare feet, warm sunlight, cinematic slow motion tracking shot`
const AUDIO_PROMPT = 'ocean waves crashing, seagulls calling, wind blowing, sand footsteps, warm coastal afternoon ambience'

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
    return items.filter(i => i.status === 'queued' || i.status === 'processing').length
  } catch { return 99 }
}

async function waitForQueue(maxDepth = 8) {
  while (true) {
    const depth = await getQueueDepth()
    if (depth < maxDepth) return depth
    process.stdout.write(`  ⏳ Queue: ${depth} active, waiting 30s...\n`)
    await sleep(30000)
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const ltxJobs = PROMPTS.length * LTX_SWEEP.length
  const wanJobs = PROMPTS.length * WAN_FAST.length
  const pipeJobs = PIPELINE_JOBS.length
  const total = ltxJobs + wanJobs + pipeJobs

  console.log('═══════════════════════════════════════════════════')
  console.log('  🏖️  Beach Video Sweep v2 (Focused & Fast)')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  LTX-2 T2V:     ${PROMPTS.length} prompts × ${LTX_SWEEP.length} combos = ${ltxJobs}`)
  console.log(`  WAN fast T2V:  ${PROMPTS.length} prompts × ${WAN_FAST.length} combos = ${wanJobs}`)
  console.log(`  Pipeline T2I→V: ${pipeJobs} configs`)
  console.log(`  ─────────────────────────────────────────────────`)
  console.log(`  Total: ${total} jobs (~30-60 min)`)
  console.log('═══════════════════════════════════════════════════\n')

  let submitted = 0
  let failed = 0

  // ──────────── Phase 1: LTX-2 T2V ────────────

  console.log('┌─────────────────────────────────────────────────┐')
  console.log('│  Phase 1: LTX-2 Text-to-Video                  │')
  console.log('└─────────────────────────────────────────────────┘')

  let ltxGenId = null

  for (let pi = 0; pi < PROMPTS.length; pi++) {
    const prompt = PROMPTS[pi]
    console.log(`\n  📝 Prompt ${pi + 1}/${PROMPTS.length}: "${prompt.slice(0, 60)}..."`)

    for (const p of LTX_SWEEP) {
      await waitForQueue()

      try {
        const result = await api('/api/generate/text2video', {
          prompt,
          negativePrompt: NEGATIVE,
          model: 'ltx2',
          steps: p.steps,
          loraStrength: p.loraStrength,
          numFrames: p.numFrames,
          width: p.width,
          height: p.height,
          fps: p.fps,
          seed: -1,
          audioPrompt: AUDIO_PROMPT,
          ...(ltxGenId ? { generationId: ltxGenId } : {}),
        })
        if (!ltxGenId) ltxGenId = result.generation?.id
        submitted++
        console.log(`    ✅ [${submitted}/${total}] ${p.label} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
      } catch (e) {
        failed++
        console.error(`    ❌ ${p.label}: ${e.message}`)
      }
      await sleep(1500)
    }
  }

  // ──────────── Phase 2: WAN 2.2 fast mode ────────────

  console.log('\n┌─────────────────────────────────────────────────┐')
  console.log('│  Phase 2: WAN 2.2 T2V (fast 4-step)            │')
  console.log('└─────────────────────────────────────────────────┘')

  let wanGenId = null

  for (let pi = 0; pi < PROMPTS.length; pi++) {
    const prompt = PROMPTS[pi]
    console.log(`\n  📝 Prompt ${pi + 1}/${PROMPTS.length}: "${prompt.slice(0, 60)}..."`)

    for (const p of WAN_FAST) {
      await waitForQueue()

      try {
        const result = await api('/api/generate/text2video', {
          prompt,
          negativePrompt: NEGATIVE,
          model: 'wan22',
          steps: p.steps,
          numFrames: p.numFrames,
          width: p.width,
          height: p.height,
          loraStrength: p.loraStrength,
          seed: -1,
          ...(wanGenId ? { generationId: wanGenId } : {}),
        })
        if (!wanGenId) wanGenId = result.generation?.id
        submitted++
        console.log(`    ✅ [${submitted}/${total}] ${p.label} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
      } catch (e) {
        failed++
        console.error(`    ❌ ${p.label}: ${e.message}`)
      }
      await sleep(1500)
    }
  }

  // ──────────── Phase 3: Pipeline T2I → Video ────────────

  console.log('\n┌─────────────────────────────────────────────────┐')
  console.log('│  Phase 3: Pipeline — Image → Video              │')
  console.log('└─────────────────────────────────────────────────┘')

  let pipeGenId = null

  for (const c of PIPELINE_JOBS) {
    await waitForQueue()

    try {
      const result = await api('/api/generate/text2image-video', {
        prompt: PROMPTS[0], // use first prompt for image gen
        negativePrompt: NEGATIVE,
        width: 832,
        height: 480,
        steps: c.imgSteps,
        cfg: c.imgCfg,
        seed: -1,
        imageModel: c.imageModel,
        videoPrompt: PIPELINE_VIDEO_PROMPT,
        videoModel: c.videoModel,
        videoSteps: c.videoSteps,
        videoFrames: c.videoFrames,
        videoFps: c.videoFps,
        loraStrength: 1.0,
        imageStrength: 1.0,
        ...(pipeGenId ? { generationId: pipeGenId } : {}),
      })
      if (!pipeGenId) pipeGenId = result.generation?.id
      submitted++
      console.log(`    ✅ [${submitted}/${total}] ${c.label} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
    } catch (e) {
      failed++
      console.error(`    ❌ ${c.label}: ${e.message}`)
    }
    await sleep(2000)
  }

  // ──────────── Summary ────────────

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  🏖️  Beach Sweep v2 Complete!`)
  console.log(`  ✅ Submitted: ${submitted}`)
  console.log(`  ❌ Failed:    ${failed}`)
  console.log(`  📊 Jobs will process via the cron queue.`)
  console.log()
  console.log(`  Generation IDs for gallery grouping:`)
  if (ltxGenId) console.log(`    LTX-2:    ${ltxGenId}`)
  if (wanGenId) console.log(`    WAN 2.2:  ${wanGenId}`)
  if (pipeGenId) console.log(`    Pipeline: ${pipeGenId}`)
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
