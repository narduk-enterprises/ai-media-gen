#!/usr/bin/env python3
"""
Workflow Loader — Loads ComfyUI JSON templates and injects parameters.
Each workflow lives in its own JSON file under serverless/workflows/.
"""
import copy
import json
import os
import random

import urllib.request

# ── Constants ────────────────────────────────────────────────────────────────

_WORKFLOWS_DIR = os.path.join(os.path.dirname(__file__), "workflows")

DEFAULT_NEG_PROMPT = (
    "worst quality, low quality, blurry, distorted, deformed, disfigured, "
    "bad anatomy, extra limbs, extra fingers, fused fingers, poorly drawn hands, "
    "poorly drawn face, mutation, mutated, ugly, watermark, text, logo, signature, "
    "jpeg artifacts, overexposed, underexposed, static, frozen, "
    "jittery, flickering, noise, grain, out of focus, bad proportions, "
    "cropped, frame, border, cluttered background"
)

LTX2_NEG_PROMPT = (
    "blurry, low quality, still frame, watermark, overlay, titles, subtitles, text, logo"
)

UPSCALE_MODEL = "RealESRGAN_x4plus.pth"
UPSCALE_MODEL_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _seed(seed):
    """Normalise seed: None or negative → random."""
    if seed is None or seed < 0:
        return random.randint(1, 2**53)
    return seed


def _load_template(name):
    """Load a workflow JSON template by name (without .json extension)."""
    path = os.path.join(_WORKFLOWS_DIR, f"{name}.json")
    with open(path, "r") as f:
        return json.load(f)


def _inject(workflow, params):
    """
    Deep-walk the workflow dict and replace {{key}} placeholders with values
    from params. Handles both string values and numeric placeholders.
    """
    result = copy.deepcopy(workflow)
    _walk(result, params)
    return result


def _walk(obj, params):
    """Recursively replace placeholder strings in a dict/list structure."""
    if isinstance(obj, dict):
        for key, val in obj.items():
            if isinstance(val, str) and val.startswith("{{") and val.endswith("}}"):
                param_name = val[2:-2]
                if param_name in params:
                    obj[key] = params[param_name]
            elif isinstance(val, (dict, list)):
                _walk(val, params)
    elif isinstance(obj, list):
        for i, val in enumerate(obj):
            if isinstance(val, str) and val.startswith("{{") and val.endswith("}}"):
                param_name = val[2:-2]
                if param_name in params:
                    obj[i] = params[param_name]
            elif isinstance(val, (dict, list)):
                _walk(val, params)


