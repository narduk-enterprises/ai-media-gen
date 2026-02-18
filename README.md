# AI Media Gen

Generate AI images, videos, and audio using personas and scenes. Built with Nuxt 4, Nuxt UI v4, and deployed on Cloudflare Workers with D1 + R2.

## Stack

- **Nuxt 4** + **Nuxt UI v4** + **Tailwind CSS 4**
- **Cloudflare Workers** — Edge runtime
- **Cloudflare D1** — SQLite database for generations and media items
- **Cloudflare R2** — Object storage for generated media files
- **RunPod** — GPU inference for image/video generation
- **Drizzle ORM** — Type-safe database queries

## Quick Start

```bash
npm install
npm run dev
```

### Deploy

```bash
npm run deploy          # Build + deploy to Cloudflare Workers
```

Auto-deploys on push to `main` via GitHub Actions. Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets.

### Environment

Set these in Doppler or `.env`:

| Variable | Description |
|---|---|
| `AI_API_KEY` | RunPod API key |
| `AI_API_URL` | RunPod full endpoint URL |
| `AI_API_URL_SLIM` | RunPod slim endpoint URL |
| `SITE_URL` | Production URL |

## How It Works

The app has two creation modes:

### Mode 1: Persona + Scene

Batch-generate images by combining a **persona** (character) with one or more **scenes** (environment/composition). The prompt builder concatenates all the fields into a single Stable Diffusion prompt.

### Mode 2: Free Build

Write a prompt directly and optionally fill in individual attribute slots (scene, pose, style, lighting, etc.) to compose a structured prompt.

---

## Writing Personas

A persona defines a character's visual identity — think of it as a casting sheet. The same persona can be reused across different scenes to keep a character consistent.

### Fields

| Field | What it does | Example |
|---|---|---|
| **Name** | Label for your reference only (not sent to the model) | `Cyber Girl` |
| **Description** | The most important field. A short phrase the model sees directly. Include age, gender, expression, and distinguishing features. | `25 year old woman, athletic build, confident expression, slight smile` |
| **Hair** | Hair color, length, and style. Be specific. | `long flowing black hair with blue highlights` |
| **Eyes** | Eye color and shape. | `piercing blue eyes` |
| **Body Type** | Build and stature. | `athletic and toned` |
| **Skin Tone** | Skin description. | `warm olive skin` |
| **Clothing** | What they're wearing. | `black leather jacket over a white crop top, dark jeans` |

### Tips

- **Description is king.** If you only fill one field, make it this one. Everything else is additive.
- **Be visual, not abstract.** The model needs physical descriptions it can render. *"confident"* is fine as a modifier, but pair it with something concrete: *"confident expression, standing tall."*
- **Skip what doesn't matter.** Leave fields blank if you don't need consistency there. A blank field won't constrain the output.
- **Use natural language.** Write the way you'd describe someone to an artist: *"short platinum blonde pixie cut"* not *"hair: platinum, length: short, style: pixie."*
- **Test with one image first.** Generate a single image to see how your persona renders before doing a big batch.

### Example Persona

```
Name:        Neon Hacker
Description: 22 year old woman, sharp features, intense gaze, cyberpunk aesthetic
Hair:        short asymmetric neon pink hair with shaved side
Eyes:        glowing violet eyes
Body Type:   slim and wiry
Skin Tone:   pale ivory skin with circuit-board tattoos on neck
Clothing:    oversized black hoodie, holographic visor pushed up on forehead
```

---

## Writing Scenes

A scene defines everything about the environment and composition — where the character is, what they're doing, and how the shot looks. You select one or more scenes on the Create page and the app generates one image per persona-scene combination.

### Fields

| Field | What it does | Example |
|---|---|---|
| **Scene** | The location or setting. Paint the environment. | `neon-lit rainy alleyway at midnight, puddles reflecting signs` |
| **Pose** | What the subject is doing. Action or stance. | `leaning against a wall, arms crossed, looking at camera` |
| **Style** | The artistic rendering style. | `cinematic`, `anime`, `photorealistic`, `oil painting` |
| **Lighting** | How the scene is lit. Huge impact on mood. | `neon glow with volumetric fog`, `golden hour warmth` |
| **Mood** | The emotional tone of the image. | `mysterious`, `serene`, `intense`, `dreamlike` |
| **Camera** | Shot type and composition. | `close-up portrait`, `wide angle establishing shot`, `low angle heroic` |

### Tips

