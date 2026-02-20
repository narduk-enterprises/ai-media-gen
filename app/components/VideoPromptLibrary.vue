<script setup lang="ts">
export interface VideoPreset {
  id: string
  title: string
  emoji: string
  category: string
  prompt: string
  audioPrompt: string
  negativePrompt: string
  model: string
  steps: number
  frames: number
  resolution: { w: number; h: number }
}

const emit = defineEmits<{
  select: [preset: VideoPreset]
}>()

const search = ref('')
const selectedCategory = ref('all')

const presets: VideoPreset[] = [
  // ── Party & Lifestyle ───────────────────────────────────────────────
  {
    id: 'golf-cart-golden',
    title: 'Golden Hour Golf Cart',
    emoji: '⛳',
    category: 'lifestyle',
    prompt: 'A stunning young woman with sun-kissed skin and flowing blonde hair sits in the passenger seat of a white golf cart cruising down a lush green fairway. She wears oversized sunglasses and a fitted tank top, casually sipping from a cold beer can with condensation dripping down the sides. The golden hour sunlight catches her hair as the cart rolls gently over the manicured grass, palm trees swaying in the warm breeze behind her. She laughs and tilts her head back, the camera tracking smoothly alongside the cart in a medium close-up. The sky is a gradient of warm orange and soft pink as the sun dips low on the horizon.',
    audioPrompt: 'golf cart electric motor humming, beer can cracking open and fizzing, woman laughing, birds chirping in background, gentle wind through palm trees',
    negativePrompt: 'worst quality, blurry, distorted, deformed, disfigured, bad anatomy, watermark, text, logo',
    model: 'ltx2', steps: 20, frames: 97,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'pool-party',
    title: 'Pool Party Vibes',
    emoji: '🏊',
    category: 'lifestyle',
    prompt: 'A lively pool party scene at a luxurious tropical villa. Beautiful women in colorful bikinis lounge on inflatable flamingos and unicorns floating in crystal-clear turquoise water. One woman cannonballs into the pool creating a massive splash in slow motion. LED lights glow beneath the water surface casting dancing reflections on the surrounding white marble deck. A DJ booth sits at the far end with pulsing colored lights. The camera glides smoothly over the water surface capturing the energy and joy of the celebration. Palm trees frame the scene against a deep blue twilight sky.',
    audioPrompt: 'splashing water, muffled bass music, laughter, tropical birds, ice clinking in glasses',
    negativePrompt: 'worst quality, blurry, distorted, deformed, watermark, text',
    model: 'ltx2', steps: 20, frames: 97,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'yacht-sunset',
    title: 'Yacht at Sunset',
    emoji: '🛥️',
    category: 'lifestyle',
    prompt: 'A gorgeous woman in a flowing white dress stands at the bow of a sleek luxury yacht cutting through calm ocean waters at sunset. Her hair and dress billow dramatically in the warm sea breeze. She holds a champagne glass that catches the golden light, tiny bubbles visible rising inside. The camera slowly orbits around her from a low angle, revealing the breathtaking panorama of the open ocean painted in shades of coral, amber, and deep purple. The yacht leaves a gentle wake trail in the glassy water behind her. Lens flares streak through the frame as the sun touches the horizon.',
    audioPrompt: 'ocean waves lapping against hull, wind in canvas, champagne fizzing, seagulls in the distance, gentle engine hum',
    negativePrompt: 'worst quality, blurry, distorted, deformed, bad anatomy, watermark, text',
    model: 'ltx2', steps: 20, frames: 121,
    resolution: { w: 1280, h: 720 },
  },

  // ── Action & Sports ─────────────────────────────────────────────────
  {
    id: 'surf-barrel',
    title: 'Barrel Wave Surfing',
    emoji: '🏄',
    category: 'action',
    prompt: 'Inside a massive curling barrel wave, a skilled female surfer carves through the crystal-clear turquoise tube. The water forms a perfect cylinder around her as she crouches low on her board, one hand trailing through the glassy wall of water. Sunlight refracts through the wave creating prismatic rainbow patterns and dancing light caustics on her sun-tanned skin. Water droplets spray in slow motion from the lip of the wave. The camera is mounted inside the barrel looking back at her with the bright circular opening of the wave behind. The deep aquamarine and emerald colors of the ocean are vivid and saturated.',
    audioPrompt: 'crashing waves, rushing water inside barrel, seagulls, distant ocean roar, water droplets splashing',
    negativePrompt: 'worst quality, blurry, distorted, deformed, watermark, text, logo',
    model: 'ltx2', steps: 20, frames: 65,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'drift-car',
    title: 'Midnight Drift',
    emoji: '🏎️',
    category: 'action',
    prompt: 'A matte black sports car drifts sideways through a rain-soaked city intersection at night, tires smoking and throwing up sheets of water that catch the neon reflections from surrounding buildings. Red and blue neon signs reflect off the wet asphalt creating streaks of vivid color. The camera captures the action from a low tracking shot alongside the car, showing the aggressive tire angle and white tire smoke billowing into the humid night air. Street lights create starburst flares through the mist. Sparks fly briefly as the undercarriage clips a manhole cover. The entire scene has a cinematic teal and orange color grade.',
    audioPrompt: 'tires screeching loudly, powerful engine revving, splashing water on wet road, distant city ambient, exhaust popping',
    negativePrompt: 'worst quality, blurry, distorted, deformed, watermark, text, amateur',
    model: 'ltx2', steps: 20, frames: 97,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'skydive',
    title: 'Freefall Jump',
    emoji: '🪂',
    category: 'action',
    prompt: 'First-person POV of a skydiver free-falling through a brilliant blue sky with scattered white clouds far below. The ground is a patchwork of green farmland and winding rivers thousands of feet below, growing gradually larger. Other jumpers in colorful suits fall nearby in formation, their suits rippling violently in the 120mph wind. The jumper extends their arms and legs into a stable position, their altimeter visible on their wrist showing rapid descent. Sunlight glints off goggles as they look around at the breathtaking panoramic view of the curvature of the earth on the distant horizon.',
    audioPrompt: 'intense rushing wind, fabric flapping rapidly, muffled heartbeat, exhilarated breathing, wind howling past helmet',
    negativePrompt: 'worst quality, blurry, distorted, deformed, watermark, text',
    model: 'ltx2', steps: 20, frames: 121,
    resolution: { w: 1280, h: 720 },
  },

  // ── Nature & Cinematic ──────────────────────────────────────────────
  {
    id: 'aurora-cabin',
    title: 'Northern Lights Cabin',
    emoji: '🏔️',
    category: 'nature',
    prompt: 'A cozy wooden cabin sits alone in a snow-covered Scandinavian landscape under a spectacular display of northern lights. Vivid green and purple aurora borealis ribbons dance and pulse across the dark starry sky, their movement reflected in a perfectly still frozen lake in the foreground. Warm golden light spills from the cabin windows creating long shadows on the pristine snow. Wisps of smoke curl up from the stone chimney into the frigid night air. The camera slowly pushes in toward the cabin, revealing snow-laden pine trees framing the scene. Stars twinkle between the aurora curtains.',
    audioPrompt: 'crackling fire inside cabin, howling arctic wind, snow crunching, distant wolf howl, complete silence between gusts',
    negativePrompt: 'worst quality, blurry, distorted, watermark, text',
    model: 'ltx2', steps: 20, frames: 121,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'underwater-reef',
    title: 'Coral Reef Dive',
    emoji: '🐠',
    category: 'nature',
    prompt: 'A vibrant coral reef teeming with tropical fish filmed in crystal-clear underwater footage. Schools of electric blue tangs and orange clownfish weave between branching coral formations in every shade of pink, purple, and yellow. A massive sea turtle glides gracefully through the frame, its ancient shell covered in patterns of green and brown. Shafts of golden sunlight pierce down through the water from the surface above, creating volumetric god rays that sweep across the reef as gentle currents sway the sea fans. Tiny particles float in the water like underwater snow. The camera drifts slowly forward through this underwater paradise.',
    audioPrompt: 'underwater ambience, muffled bubbles rising, gentle water current, distant whale song, diver breathing through regulator',
    negativePrompt: 'worst quality, blurry, distorted, watermark, text',
    model: 'ltx2', steps: 20, frames: 97,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'lightning-storm',
    title: 'Desert Lightning Storm',
    emoji: '⛈️',
    category: 'nature',
    prompt: 'A massive supercell thunderstorm rolls across a flat desert landscape at dusk, its towering cumulonimbus clouds lit from within by rapid-fire lightning bolts. Multiple branching lightning strikes illuminate the scene in stark white and electric purple, revealing the dramatic rotating mesocyclone structure of the storm. Red desert sand stretches to the horizon beneath the apocalyptic sky. The camera holds steady on a wide shot as the storm advances, each lightning flash revealing new details in the boiling cloud mass. Wind whips dust devils across the foreground. The sky shifts between deep indigo, violent purple, and flash-lit white.',
    audioPrompt: 'deep rolling thunder echoing across desert, howling wind, crackling lightning strikes, rain beginning on dry sand, rumbling bass',
    negativePrompt: 'worst quality, blurry, distorted, watermark, text',
    model: 'ltx2', steps: 20, frames: 121,
    resolution: { w: 1280, h: 720 },
  },

  // ── Sci-Fi & Fantasy ────────────────────────────────────────────────
  {
    id: 'cyberpunk-alley',
    title: 'Cyberpunk Alley',
    emoji: '🌆',
    category: 'scifi',
    prompt: 'A rain-drenched back alley in a futuristic cyberpunk city, narrow and claustrophobic, lined with stacked holographic advertisements in Japanese and Chinese characters that flicker and glitch. A lone figure in a long black trenchcoat walks away from the camera, their silhouette reflected in countless puddles on the ground. Steam rises from grated vents in the floor. Flying cars streak past overhead between impossibly tall buildings, their headlights leaving trails of light. Neon signs in hot pink, electric blue, and acid green bathe everything in saturated color. Rain falls in heavy sheets, each drop catching the neon light.',
    audioPrompt: 'heavy rain on metal surfaces, distant hovercars whooshing, electronic billboard buzzing, steam hissing from vents, footsteps splashing in puddles, synthwave bass in distance',
    negativePrompt: 'worst quality, blurry, distorted, deformed, watermark, text, amateur',
    model: 'ltx2', steps: 20, frames: 97,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'dragon-flight',
    title: 'Dragon Flight',
    emoji: '🐉',
    category: 'scifi',
    prompt: 'A massive dragon with iridescent scales of deep emerald and gold soars through towering cloud canyons at sunset. Its enormous wings beat powerfully, each downstroke sending visible ripples through the surrounding clouds. A lone rider in gleaming silver armor sits astride the dragon, cloak streaming behind them in the wind. The setting sun paints the cloudscape in layers of burning orange, deep crimson, and royal purple. The dragon breathes a controlled stream of blue fire that illuminates the clouds from below. The camera tracks alongside in a sweeping aerial shot, capturing the epic scale of both creature and sky.',
    audioPrompt: 'massive wingbeats like thunder, rushing wind at altitude, dragon roar echoing through clouds, fire crackling, armor clinking',
    negativePrompt: 'worst quality, blurry, distorted, deformed, bad anatomy, watermark, text',
    model: 'ltx2', steps: 20, frames: 121,
    resolution: { w: 1280, h: 720 },
  },
  {
    id: 'space-station',
    title: 'Space Station Orbit',
    emoji: '🛸',
    category: 'scifi',
    prompt: 'The exterior of a massive rotating space station orbiting Earth, its ring structure slowly spinning against the backdrop of stars and the blue marble of our planet. Solar panels extend like golden wings catching sunlight, and rows of illuminated windows dot the station hull. A small shuttle approaches the docking bay, its thrusters firing tiny blue jets to adjust trajectory. Earth fills the lower half of the frame, cloud patterns and continent outlines clearly visible. The Milky Way stretches across the background in stunning clarity. The camera slowly dollies along the length of the station revealing its enormous scale.',
    audioPrompt: 'deep space ambient hum, subtle mechanical whirring, radio chatter crackling, thruster bursts, quiet electronic beeping',
    negativePrompt: 'worst quality, blurry, distorted, watermark, text',
    model: 'ltx2', steps: 20, frames: 97,
    resolution: { w: 1280, h: 720 },
  },
]