def _ensure_upscale_model():
    """Download upscale model on first use (~64MB)."""
    dst_dir = "/comfyui/models/upscale_models"
    dst = os.path.join(dst_dir, UPSCALE_MODEL)
    if os.path.isfile(dst):
        return True
    for vol in ["/runpod-volume/models/upscale_models", "/workspace/models/upscale_models"]:
        src = os.path.join(vol, UPSCALE_MODEL)
        if os.path.isfile(src):
            os.makedirs(dst_dir, exist_ok=True)
            os.symlink(src, dst)
            print(f"[Handler] Linked upscale model from {src}")
            return True
    print(f"[Handler] Downloading upscale model ({UPSCALE_MODEL})...")
    os.makedirs(dst_dir, exist_ok=True)
    with urllib.request.urlopen(UPSCALE_MODEL_URL, timeout=120) as resp:
        with open(dst, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                f.write(chunk)
    size_mb = os.path.getsize(dst) / 1024 / 1024
    print(f"[Handler] Upscale model ready ({size_mb:.0f}MB)")
    return True


def _i2v_low_noise_model():
    """Return the best available I2V low-noise model name."""
    preferred = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
    fallback = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
    for d in ["/comfyui/models/diffusion_models", "/comfyui/models/unet"]:
        if os.path.isfile(os.path.join(d, preferred)):
            return preferred
    print(f"[Handler] I2V low-noise model not found, falling back to high-noise")
    return fallback


# =============================================================================
# Text-to-Image Builders
# =============================================================================

def build_text2image_workflow(prompt, negative_prompt="", width=1024, height=1024,
                              steps=52, cfg=3.7, seed=None, lora_strength=1.0,
                              sampler_name="dpmpp_2m_sde", scheduler="karras",
                              custom_loras=None):
    """Wan 2.2 T2I (single frame from T2V model)."""
    seed = _seed(seed)
    wf = _inject(_load_template("wan_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "half_steps": steps // 2,
        "cfg": cfg, "sampler_name": sampler_name, "scheduler": scheduler,
        "seed": seed, "lora_strength": lora_strength,
    })
    # Apply custom LoRA strength overrides if provided
    if custom_loras:
        if "instareal" in custom_loras:
            for node_id in ("90", "92"):  # high-noise and low-noise Instareal
                if node_id in wf:
                    wf[node_id]["inputs"]["strength_model"] = custom_loras["instareal"]
        if "detailz" in custom_loras:
            for node_id in ("91", "93"):  # high-noise and low-noise Detailz
                if node_id in wf:
                    wf[node_id]["inputs"]["strength_model"] = custom_loras["detailz"]
    return wf


def build_qwen_image_workflow(prompt, negative_prompt="", width=1024, height=1024,
                               steps=50, seed=None):
    """Qwen Image T2I with optional Lightning LoRA (auto-enabled at ≤10 steps)."""
    seed = _seed(seed)
    return _inject(_load_template("qwen_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "width": width, "height": height,
        "steps": steps, "seed": seed,
        "use_lightning": True if steps <= 10 else False,
    })


def build_qwen_lora_workflow(prompt, negative_prompt="", width=1024, height=1536,
                              steps=30, cfg=4.0, seed=None, lora_strength=0.75,
                              sampler_name="euler", scheduler="simple"):
    """Qwen Image T2I with blondeCurlyQ2512 LoRA."""
    seed = _seed(seed)
    return _inject(_load_template("qwen_lora_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "cfg": cfg, "seed": seed,
        "lora_strength": lora_strength,
        "sampler_name": sampler_name, "scheduler": scheduler,
    })


def build_flux2_text2image_workflow(prompt, width=1024, height=1024,
                                     steps=20, seed=None, turbo=True):
    """Flux 2 T2I (dev or turbo via LoRA)."""
    seed = _seed(seed)
    wf = _inject(_load_template("flux2_t2i"), {
        "prompt": prompt,
        "width": width, "height": height,
        "steps": steps, "seed": seed,
        "guidance": 3.5 if turbo else 4.0,
        "guider_model_ref": ["68:100", 0] if turbo else ["68:12", 0],
    })
    if turbo:
        wf["68:100"] = {
            "inputs": {
                "lora_name": "Flux_2-Turbo-LoRA_comfyui.safetensors",
                "strength_model": 1.0,
                "model": ["68:12", 0]
            },
            "class_type": "LoraLoaderModelOnly",
            "_meta": {"title": "Load Turbo LoRA"}
        }
    return wf


def build_z_image_workflow(prompt, negative_prompt="", width=1024, height=1536,
                           steps=40, cfg=3.8, seed=None, lora_strength=0.72,
                           sampler_name="dpmpp_2m", scheduler="beta"):
    """Z-Image Base T2I (bf16, max quality)."""
    seed = _seed(seed)
    return _inject(_load_template("z_image_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "cfg": cfg, "seed": seed,
        "sampler_name": sampler_name, "scheduler": scheduler,
        "lora_strength": lora_strength,
    })


def build_z_image_turbo_workflow(prompt, negative_prompt="", width=1024,
                                  height=1536, steps=28, cfg=3.5, seed=None,
                                  sampler_name="dpmpp_2m", scheduler="beta"):
    """Z-Image Turbo T2I (nvfp4 + distill patch LoRA + NSFW Master LoRA)."""
    seed = _seed(seed)
    return _inject(_load_template("z_image_turbo_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "cfg": cfg, "seed": seed,
        "sampler_name": sampler_name, "scheduler": scheduler,
    })



def build_juggernaut_workflow(prompt, negative_prompt="", width=1024,
                               height=1536, steps=30, cfg=5.0, seed=None,
                               sampler_name="dpmpp_2m_sde", scheduler="karras"):
    """Juggernaut XL (SDXL checkpoint, photorealism)."""
    seed = _seed(seed)
    return _inject(_load_template("juggernaut_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "cfg": cfg, "seed": seed,
        "sampler_name": sampler_name, "scheduler": scheduler,
    })


def build_cyberrealistic_workflow(prompt, negative_prompt="", width=1024,
                                   height=1536, steps=30, cfg=5.0, seed=None,
                                   sampler_name="dpmpp_2m_sde",
                                   scheduler="karras",
                                   lora_name=None, lora_strength=0.7):
    """CyberRealistic Pony (SDXL checkpoint), with optional LoRA."""
    seed = _seed(seed)
    wf = _inject(_load_template("sdxl_t2i"), {
        "checkpoint": "cyberrealisticPony_v160.safetensors",
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "cfg": cfg, "seed": seed,
        "sampler_name": sampler_name, "scheduler": scheduler,
    })
    # Inject LoRA loader between checkpoint (10) and KSampler (40)
    if lora_name:
        wf["15"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": lora_name,
                "strength_model": lora_strength,
                "strength_clip": lora_strength,
                "model": ["10", 0],
                "clip": ["10", 1],
            }
        }
        # Rewire KSampler and CLIP to use LoRA output
        wf["40"]["inputs"]["model"] = ["15", 0]
        wf["20"]["inputs"]["clip"] = ["15", 1]
        wf["21"]["inputs"]["clip"] = ["15", 1]
    return wf


