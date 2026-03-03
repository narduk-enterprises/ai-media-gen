#!/usr/bin/env node
/**
 * Overnight Batch Video Generator
 * 
 * Takes the last 25 images, generates motion/audio-rich video prompts,
 * and submits I2V jobs with varied parameter combinations.
 * 
 * Results appear in the gallery via the normal queue processing pipeline.
 */

const API_BASE = 'https://ai-media-gen.narduk.workers.dev'
const SESSION_COOKIE = 'session=8133e365-535e-4eaf-b920-4b866b1d942d'
const ENDPOINT = 'https://4rrjaor7zvldlt-8188.proxy.runpod.net'

// All 25 source images with their original prompts
const IMAGES = [
  { id: '0baf389b-60ea-43e3-b947-2f4d1c6c06f9', prompt: 'Petite white blonde 20, naked, tiny frame, kneeling forward on soft white rug, innocent face looking back over shoulder, soft natural window light' },
  { id: '3079fe67-0549-4c1e-a603-84d214c54533', prompt: 'Slim white brunette 25, nude, lithe body, sitting on kitchen island, morning sunlight streaming in, playful yet seductive expression' },
  { id: '8fc3725b-12f2-4f9c-9232-9161bf507d3f', prompt: 'Tall slender white ginger 26, naked, long elegant legs, leaning against castle stone wall at dusk, medieval fantasy atmosphere, dramatic lighting' },
  { id: '1dacd26f-88d9-4dc8-8d3c-2a6bbcc5f0c8', prompt: 'Freckled pale white blonde 23, nude, lying on back in wildflower field at golden hour, serene aroused expression, natural outdoor beauty' },
  { id: '84d7361c-d6fe-457c-8c33-68586a1fcdf0', prompt: 'Slender white blonde 24, fully naked, slim athletic body, lying back on white silk sheets in soft morning light, seductive half-lidded eyes looking directly at camera' },
  { id: '8173c684-38f4-4ff4-a83a-dabe062c3391', prompt: 'Petite white redhead 22, completely nude, delicate slender frame, small natural breasts, kneeling on soft moss in enchanted forest dappled sunlight' },
  { id: '9d71d6ac-d9ae-4ef2-a48e-1f859148db0d', prompt: 'Slim white brunette 25, naked, narrow hourglass figure, reclining on luxurious velvet chaise in dimly lit boudoir, cinematic moody lighting' },
  { id: 'afb6b571-e63b-4c0b-8ec2-5d824057281d', prompt: 'Tall slender white ginger 23, nude, elegant long legs, standing against modern loft window at golden hour, confident direct gaze' },
  { id: 'd72109d6-fcc0-47ce-ade7-bbd4a95daaa4', prompt: 'Petite white blonde 21, naked, tiny waist, sitting on edge of vintage bathtub with warm candlelight, shy yet inviting smile' },
  { id: 'fc551426-3677-4180-9bf6-34134f2c691e', prompt: 'Slender white redhead 26, fully nude, pale freckled skin, lying on her side on autumn leaf bed in forest clearing, warm sunset glow' },
  { id: 'be9da73a-ca19-44e7-a0ca-f07d636e07e8', prompt: 'Slim white brunette 24, naked, lithe athletic build, bent forward over wooden railing on mountain balcony at dawn, sensual arched back' },
  { id: '184d9f16-210e-4547-9a05-d05fceb2519a', prompt: 'Freckled white ginger 20, nude, slender delicate frame, sitting on picnic blanket in wildflower meadow, innocent yet aroused expression' },
  { id: '2cc1ce1e-39da-4f33-9819-5a2ed5a0656a', prompt: 'Slender white blonde 27, completely naked, long toned limbs, reclining nude on grand piano lid in elegant music room, sophisticated seductive gaze' },
  { id: 'ca38d3d2-b8e2-4acb-a6f8-7ec99adb283e', prompt: 'Petite white brunette 23, naked, narrow hips, lying on stomach then lifting hips high on cozy loft bed, soft bedroom string lights' },
  { id: 'a7d65df0-3e70-4969-868e-84ed0bd1e293', prompt: 'Slim white redhead 25, nude, pale skin densely freckled, standing in shallow forest stream, water lapping at thighs, ethereal natural beauty' },
  { id: 'cc280ea6-c544-47b5-ac18-365dde681afc', prompt: 'Tall white blonde 26, naked, elegant slim proportions, leaning back against marble column in luxurious bathroom, steamy mirror reflection' },
  { id: '110eafca-364b-4961-a14c-910b552a7944', prompt: 'Slender white ginger 24, nude, heavy freckles, sitting on edge of hot spring pool at night under stars, steam rising around her' },
  { id: 'cf53b697-d587-419d-937f-de527d15faa4', prompt: 'Petite freckled white brunette 22, naked, lying on back on rose-petal-covered bed, aroused flush across chest, soft romantic lighting' },
  { id: 'b73d7d7a-4b01-4796-bfe4-0725cd2cdc57', prompt: 'Slim white blonde 28, nude, toned slender figure, standing in open doorway to balcony at sunrise, golden light caressing every curve' },
  { id: 'c5a8332a-74e1-44b2-9c0b-9523f0d98492', prompt: 'Slender white redhead 27, naked, dense freckles, reclining on antique library ladder, bookshelves background, warm lamplight, sophisticated intimate portrait' },
  { id: 'a8cbb921-3d40-4d7f-b464-4e4f19a0f311', prompt: 'Petite white blonde 20, naked, tiny frame, kneeling forward on soft white rug, innocent face looking back over shoulder, soft natural window light' },
  { id: '5b832efb-0c24-4ca7-a706-8f65fa9939e2', prompt: 'Slim white brunette 25, nude, lithe body, sitting on kitchen island, morning sunlight streaming in, playful yet seductive expression' },
  { id: '9a9b29f4-dbf6-4329-a608-9b556f79cb80', prompt: 'Tall slender white ginger 26, naked, long elegant legs, leaning against castle stone wall at dusk, medieval fantasy atmosphere, dramatic lighting' },
  { id: 'f87eb797-fdc4-443a-8a56-cbd1933a8da7', prompt: 'Freckled pale white blonde 23, nude, lying on back in wildflower field at golden hour, serene expression, natural outdoor beauty' },
  { id: '70f03a39-0956-4e7e-ae2e-51608345cef2', prompt: 'Slender white blonde 24, fully naked, slim athletic body, lying back on white silk sheets in soft morning light, seductive half-lidded eyes' },
]

