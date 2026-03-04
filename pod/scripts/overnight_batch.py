#!/usr/bin/env python3
"""
Overnight LTX2 T2V batch — 30-second celebrity videos.
721 frames @ 24fps = 30 seconds each.
Loops every 30 min with fresh seeds until 9 AM CST.
"""
import json, time, random, urllib.request

WORKER_URL = "https://ai-media-gen.nard.uk/api/generate/batch-pipeline"
BATCH_KEY = "overnight-batch-2026"
POD_ENDPOINT = "https://4rrjaor7zvldlt-8188.proxy.runpod.net"

PROMPTS = [
    # ─── BEACH / POOL ───
    "Margot Robbie in a tiny micro string bikini walking along a tropical beach at golden hour, looking directly into camera with a flirty smile, waves crashing at her feet, wind blowing her blonde hair, cinematic lighting, photorealistic, 4k",
    "Sydney Sweeney in a barely-there red micro bikini emerging from a swimming pool, looking straight at camera seductively, water dripping off her body, she pushes her wet hair back, poolside cabana, warm sunset light, slow motion",
    "Scarlett Johansson in a white thong bikini sunbathing on a yacht, she sits up and looks directly at camera with bedroom eyes, sparkling ocean behind, wind catching her hair, golden hour cinematic",
    "Alexandra Daddario in a tiny black string bikini doing a slow-motion run along the beach, staring into camera with piercing blue eyes, waves splashing around her ankles, sunset sky, cinematic tracking shot, photorealistic",
    "Emma Stone in a skimpy coral bikini walking out of turquoise ocean, looking right at camera and biting her lip, water beading on her skin, tropical island, golden light, cinematic slow motion",
    "Jessica Alba in a white micro crochet bikini walking along Malibu beach, looking into camera with a warm smile, golden light reflecting off the water, waves gently rolling in, peaceful cinematic",
    "Blake Lively in a tiny leopard print string bikini running into the ocean waves, laughing and looking at camera, sun-kissed skin, summer vibes, joyful energy, cinematic",
    "Scarlett Johansson in a sheer wet white bikini stepping out of infinity pool overlooking Santorini, looking directly at camera, water cascading off her curves, blue domes behind, luxurious cinematic",
    "Margot Robbie in a metallic gold micro bikini on a yacht deck, she reaches for champagne while looking seductively at camera, sparkling ocean behind, wind catching her hair, luxury lifestyle, golden hour",
    "Emma Stone in a tiny floral string bikini jumping off a cliff into turquoise water, looking at camera mid-air laughing, hair flying up, tropical cliffs, adrenaline rush, gopro style action",
    # ─── POOL PARTY / LUXURY ───
    "Sydney Sweeney in a sheer white micro bikini lounging on a pool float, looking up at camera with half-closed eyes, tropical resort, palm trees, crystal clear water, golden sunlight, luxury vibes",
    "Alexandra Daddario in a neon pink thong bikini doing a cannonball into a pool, looking at camera laughing, splash everywhere, rooftop pool party, Miami skyline, fun energy",
    "Amber Heard in a tiny silver metallic bikini walking along a private beach, staring intensely into camera, wind-swept blonde hair, dramatic waves, moody sunset, cinematic noir beach",
    "Jessica Alba in a barely-there black string bikini stretching by the pool, looking at camera with a relaxed smile, cabana backdrop, tropical flowers, warm afternoon light",
    "Blake Lively in a sheer cover-up over a micro white bikini at a beach bar, looking at camera while sipping a cocktail, tiki torches, sunset behind, vacation energy",
    "Margot Robbie in Barbie pink micro bikini rollerblading down Venice Beach boardwalk, looking at camera smiling, pink sunset, rollerblades matching her outfit, pure joy, cinematic",
    "Emma Stone in a red thong bikini on the bow of a sailboat, wind in her hair, looking at camera with a daring smile, open ocean behind, adventure vibes, golden hour",
    "Scarlett Johansson in a leopard print micro bikini sunbathing on a rooftop in Barcelona, she props herself up on elbows and looks at camera, city skyline, warm European afternoon",
    "Sydney Sweeney in a tiny baby blue string bikini doing yoga on the beach at sunrise, warrior pose, looking at camera peacefully, waves lapping, golden first light, serene",
    "Alexandra Daddario in a sheer wet black one-piece swimsuit walking through a waterfall, looking at camera with smoldering eyes, jungle setting, mist and spray, dramatic lighting",
    # ─── NIGHTLIFE / GLAMOUR ───
    "Margot Robbie in a tight sheer red dress walking down a rain-soaked Manhattan street at night, looking at camera with a confident smile, neon reflections on wet pavement, city lights bokeh, cinematic noir",
    "Scarlett Johansson in a plunging black evening gown descending a grand marble staircase, chandelier light sparkling off her jewelry, she looks directly at camera, old Hollywood glamour",
    "Emma Stone in a sparkly silver mini dress dancing in a nightclub, looking at camera and laughing, strobe lights, confetti falling, she spins, energetic movement, party atmosphere",
    "Sydney Sweeney in a backless gold dress at a rooftop party in Miami, city skyline behind, she dances looking at camera, warm night air, party vibes",
    "Blake Lively in a crystal-covered sheer dress walking the red carpet, cameras flashing everywhere, she poses and looks directly into camera, dramatic lighting, haute couture",
    "Alexandra Daddario in a low-cut burgundy velvet dress at a Venice Film Festival premiere, flashbulbs, she turns and looks at camera with piercing eyes, golden hour Italian light",
    "Jessica Alba in a tight white satin slip dress at a candlelit rooftop dinner, looking at camera seductively while sipping red wine, city lights twinkling behind, intimate atmosphere",
    "Margot Robbie in a sheer black lace bodysuit at a masquerade ball, Venetian mask in hand, looking directly at camera, chandeliers, candlelight, mysterious glamour",
    "Scarlett Johansson in a skin-tight emerald green dress at an awards show, looking at camera with a knowing smile, diamond earrings catching light, red carpet, flashbulbs",
    "Emma Stone in vintage Hollywood lingerie-style slip dress at a penthouse party, looking at camera over her shoulder, city skyline through floor-to-ceiling windows, intimate golden lighting",
    # ─── BOUDOIR / INTIMATE ───
    "Sydney Sweeney in silk sheets in a luxury hotel suite, morning light through sheer curtains, she looks at camera with sleepy bedroom eyes, intimate cinematic, Paris balcony visible",
    "Margot Robbie in a sheer negligee walking to a balcony overlooking the ocean at sunrise, she turns and looks at camera softly, hair messy, golden morning light, dreamy",
    "Blake Lively in a satin robe that's slipping off one shoulder, standing at a vanity mirror, she looks at camera through the reflection, candlelit room, old Hollywood boudoir",
    "Alexandra Daddario in a lace camisole sitting on a windowsill, rain outside, looking at camera with deep blue eyes, moody soft lighting, cozy intimate atmosphere",
    "Emma Stone in an oversized men's button-down shirt barely buttoned, cooking breakfast in a modern kitchen, she looks at camera laughing, morning sunlight streaming in, casual sexy",
    "Scarlett Johansson in a vintage silk slip lounging on a chaise longue, looking at camera with a sultry half-smile, art deco room, soft warm lighting, timeless beauty",
    "Jessica Alba in a white tank top and tiny shorts on a porch swing, summer evening, fireflies, she looks at camera with a warm genuine smile, golden hour, Americana vibes",
    "Sydney Sweeney in a cropped cashmere sweater and matching skirt, fireside in a ski lodge, she looks at camera while holding hot cocoa, snow falling outside, cozy winter luxury",
    "Margot Robbie wrapped in a towel walking out of a steam shower, glass doors fogged, she looks at camera pushing wet hair back, marble bathroom, spa luxury",
    "Blake Lively in a flowing sheer white dress in a field of lavender in Provence, golden hour, she looks at camera while the wind catches the fabric, ethereal beauty",
    # ─── ACTIVE / ADVENTURE ───
    "Emma Stone in athletic bikini top and tiny shorts doing parkour across urban rooftops at sunset, she pauses and looks at camera breathing hard, action movie style, dynamic camera tracking",
    "Scarlett Johansson in a bikini surfing a perfect wave in Hawaii, she looks at camera riding the wave and celebrating, ocean spray, golden sunlight, action footage",
    "Margot Robbie in a flowing bohemian dress running through a sunflower field at golden hour, she stops and looks directly at camera, petals floating, dreamy cinematic",
    "Sydney Sweeney in a sparkly performance outfit dancing on stage, she looks at camera while hitting choreography, dramatic spotlight, concert footage style, energetic",
    "Alexandra Daddario on horseback galloping along a beach at sunset, white dress flowing, she looks back at camera, horse splashing through shallow water, dramatic wide shot, freedom and power",
    "Jessica Alba in a summer dress riding a Vespa through the streets of Rome, she looks at camera laughing as wind catches her hair, historic buildings, Italian holiday vibes",
    "Blake Lively in thigh-high boots and oversized sweater walking through rainy Tokyo streets at night, she looks at camera, neon signs reflecting in puddles, moody aesthetic",
    "Emma Stone in a white tank top and jeans, action movie scene, she does fight choreography then looks at camera with a smirk, warehouse setting, badass energy",
    "Margot Robbie in a tiny white bikini doing a photoshoot on a yacht, professional camera crew visible, she poses and looks into the main camera, BTS fashion shoot vibes",
    "Scarlett Johansson in a sheer swimsuit cover-up walking through a luxury resort at golden hour, she looks at camera confidently, palm trees, infinity pool, travel editorial",
]