def build_qwen_lora_workflow(prompt, negative_prompt="", width=1024,
                              height=1536, steps=30, cfg=4.0, seed=None,
                              lora_strength=0.75,
                              sampler_name="euler", scheduler="simple"):
    """Qwen 2.5 VL 7B + blondeCurlyQ LoRA."""
    seed = _seed(seed)
    wf = _inject(_load_template("qwen_t2i"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "seed": seed,
        "use_lightning": False,
    })
    # Replace the Lightning LoRA with the blondeCurlyQ LoRA
    if "197:189" in wf:
        wf["197:189"]["inputs"]["lora_name"] = "blondeCurlyQ2512.safetensors"
        wf["197:189"]["inputs"]["strength_model"] = lora_strength
    # Force LoRA on (bypass the switch — always use LoRA model)
    if "197:185" in wf:
        wf["197:185"]["inputs"]["switch"] = True
        wf["197:185"]["inputs"]["on_true"] = ["197:189", 0]
    # Set CFG directly instead of using the switch
    if "197:194" in wf:
        wf["197:194"]["inputs"]["cfg"] = cfg
        wf["197:194"]["inputs"]["sampler_name"] = sampler_name
        wf["197:194"]["inputs"]["scheduler"] = scheduler
    return wf


# =============================================================================
# Image-to-Image Builders
# =============================================================================

def build_image2image_workflow(image_filename, prompt="", negative_prompt="",
                               width=1024, height=1024, steps=20,
                               cfg=3.5, shift=8.0, denoise=0.75, seed=None):
    """Wan 2.2 I2I (single frame from I2V model)."""
    seed = _seed(seed)
    return _inject(_load_template("wan_i2i"), {
        "image_filename": image_filename,
        "prompt": prompt or "high quality image, detailed",
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "steps": steps, "half_steps": steps // 2,
        "cfg": cfg, "shift": shift, "seed": seed,
        "i2v_low_noise_model": _i2v_low_noise_model(),
    })


def build_flux2_turbo_i2i_workflow(image_filename, prompt="", width=1024,
                                    height=1024, steps=20, seed=None):
    """Flux 2 Turbo I2I."""
    seed = _seed(seed)
    return _inject(_load_template("flux2_i2i"), {
        "image_filename": image_filename,
        "prompt": prompt,
        "steps": steps, "seed": seed,
    })


# =============================================================================
# Text-to-Video Builders
# =============================================================================

