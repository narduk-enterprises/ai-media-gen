#!/usr/bin/env node
/**
 * LTX-2 Camera LoRA Batch — Adds dynamic camera movements.
 * Uses the 7 camera LoRAs on the pod for cinematic variety.
 * Submits 25 images × 7 camera styles × 1 motion prompt = 175 jobs.
 */

const API_BASE = 'https://ai-media-gen.nard.uk'
const SESSION_COOKIE = 'session=8133e365-535e-4eaf-b920-4b866b1d942d'
const ENDPOINT = 'https://4rrjaor7zvldlt-8188.proxy.runpod.net'

const IMAGES = [
  { id: '0baf389b-60ea-43e3-b947-2f4d1c6c06f9', prompt: 'Petite white blonde, kneeling on white rug, window light' },
  { id: '3079fe67-0549-4c1e-a603-84d214c54533', prompt: 'Slim brunette, on kitchen island, morning sunlight' },
  { id: '8fc3725b-12f2-4f9c-9232-9161bf507d3f', prompt: 'Tall ginger, leaning on castle wall at dusk' },
  { id: '1dacd26f-88d9-4dc8-8d3c-2a6bbcc5f0c8', prompt: 'Blonde in wildflower field at golden hour' },
  { id: '84d7361c-d6fe-457c-8c33-68586a1fcdf0', prompt: 'Blonde on white silk sheets, morning light' },
  { id: '8173c684-38f4-4ff4-a83a-dabe062c3391', prompt: 'Petite redhead in enchanted forest' },
  { id: '9d71d6ac-d9ae-4ef2-a48e-1f859148db0d', prompt: 'Brunette on velvet chaise, boudoir lighting' },
  { id: 'afb6b571-e63b-4c0b-8ec2-5d824057281d', prompt: 'Ginger at modern loft window, golden hour' },
  { id: 'd72109d6-fcc0-47ce-ade7-bbd4a95daaa4', prompt: 'Blonde at vintage bathtub, candlelight' },
  { id: 'fc551426-3677-4180-9bf6-34134f2c691e', prompt: 'Redhead on autumn leaves in forest' },
  { id: 'be9da73a-ca19-44e7-a0ca-f07d636e07e8', prompt: 'Brunette on mountain balcony at dawn' },
  { id: '184d9f16-210e-4547-9a05-d05fceb2519a', prompt: 'Ginger on picnic blanket in meadow' },
  { id: '2cc1ce1e-39da-4f33-9819-5a2ed5a0656a', prompt: 'Blonde on grand piano, music room' },
  { id: 'ca38d3d2-b8e2-4acb-a6f8-7ec99adb283e', prompt: 'Brunette on cozy loft bed, string lights' },
  { id: 'a7d65df0-3e70-4969-868e-84ed0bd1e293', prompt: 'Redhead in shallow forest stream' },
  { id: 'cc280ea6-c544-47b5-ac18-365dde681afc', prompt: 'Blonde against marble column, bathroom' },
  { id: '110eafca-364b-4961-a14c-910b552a7944', prompt: 'Ginger at hot spring pool under stars' },
  { id: 'cf53b697-d587-419d-937f-de527d15faa4', prompt: 'Brunette on rose petal bed, romantic' },
  { id: 'b73d7d7a-4b01-4796-bfe4-0725cd2cdc57', prompt: 'Blonde in doorway at sunrise' },
  { id: 'c5a8332a-74e1-44b2-9c0b-9523f0d98492', prompt: 'Redhead on library ladder, lamplight' },
  { id: 'a8cbb921-3d40-4d7f-b464-4e4f19a0f311', prompt: 'Blonde kneeling on white rug' },
  { id: '5b832efb-0c24-4ca7-a706-8f65fa9939e2', prompt: 'Brunette on kitchen island' },
  { id: '9a9b29f4-dbf6-4329-a608-9b556f79cb80', prompt: 'Ginger at castle wall, dusk' },
  { id: 'f87eb797-fdc4-443a-8a56-cbd1933a8da7', prompt: 'Blonde in wildflower field' },
  { id: '70f03a39-0956-4e7e-ae2e-51608345cef2', prompt: 'Blonde on silk sheets' },
]

// Camera LoRA names available on the pod
const CAMERA_LORAS = [
  'dolly-in',
  'dolly-out',
  'dolly-left',
  'dolly-right',
  'jib-up',
  'jib-down',
  'static',
]

async function submitVideo(mediaItemId, prompt, cameraLora, audioPrompt) {
  const body = {
    mediaItemId,
    model: 'ltx2',
    prompt,
    negativePrompt: 'worst quality, blurry, distorted, deformed, bad anatomy, watermark, text, static, frozen',
    numFrames: 161,
    steps: 25,
    width: 832,
    height: 480,
    fps: 24,
    loraStrength: 0.7,
    imageStrength: 0.6,
    cameraLora,
    audioPrompt,
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
  return {
    queued: items.filter(i => i.status === 'queued').length,
    processing: items.filter(i => i.status === 'processing').length,
  }
}

async function main() {
  const total = IMAGES.length * CAMERA_LORAS.length
  console.log('═══════════════════════════════════════════════')
  console.log('  🎥 LTX-2 Camera LoRA Batch')
  console.log(`  ${IMAGES.length} images × ${CAMERA_LORAS.length} camera styles = ${total} jobs`)
  console.log(`  Cameras: ${CAMERA_LORAS.join(', ')}`)
  console.log('═══════════════════════════════════════════════')

  let submitted = 0, failed = 0

  for (let i = 0; i < IMAGES.length; i++) {
    const image = IMAGES[i]
    console.log(`\n─── Image ${i + 1}/${IMAGES.length}: ${image.id.slice(0, 8)} [CAM] ───`)

    for (const cam of CAMERA_LORAS) {
      while (true) {
        const s = await getQueueStatus()
        if (s.queued + s.processing < 20) break
        console.log(`    ⏳ Queue full, waiting 90s...`)
        await new Promise(r => setTimeout(r, 90000))
      }

      const prompt = `She slowly moves with natural subtle motion, cinematic ${cam.replace('-', ' ')} camera movement revealing her beauty, soft ambient lighting, professional cinematography`
      const audio = 'soft ambient music, gentle breathing, atmospheric sounds'

      try {
        const result = await submitVideo(image.id, prompt, cam, audio)
        submitted++
        console.log(`    ✅ [${cam}] → ${result.item?.id?.slice(0, 8) || 'ok'}`)
      } catch (e) {
        failed++
        console.error(`    ❌ [${cam}] ${e.message}`)
      }

      await new Promise(r => setTimeout(r, 2500))
    }
  }

  console.log(`\n═══ CAMERA BATCH DONE: ✅ ${submitted}, ❌ ${failed} ═══`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