// ─── Video prompt generators ──────────────────────────
// Each function takes the image context and generates a motion-rich video prompt

function generateVideoPrompts(imagePrompt) {
  const context = imagePrompt.toLowerCase()
  
  // Determine setting-appropriate motions
  const isOutdoor = context.includes('field') || context.includes('forest') || context.includes('stream') || context.includes('meadow') || context.includes('mountain') || context.includes('garden')
  const isLuxury = context.includes('silk') || context.includes('velvet') || context.includes('marble') || context.includes('piano') || context.includes('library') || context.includes('boudoir')
  const isBath = context.includes('bathtub') || context.includes('hot spring') || context.includes('bathroom') || context.includes('steam')
  const isCastle = context.includes('castle') || context.includes('medieval')
  
  const prompts = []
  
  // Prompt 1: Gentle sensual movement with environment interaction
  if (isOutdoor) {
    prompts.push(`She slowly turns her head toward camera with a subtle knowing smile, breeze gently playing through her hair, wildflowers swaying, warm golden sunlight, birds singing softly in background, cinematic slow motion, natural ambient sounds`)
  } else if (isBath) {
    prompts.push(`She slowly leans back and stretches sensually, fingers trailing through warm water creating gentle ripples, steam curling around her body, candlelight flickering, soft splashing water sounds, intimate atmosphere, slow cinematic motion`)
  } else if (isCastle) {
    prompts.push(`She slowly steps forward from the stone wall, torch flames flickering behind her casting dancing shadows, her hair catching the firelight as she turns gracefully, ambient medieval sounds, wind howling softly, cinematic dramatic motion`)
  } else if (isLuxury) {
    prompts.push(`She slowly stretches and arches her back luxuriously, fingers trailing along the fabric beneath her, subtle light shifts as she moves, silk rustling softly, intimate breathing sounds, elegant slow motion, warm ambient light`)
  } else {
    prompts.push(`She slowly turns to face the camera with a sultry smile, soft natural light shifting across her body, hair gently moving, subtle breathing, intimate ambient atmosphere, cinematic slow motion, warm tones`)
  }
  
  // Prompt 2: More dynamic motion
  prompts.push(`She runs her fingers slowly through her hair and tilts her head back with eyes closing in pleasure, body gently swaying, soft moaning sounds, ambient music, cinematic medium close-up, warm sensual lighting, smooth camera dolly`)
  
  // Prompt 3: Camera movement focused
  prompts.push(`Slow cinematic camera orbit around her as she holds still with a confident gaze, dramatic lighting shifts reveal her figure from new angles, ambient atmospheric music, professional cinematography, shallow depth of field`)
  
  return prompts
}

// ─── Parameter variations ──────────────────────────────
// Different parameter combinations to test quality
const PARAM_SETS = [
  // Set A: High motion, balanced quality
  { imageStrength: 0.65, loraStrength: 0.7, steps: 25, numFrames: 161, fps: 24, audioPrompt: null },
  // Set B: Moderate motion, higher quality 
  { imageStrength: 0.8, loraStrength: 0.6, steps: 30, numFrames: 121, fps: 24, audioPrompt: null },
  // Set C: Maximum motion, longer clip
  { imageStrength: 0.5, loraStrength: 0.8, steps: 20, numFrames: 241, fps: 24, audioPrompt: null },
]