def build_text2video_workflow(prompt, negative_prompt="", width=832, height=480,
                              frames=81, steps=4, seed=None, lora_strength=1.0):
    """Wan 2.2 T2V with LightX2V 4-step LoRAs."""
    seed = _seed(seed)
    return _inject(_load_template("wan_t2v"), {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": width, "height": height,
        "frames": frames, "steps": steps, "half_steps": steps // 2,
        "seed": seed, "lora_strength": lora_strength,
    })


def build_ltx_2_t2v_workflow(prompt, negative_prompt="", width=1280, height=720,
                              frames=97, steps=20, seed=None, fps=24,
                              lora_strength=1.0, camera_lora=None,
                              audio_prompt=None, text_encoder=None):
    """LTX-2 19B T2V with distilled LoRA + spatial upscaler.
    
    Args:
        camera_lora: Optional camera motion LoRA name, e.g. 'dolly-left'.
                     Available: 'dolly-left'. Loaded at lora_strength.
        audio_prompt: Optional separate audio description. If provided,
                      appended to the main prompt for audio-video conditioning.
        text_encoder: Optional text encoder filename. Defaults to
                      gemma_3_12B_it_fp4_mixed.safetensors (from template).
    """
    seed = _seed(seed)
    # Build combined prompt: video description + optional audio guidance
    full_prompt = prompt
    if audio_prompt:
        full_prompt = f"{prompt}. Audio: {audio_prompt}"
    wf = _inject(_load_template("ltx2_t2v"), {
        "prompt": full_prompt,
        "negative_prompt": negative_prompt or LTX2_NEG_PROMPT,
        "width": width, "height": height,
        "frames": frames, "steps": steps, "seed": seed,
        "fps": fps, "fps_int": int(fps),
        "lora_strength": lora_strength,
    })

    # Override text encoder if specified
    if text_encoder and "92:60" in wf:
        wf["92:60"]["inputs"]["text_encoder"] = text_encoder

    # Optionally add a camera motion LoRA
    CAMERA_LORAS = {
        "dolly-left": "ltx-2-19b-lora-camera-control-dolly-left.safetensors",
    }
    if camera_lora and camera_lora in CAMERA_LORAS:
        wf["92:200"] = {
            "inputs": {
                "lora_name": CAMERA_LORAS[camera_lora],
                "strength_model": min(lora_strength, 0.8),
                "model": ["92:68", 0],
            },
            "class_type": "LoraLoaderModelOnly",
            "_meta": {"title": f"Camera LoRA ({camera_lora})"},
        }
        # Rewire stage 2 CFGGuider to use camera-LoRA'd model
        wf["92:82"]["inputs"]["model"] = ["92:200", 0]

    return wf


def build_ltx_2_i2v_workflow(image_filename, prompt="", negative_prompt="",
                              width=1280, height=720, frames=97, steps=20,
                              seed=None, fps=24, lora_strength=1.0,
                              image_strength=1.0, camera_lora=None,
                              audio_prompt=None, preset=None,
                              text_encoder=None):
    """LTX-2 19B I2V with distilled LoRA + spatial upscaler.
    
    Args:
        image_filename: Name of the uploaded image file in ComfyUI's input dir.
        image_strength: How strongly the reference image anchors the video (0.0–1.0).
                        1.0 = exact reproduction, 0.5 = more creative freedom.
        camera_lora: Optional camera motion LoRA name, e.g. 'dolly-left'.
        audio_prompt: Optional separate audio description.
        preset: Optional preset name or 'random' for random selection.
        text_encoder: Optional text encoder filename. Defaults to
                      gemma_3_12B_it_fp4_mixed.safetensors (from template).
    """
    seed = _seed(seed)
    full_prompt = prompt or "smooth natural motion, cinematic quality"
    # Note: audio_prompt is NOT appended to the video prompt —
    # LTX-2 AV conditions audio from the same text, so appending
    # "Audio: ..." causes it to generate speech of those words.
    wf = _inject(_load_template("ltx2_i2v"), {
        "image_filename": image_filename,
        "prompt": full_prompt,
        "negative_prompt": negative_prompt or LTX2_NEG_PROMPT,
        "width": width, "height": height,
        "frames": frames, "steps": steps, "seed": seed,
        "fps": fps, "fps_int": int(fps),
        "lora_strength": lora_strength,
        "image_strength": image_strength,
    })

    # Override text encoder if specified
    if text_encoder and "92:60" in wf:
        wf["92:60"]["inputs"]["text_encoder"] = text_encoder

    # ── Apply I2V preset (randomizes scheduler/CFG/sampler params) ──
    if preset:
        _apply_i2v_preset(wf, preset)

    # Optionally add a camera motion LoRA
    CAMERA_LORAS = {
        "dolly-left": "ltx-2-19b-lora-camera-control-dolly-left.safetensors",
    }
    if camera_lora and camera_lora in CAMERA_LORAS:
        wf["92:200"] = {
            "inputs": {
                "lora_name": CAMERA_LORAS[camera_lora],
                "strength_model": min(lora_strength, 0.8),
                "model": ["92:68", 0],
            },
            "class_type": "LoraLoaderModelOnly",
            "_meta": {"title": f"Camera LoRA ({camera_lora})"},
        }
        wf["92:82"]["inputs"]["model"] = ["92:200", 0]

    return wf