NEG = "ugly, blurry, low quality, watermark, text, deformed, bad anatomy, extra limbs, static image, frozen, slideshow, male, man, boy, dark, dimly lit, underexposed"

LIGHTING_BOOST = ", bright midday sun, blazing sunshine, brilliant daylight, sun-kissed glowing skin, vivid saturated colors, high key lighting, crystal clear, professional photography lighting, HDR, ultra sharp 8k"

def submit(prompt, seed=None):
    payload = {
        "mode": "t2v",
        "prompt": prompt + LIGHTING_BOOST,
        "negativePrompt": NEG,
        "width": 768,
        "height": 1152,
        "numFrames": 721,  # 30 seconds @ 24fps
        "steps": 30,
        "model": "ltx2",
        "seed": seed or random.randint(0, 2**32 - 1),
        "endpoint": POD_ENDPOINT,
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(WORKER_URL, data=data, headers={
        "Content-Type": "application/json",
        "X-Batch-Key": BATCH_KEY,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        return result.get("item", {}).get("id", "???")
    except Exception as e:
        body = ""
        if hasattr(e, 'read'):
            try: body = e.read().decode()[:100]
            except: pass
        print(f"  ❌ Failed: {e} {body}")
        return None

STOP_HOUR_UTC = 15  # 9 AM CST
BATCH_INTERVAL = 30 * 60  # 30 minutes

def run_batch(batch_num):
    print(f"\n{'='*60}")
    print(f"  BATCH {batch_num} — {time.strftime('%H:%M:%S %Z')} — {len(PROMPTS)} videos")
    print(f"{'='*60}\n")

    ok = 0
    for i, prompt in enumerate(PROMPTS):
        celeb = prompt.split(" in ")[0] if " in " in prompt else prompt[:30]
        item_id = submit(prompt)
        if item_id:
            print(f"  [{i+1}/{len(PROMPTS)}] ✅ {celeb}")
            ok += 1
        else:
            print(f"  [{i+1}/{len(PROMPTS)}] ❌ {celeb}")
        time.sleep(1)

    print(f"\n  → {ok}/{len(PROMPTS)} queued")
    return ok

def main():
    print(f"🎬 OVERNIGHT LTX2 T2V — 30-SECOND VIDEOS")
    print(f"   {len(PROMPTS)} videos per batch, new batch every 30 min")
    print(f"   721 frames @ 24fps, fresh seeds each time")
    print(f"   Runs until 9 AM CST ({STOP_HOUR_UTC}:00 UTC)")
    print(f"   Started: {time.strftime('%H:%M:%S %Z')}")

    batch = 1
    total = 0

    while True:
        if time.gmtime().tm_hour >= STOP_HOUR_UTC:
            print(f"\n☀️ 9 AM CST — stopping! {total} total videos submitted.")
            break

        count = run_batch(batch)
        total += count
        batch += 1

        print(f"\n  💤 Sleeping 30 min... (total so far: {total})")
        print(f"  ⏰ Next batch at {time.strftime('%H:%M', time.localtime(time.time() + BATCH_INTERVAL))}")
        time.sleep(BATCH_INTERVAL)

    print(f"\n🏁 All done! {total} videos across {batch - 1} batches.")

if __name__ == "__main__":
    main()