// Audio prompts per scene type
function getAudioPrompt(imagePrompt) {
  const ctx = imagePrompt.toLowerCase()
  if (ctx.includes('field') || ctx.includes('meadow') || ctx.includes('forest'))
    return 'birdsong, gentle wind through leaves, natural ambient sounds, soft breathing'
  if (ctx.includes('bathtub') || ctx.includes('hot spring') || ctx.includes('stream'))
    return 'gentle water splashing, soft breathing, ambient dripping sounds'
  if (ctx.includes('castle') || ctx.includes('medieval'))
    return 'crackling torches, wind howling through stone corridors, ambient footsteps'
  if (ctx.includes('piano') || ctx.includes('music'))
    return 'soft piano notes, gentle breathing, silk rustling'
  if (ctx.includes('kitchen') || ctx.includes('morning'))
    return 'morning birdsong through open window, soft breathing, distant coffee maker'
  return 'soft ambient music, gentle breathing, fabric rustling, intimate atmosphere'
}

// ─── API submission ────────────────────────────────────

async function submitVideo(mediaItemId, prompt, params, audioPrompt) {
  const body = {
    mediaItemId,
    model: 'ltx2',
    prompt,
    negativePrompt: 'worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo, static, no motion, frozen',
    numFrames: params.numFrames,
    steps: params.steps,
    width: 832,
    height: 480,
    fps: params.fps,
    loraStrength: params.loraStrength,
    imageStrength: params.imageStrength,
    audioPrompt: audioPrompt || undefined,
    endpoint: ENDPOINT,
  }

  const resp = await fetch(`${API_BASE}/api/generate/video`, {
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
    throw new Error(`${resp.status}: ${text.slice(0, 200)}`)
  }

  return await resp.json()
}

async function getQueueStatus() {
  const resp = await fetch(`${API_BASE}/api/generate/my-queue`, {
    headers: { 'Cookie': SESSION_COOKIE, 'x-requested-with': 'XMLHttpRequest' },
  })
  if (!resp.ok) return { queued: 99, processing: 99 }
  const data = await resp.json()
  const items = data.items || []
  const queued = items.filter(i => i.status === 'queued').length
  const processing = items.filter(i => i.status === 'processing').length
  return { queued, processing, total: items.length }
}

// ─── Main batch runner ─────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  🎬 Overnight Video Batch Generator')
  console.log(`  ${IMAGES.length} images × 3 prompts × 3 param sets`)
  console.log(`  Total jobs to submit: ${IMAGES.length * 3 * 3}`)
  console.log('═══════════════════════════════════════════════')

  let submitted = 0
  let failed = 0
  let skipped = 0

  for (let imgIdx = 0; imgIdx < IMAGES.length; imgIdx++) {
    const image = IMAGES[imgIdx]
    const videoPrompts = generateVideoPrompts(image.prompt)
    const audioPrompt = getAudioPrompt(image.prompt)

    console.log(`\n─── Image ${imgIdx + 1}/${IMAGES.length}: ${image.id.slice(0, 8)} ───`)
    console.log(`    Scene: ${image.prompt.slice(0, 80)}...`)

    for (let pIdx = 0; pIdx < videoPrompts.length; pIdx++) {
      const prompt = videoPrompts[pIdx]

      for (let sIdx = 0; sIdx < PARAM_SETS.length; sIdx++) {
        const params = PARAM_SETS[sIdx]
        
        // Check queue — wait if too full
        while (true) {
          const status = await getQueueStatus()
          if (status.queued + status.processing < 15) break
          console.log(`    ⏳ Queue full (${status.queued}q + ${status.processing}p), waiting 60s...`)
          await new Promise(r => setTimeout(r, 60000))
        }

        const label = `P${pIdx + 1}/S${String.fromCharCode(65 + sIdx)}`
        try {
          const result = await submitVideo(
            image.id,
            prompt,
            params,
            audioPrompt,
          )
          submitted++
          console.log(`    ✅ [${label}] img=${params.imageStrength} lora=${params.loraStrength} steps=${params.steps} frames=${params.numFrames} → ${result.item?.id?.slice(0, 8) || 'ok'}`)
        } catch (e) {
          failed++
          console.error(`    ❌ [${label}] ${e.message}`)
        }

        // Small delay between submissions to avoid rate limiting
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log(`  ✅ Submitted: ${submitted}`)
  console.log(`  ❌ Failed: ${failed}`)
  console.log(`  ⏭️  Skipped: ${skipped}`)
  console.log('  📊 Jobs will process via cron queue')
  console.log('═══════════════════════════════════════════════')
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