# ── I2V Preset System ────────────────────────────────────────────────────────

I2V_PRESETS = {
    "cinematic_breathe": {
        "desc": "Subtle breathing/living motion, very faithful to source",
        "cfg_1": 1.0, "cfg_2": 1.0,
        "max_shift": 2.05, "base_shift": 0.95, "terminal": 0.1,
        "sampler_1": "euler_ancestral", "sampler_2": "euler_ancestral",
        "image_strength": 1.0,
    },
    "gentle_wind": {
        "desc": "Soft environmental motion like gentle breeze",
        "cfg_1": 1.0, "cfg_2": 1.0,
        "max_shift": 1.8, "base_shift": 0.85, "terminal": 0.08,
        "sampler_1": "euler", "sampler_2": "euler",
        "image_strength": 1.0,
    },
    "dreamy_drift": {
        "desc": "Dreamlike subtle movement, very smooth",
        "cfg_1": 0.8, "cfg_2": 0.8,
        "max_shift": 2.2, "base_shift": 1.0, "terminal": 0.12,
        "sampler_1": "euler", "sampler_2": "euler",
        "image_strength": 1.0,
    },
    "natural_motion": {
        "desc": "Realistic natural movement, balanced",
        "cfg_1": 1.2, "cfg_2": 1.0,
        "max_shift": 2.0, "base_shift": 0.9, "terminal": 0.1,
        "sampler_1": "euler_ancestral", "sampler_2": "euler_ancestral",
        "image_strength": 0.95,
    },
    "vivid_action": {
        "desc": "More dynamic motion, slightly more creative",
        "cfg_1": 1.5, "cfg_2": 1.0,
        "max_shift": 2.1, "base_shift": 0.95, "terminal": 0.1,
        "sampler_1": "euler_ancestral", "sampler_2": "euler_ancestral",
        "image_strength": 0.9,
    },
    "soft_focus": {
        "desc": "Soft, cinematic feel with gentle transitions",
        "cfg_1": 0.9, "cfg_2": 0.9,
        "max_shift": 1.9, "base_shift": 0.88, "terminal": 0.09,
        "sampler_1": "euler", "sampler_2": "euler",
        "image_strength": 1.0,
    },
    "fluid_motion": {
        "desc": "Smooth, flowing movement like water or silk",
        "cfg_1": 1.0, "cfg_2": 1.0,
        "max_shift": 2.3, "base_shift": 1.05, "terminal": 0.15,
        "sampler_1": "euler", "sampler_2": "euler",
        "image_strength": 0.95,
    },
    "tight_hold": {
        "desc": "Maximum image fidelity, minimal but precise movement",
        "cfg_1": 0.8, "cfg_2": 0.8,
        "max_shift": 1.7, "base_shift": 0.8, "terminal": 0.06,
        "sampler_1": "euler", "sampler_2": "euler",
        "image_strength": 1.0,
    },
    "warm_glow": {
        "desc": "Warm, living quality with gentle light shifts",
        "cfg_1": 1.1, "cfg_2": 1.0,
        "max_shift": 2.0, "base_shift": 0.92, "terminal": 0.1,
        "sampler_1": "euler_ancestral", "sampler_2": "euler",
        "image_strength": 0.98,
    },
    "dynamic_subtle": {
        "desc": "Balanced between faithful and interesting motion",
        "cfg_1": 1.3, "cfg_2": 1.0,
        "max_shift": 2.15, "base_shift": 0.98, "terminal": 0.11,
        "sampler_1": "euler_ancestral", "sampler_2": "euler_ancestral",
        "image_strength": 0.92,
    },
}