- **Scene + Lighting = atmosphere.** These two fields together define 80% of the vibe. A forest glade with *"golden hour warmth"* feels completely different than with *"moonlit silver."*
- **Leave fields blank for variety.** Any blank field gets filled with a random preset at generation time. This is great for exploration — lock the fields you care about and let the rest surprise you.
- **Camera matters more than you think.** A *"close-up portrait"* of the same scene will look radically different from a *"wide angle establishing shot."* Try different cameras with the same scene.
- **Style is a strong lever.** Changing just the style from *"photorealistic"* to *"anime"* or *"oil painting"* transforms everything.
- **Mood is subtle but real.** It nudges color palette and expression. *"melancholic"* tends toward cooler tones and subdued expressions.

### Example Scene

```
Name:      Neon City Night
Scene:     neon-lit rainy alleyway at midnight, puddles reflecting holographic signs
Pose:      walking toward camera, hands in pockets
Style:     cinematic
Lighting:  neon glow with volumetric fog rays
Mood:      mysterious
Camera:    medium shot, rule of thirds
```

---

## Combining Personas + Scenes

On the **Create** page in Persona + Scene mode:

1. **Pick a persona** (or leave it on "None" for no character)
2. **Select one or more scenes** (click to toggle; click the dice for a random scene)
3. **Set "Per scene"** count — how many images per scene (each gets slight random variation)
4. **Hit Generate**

The prompt builder composes the final prompt by joining:

```
[base prompt], [description], [hair], [eyes], [body type], [skin tone], [clothing], [scene], [pose], [style] style, [lighting] lighting, [mood] mood, [camera]
```

Empty fields are skipped. With 3 scenes at 2 per scene, you get 6 images in one batch.

## Import / Export JSON Schema

Use the **Import JSON** button on the Personas & Scenes page to bulk-import. Export copies JSON to your clipboard. You can import a single object or an array of objects.

### Persona Schema

```json
{
  "name": "Neon Hacker",
  "description": "22 year old woman, sharp features, intense gaze, cyberpunk aesthetic",
  "hair": "short asymmetric neon pink hair with shaved side",
  "eyes": "glowing violet eyes",
  "bodyType": "slim and wiry",
  "skinTone": "pale ivory skin with circuit-board tattoos on neck",
  "clothing": "oversized black hoodie, holographic visor pushed up on forehead"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name for the persona |
| `description` | string | no | Free-text character description (injected directly into prompt) |
| `hair` | string | no | Hair color, length, style |
| `eyes` | string | no | Eye color and shape |
| `bodyType` | string | no | Build and stature |
| `skinTone` | string | no | Skin description |
| `clothing` | string | no | What they're wearing |

Import multiple at once:

```json
[
  { "name": "Cyber Girl", "description": "25yo hacker", "hair": "neon pink pixie cut", "eyes": "glowing blue" },
  { "name": "Forest Elf", "description": "ancient elf, ethereal beauty", "hair": "long silver hair", "eyes": "emerald green" }
]
```

### Scene Schema

```json
{
  "name": "Neon City Night",
  "scene": "neon-lit rainy alleyway at midnight, puddles reflecting holographic signs",
  "pose": "walking toward camera, hands in pockets",
  "style": "cinematic",
  "lighting": "neon glow with volumetric fog rays",
  "mood": "mysterious",
  "camera": "medium shot, rule of thirds"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name for the scene |
| `scene` | string | no | Location / setting description |
| `pose` | string | no | Subject action or stance |
| `style` | string | no | Artistic rendering style |
| `lighting` | string | no | How the scene is lit |
| `mood` | string | no | Emotional tone |
| `camera` | string | no | Shot type and composition |

Import multiple at once:

```json
[
  { "name": "Forest Glade", "scene": "enchanted forest glade", "style": "photorealistic", "lighting": "golden hour warmth" },
  { "name": "Space Station", "scene": "space station interior", "style": "cinematic", "lighting": "harsh single spotlight", "mood": "intense" }
]
```

All non-`name` fields are optional. Missing fields are treated as blank and will either be skipped in prompt building or filled with a random preset at generation time (depending on the mode).

---

## Data Storage

- **Personas & scenes** are stored in your browser's `localStorage`. They do not sync across devices or browsers. Use the Export/Import JSON buttons on the Personas page to back them up.
- **Generated images/videos** are stored server-side in Cloudflare D1 (metadata) and R2 (files) and appear in the Gallery.