const categories = computed(() => {
  const cats = new Map<string, string>([
    ['all', '🎬 All'],
    ['lifestyle', '🍹 Lifestyle'],
    ['action', '⚡ Action'],
    ['nature', '🌿 Nature'],
    ['scifi', '🚀 Sci-Fi'],
  ])
  return cats
})

const filteredPresets = computed(() => {
  let list = presets
  if (selectedCategory.value !== 'all') {
    list = list.filter(p => p.category === selectedCategory.value)
  }
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.prompt.toLowerCase().includes(q)
    )
  }
  return list
})

function selectPreset(preset: VideoPreset) {
  emit('select', preset)
}
</script>

<template>
  <div class="space-y-3">
    <!-- Header with search and category filter -->
    <div class="flex items-center gap-2 flex-wrap">
      <div class="flex gap-1">
        <UButton
          v-for="[key, label] in categories"
          :key="key"
          size="xs"
          :variant="selectedCategory === key ? 'soft' : 'ghost'"
          :color="selectedCategory === key ? 'primary' : 'neutral'"
          @click="selectedCategory = key"
        >
          {{ label }}
        </UButton>
      </div>
      <UInput
        v-model="search"
        placeholder="Search..."
        size="xs"
        icon="i-lucide-search"
        class="ml-auto w-36"
      />
    </div>

    <!-- Preset cards grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      <button
        v-for="preset in filteredPresets"
        :key="preset.id"
        class="group text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-950/20 transition-all duration-150 cursor-pointer"
        @click="selectPreset(preset)"
      >
        <div class="flex items-center gap-1.5 mb-1">
          <span class="text-base">{{ preset.emoji }}</span>
          <span class="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{{ preset.title }}</span>
        </div>
        <p class="text-[10px] text-gray-500 line-clamp-2 leading-tight">{{ preset.prompt.slice(0, 100) }}...</p>
        <div class="flex items-center gap-1 mt-1.5">
          <UBadge size="xs" variant="subtle" color="neutral">{{ preset.model }}</UBadge>
          <UBadge v-if="preset.audioPrompt" size="xs" variant="subtle" color="info">🔊</UBadge>
          <span class="text-[9px] text-gray-400 ml-auto">{{ (preset.frames / 24).toFixed(1) }}s</span>
        </div>
      </button>
    </div>

    <p v-if="filteredPresets.length === 0" class="text-xs text-gray-400 text-center py-4">
      No presets match your filter
    </p>
  </div>
</template>