def _apply_i2v_preset(wf, preset_name):
    """Apply an I2V parameter preset to a built workflow."""
    import random

    if preset_name == "random":
        preset_name = random.choice(list(I2V_PRESETS.keys()))

    preset = I2V_PRESETS.get(preset_name)
    if not preset:
        print(f"[I2V Preset] Unknown preset '{preset_name}', skipping")
        return

    print(f"[I2V Preset] Applying '{preset_name}': {preset['desc']}")

    # First-pass CFGGuider (92:47)
    if "92:47" in wf:
        wf["92:47"]["inputs"]["cfg"] = preset["cfg_1"]

    # Second-pass CFGGuider (92:82) 
    if "92:82" in wf:
        wf["92:82"]["inputs"]["cfg"] = preset["cfg_2"]

    # Scheduler (92:9)
    if "92:9" in wf:
        wf["92:9"]["inputs"]["max_shift"] = preset["max_shift"]
        wf["92:9"]["inputs"]["base_shift"] = preset["base_shift"]
        wf["92:9"]["inputs"]["terminal"] = preset["terminal"]

    # First-pass sampler (92:8)
    if "92:8" in wf:
        wf["92:8"]["inputs"]["sampler_name"] = preset["sampler_1"]

    # Second-pass sampler (92:66)
    if "92:66" in wf:
        wf["92:66"]["inputs"]["sampler_name"] = preset["sampler_2"]

    # Image strength override (92:121)
    if "92:121" in wf and "image_strength" in preset:
        wf["92:121"]["inputs"]["strength"] = preset["image_strength"]


# =============================================================================
# Image-to-Video Builders
# =============================================================================

def build_image2video_workflow(image_filename, prompt="", negative_prompt="",
                                width=768, height=768, frames=81, steps=20,
                                cfg=3.5, shift=8.0, seed=None, upscale=None):
    """Wan 2.2 I2V with optional RealESRGAN upscale."""
    seed = _seed(seed)
    gen_width = width
    gen_height = height
    if upscale and upscale > 1:
        gen_width = max(128, (width // upscale) // 16 * 16)
        gen_height = max(128, (height // upscale) // 16 * 16)

    wf = _inject(_load_template("wan_i2v"), {
        "image_filename": image_filename,
        "prompt": prompt or "smooth natural motion, cinematic quality",
        "negative_prompt": negative_prompt or DEFAULT_NEG_PROMPT,
        "width": gen_width, "height": gen_height,
        "frames": frames, "steps": steps, "half_steps": steps // 2,
        "cfg": cfg, "shift": shift, "seed": seed,
        "i2v_low_noise_model": _i2v_low_noise_model(),
    })

    # Optional upscale nodes (added dynamically)
    if upscale and upscale > 1:
        video_source = ["8", 0]
        wf["90"] = {
            "inputs": {"model_name": UPSCALE_MODEL},
            "class_type": "UpscaleModelLoader",
            "_meta": {"title": "Load Upscale Model"}
        }
        wf["91"] = {
            "inputs": {
                "upscale_model": ["90", 0],
                "image": ["8", 0],
            },
            "class_type": "ImageUpscaleWithModel",
            "_meta": {"title": "Upscale Frames (RealESRGAN 4x)"}
        }
        if upscale != 4:
            wf["92"] = {
                "inputs": {
                    "upscale_method": "lanczos",
                    "width": width, "height": height,
                    "crop": "disabled",
                    "image": ["91", 0],
                },
                "class_type": "ImageScale",
                "_meta": {"title": f"Resize to {width}x{height}"}
            }
            video_source = ["92", 0]
        else:
            video_source = ["91", 0]
        wf["11"]["inputs"]["images"] = video_source

    return wf


# =============================================================================
# Standalone Upscale
# =============================================================================

def build_upscale_workflow(image_filename, scale=2):
    """Standalone RealESRGAN upscale for images.
    
    Args:
        image_filename: Name of the uploaded image in ComfyUI's input dir.
        scale: Target upscale factor (2 or 4). RealESRGAN always does 4x
               internally, then we scale to the target.
    """
    _ensure_upscale_model()

    # We need to figure out the output size, but we don't know input size
    # at template time. For scale=4, we just pass through the RealESRGAN output.
    # For scale=2, we scale down 50% from the 4x.
    if scale == 4:
        # Skip the resize — use RealESRGAN output directly
        wf = _load_template("upscale")
        wf["2"]["inputs"]["image"] = image_filename
        # Rewire SaveImage to take from upscale directly (skip resize)
        wf["5"]["inputs"]["images"] = ["3", 0]
        # Remove the resize node
        del wf["4"]
    else:
        # scale=2: RealESRGAN 4x then resize to 2x (half of 4x)
        wf = _load_template("upscale")
        wf["2"]["inputs"]["image"] = image_filename
        # Use a ScaleBy node instead of fixed dimensions
        wf["4"] = {
            "inputs": {
                "upscale_method": "lanczos",
                "scale_by": 0.5,
                "image": ["3", 0],
            },
            "class_type": "ImageScaleBy",
            "_meta": {"title": "Scale to 2x"},
        }

    return wf


# =============================================================================
# Standalone Video Upscale
# =============================================================================

def build_video_upscale_workflow(video_filename, scale=2, fps=24):
    """Standalone RealESRGAN upscale for videos.

    Loads video → splits to frames → RealESRGAN 4x → optional resize → re-encode.
    
    Args:
        video_filename: Name of the uploaded video in ComfyUI's input dir.
        scale: Target upscale factor (2 or 4).
        fps: Output FPS.
    """
    _ensure_upscale_model()

    wf = {
        # Load video
        "1": {
            "inputs": {
                "video": video_filename,
                "force_rate": fps,
                "force_size": "Disabled",
                "frame_load_cap": 0,
                "skip_first_frames": 0,
                "select_every_nth": 1,
            },
            "class_type": "VHS_LoadVideo",
            "_meta": {"title": "Load Video"},
        },
        # Load upscale model
        "2": {
            "inputs": {"model_name": UPSCALE_MODEL},
            "class_type": "UpscaleModelLoader",
            "_meta": {"title": "Load RealESRGAN 4x"},
        },
        # Upscale frames
        "3": {
            "inputs": {
                "upscale_model": ["2", 0],
                "image": ["1", 0],
            },
            "class_type": "ImageUpscaleWithModel",
            "_meta": {"title": "Upscale Frames (RealESRGAN 4x)"},
        },
    }

    # Output source depends on scale
    output_source = ["3", 0]  # from upscale directly (4x)

    if scale != 4:
        # scale=2: RealESRGAN 4x then resize to 50%
        wf["4"] = {
            "inputs": {
                "upscale_method": "lanczos",
                "scale_by": 0.5,
                "image": ["3", 0],
            },
            "class_type": "ImageScaleBy",
            "_meta": {"title": "Scale to 2x"},
        }
        output_source = ["4", 0]

    # Re-encode video
    wf["5"] = {
        "inputs": {
            "frame_rate": fps,
            "loop_count": 0,
            "filename_prefix": "upscaled",
            "format": "video/h264-mp4",
            "save_output": True,
            "images": output_source,
            "audio": ["1", 2],  # pass through audio from source
        },
        "class_type": "VHS_VideoCombine",
        "_meta": {"title": "Save Upscaled Video"},
    }

    return wf
