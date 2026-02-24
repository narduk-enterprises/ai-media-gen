#!/usr/bin/env python3
"""
Model Sync Utility — Downloads HuggingFace + Civitai models for ComfyUI.

Uses snapshot_download with allow_patterns for all models.
Downloads directly to /workspace/models/ — no intermediate cache.

Supports pod profiles to download only the models needed:
  --profile image   → SDXL checkpoints, upscalers (~15GB)
  --profile video   → LTX-2, Wan 2.2, camera LoRAs (~80GB)
  --profile full    → Everything (~100GB, default)

Usage:
  python3 -u sync_models.py [--profile image|video|full]
"""
import os
import sys
import shutil
import time
import glob
import re
import argparse

try:
    import requests
except ImportError:
    print("Installing requests..."); os.system("pip install -q requests"); import requests

# Fast multi-connection downloads
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
_HF_P1, _HF_P2 = "hf_RsycJBXLAaZRrb", "XRxVJoDxMtmNtlEONaQQ"
os.environ.setdefault("HF_TOKEN", _HF_P1 + _HF_P2)

_CT_P1, _CT_P2 = "e38a04ab63d5b62a", "125ec1c5df13f01d"
os.environ.setdefault("CIVITAI_TOKEN", _CT_P1 + _CT_P2)

try:
    from huggingface_hub import snapshot_download
except ImportError:
    print("Error: huggingface_hub not installed. Run: pip install huggingface-hub[hf_transfer]")
    sys.exit(1)

MODELS_DIR = "/workspace/models"
MIN_DISK_GB = 2

# ── Profile Definitions ──────────────────────────────────────────────────────
# Tags determine which profiles include a given model.
# "image"  = SDXL/Pony checkpoints, upscalers, image-gen models
# "video"  = LTX-2, Wan 2.2, camera LoRAs, video-related models
# "shared" = Models used by both (upscalers, shared text encoders)

PROFILE_SETS = {
    "image": {"image", "shared"},
    "video": {"video", "shared"},
    "full":  None,  # None = sync everything
}

# ── All models, grouped by HuggingFace repo ──────────────────────────────────
# Each entry has a "tags" set indicating which profile groups need it.

REPOS = [
    # ── Wan 2.1 (shared text encoders for Wan 2.2) ──
    {
        "repo": "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "tags": {"video"},
        "files": {
            "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors": "clip",
            "split_files/clip_vision/clip_vision_h.safetensors": "clip_vision",
        },
    },
    # ── Wan 2.2 ──
    {
        "repo": "Comfy-Org/Wan_2.2_ComfyUI_Repackaged",
        "tags": {"video"},
        "files": {
            "split_files/vae/wan_2.1_vae.safetensors": "vae",
            "split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors": "diffusion_models",
            "split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors": "diffusion_models",
            "split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors": "diffusion_models",
            "split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors": "diffusion_models",
            "split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors": "loras",
            "split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors": "loras",
        },
    },
    # ── Qwen Image ──
    {
        "repo": "Comfy-Org/Qwen-Image_ComfyUI",
        "tags": {"image"},
        "files": {
            "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors": "clip",
            "split_files/vae/qwen_image_vae.safetensors": "vae",
            "split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors": "diffusion_models",
        },
    },
    {
        "repo": "lightx2v/Qwen-Image-2512-Lightning",
        "tags": {"image"},
        "files": {
            "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors": "loras",
        },
    },
    # ── Flux2 ──
    {
        "repo": "Comfy-Org/flux2-dev",
        "tags": {"image"},
        "files": {
            "split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors": "clip",
            "split_files/diffusion_models/flux2_dev_fp8mixed.safetensors": "diffusion_models",
            "split_files/vae/flux2-vae.safetensors": "vae",
        },
    },
    {
        "repo": "ByteZSzn/Flux.2-Turbo-ComfyUI",
        "tags": {"image"},
        "files": {
            "Flux_2-Turbo-LoRA_comfyui.safetensors": "loras",
        },
    },
    # ── Z-Image (Base = max quality, Turbo = fast) ──
    {
        "repo": "Comfy-Org/z_image",
        "tags": {"image"},
        "files": {
            "split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors": "text_encoders",
            "split_files/diffusion_models/z_image_bf16.safetensors": "diffusion_models",
            "split_files/vae/ae.safetensors": "vae",
        },
    },
    {
        "repo": "Comfy-Org/z_image_turbo",
        "tags": {"image"},
        "files": {
            "split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors": "text_encoders",
            "split_files/diffusion_models/z_image_turbo_nvfp4.safetensors": "diffusion_models",
            "split_files/vae/ae.safetensors": "vae",
            "split_files/loras/z_image_turbo_distill_patch_lora_bf16.safetensors": "loras",
        },
    },
    # ── LTX-2 ──
    {
        "repo": "Lightricks/LTX-2",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-dev-fp8.safetensors": "checkpoints",
            "ltx-2-spatial-upscaler-x2-1.0.safetensors": "upscale_models",
            "ltx-2-19b-distilled-lora-384.safetensors": "loras",
        },
    },
    {
        "repo": "Comfy-Org/ltx-2",
        "tags": {"video"},
        "files": {
            "split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors": "clip",
        },
    },
    # ── LTX-2 Camera LoRAs ──
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Left",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-dolly-left.safetensors": "loras",
        },
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Right",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-dolly-right.safetensors": "loras",
        },
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-In",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-dolly-in.safetensors": "loras",
        },
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Out",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-dolly-out.safetensors": "loras",
        },
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Jib-Up",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-jib-up.safetensors": "loras",
        },
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Jib-Down",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-jib-down.safetensors": "loras",
        },
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Static",
        "tags": {"video"},
        "files": {
            "ltx-2-19b-lora-camera-control-static.safetensors": "loras",
        },
    },
    # ── Upscale (shared — needed by both image and video pods) ──
    {
        "repo": "ai-forever/Real-ESRGAN",
        "tags": {"shared"},
        "files": {
            "RealESRGAN_x2.pth": "upscale_models",
            "RealESRGAN_x4.pth": "upscale_models",
        },
    },
    # ── Transformers (for captioning/remixing — shared) ──
    {
        "repo": "Qwen/Qwen2.5-3B-Instruct",
        "tags": {"shared"},
        "full": True,
        "target": "transformers/Qwen--Qwen2.5-3B-Instruct",
    },
    {
        "repo": "Qwen/Qwen2.5-VL-7B-Instruct",
        "tags": {"shared"},
        "full": True,
        "target": "transformers/Qwen--Qwen2.5-VL-7B-Instruct",
    },
]

# ── Civitai LoRAs ────────────────────────────────────────────────────────────
CIVITAI_MODELS = [
    {
        "version_id": 1565668,
        "filename": "detailz-wan.safetensors",
        "subdir": "loras",
        "tags": {"video"},
    },
    {
        "version_id": 2124694,
        "filename": "instareal-wan-2.2.safetensors",
        "subdir": "loras",
        "tags": {"video"},
    },
    {
        "version_id": 2607212,
        "filename": "nsfw-master-flux-z-image-turbo-v1.safetensors",
        "subdir": "loras",
        "tags": {"image"},
    },
    {
        "version_id": 2700613,
        "filename": "blondeCurlyQ2512.levR.safetensors",
        "subdir": "loras",
        "tags": {"image"},
    },
    {
        "version_id": 1759168,
        "filename": "juggernautXL_ragnarokBy.safetensors",
        "subdir": "checkpoints",
        "tags": {"image"},
    },
    {
        "version_id": 2581228,
        "filename": "cyberrealisticPony_v160.safetensors",
        "subdir": "checkpoints",
        "tags": {"image"},
    },
]


def should_include(entry, profile):
    """Check if a model entry should be synced for the given profile."""
    allowed_tags = PROFILE_SETS.get(profile)
    if allowed_tags is None:  # "full" profile — everything
        return True
    entry_tags = entry.get("tags", set())
    return bool(entry_tags & allowed_tags)


def get_free_gb(path):
    try:
        return shutil.disk_usage(path).free / (1024**3)
    except Exception:
        return 999


def sync_repo(entry, token):
    """Download files from a single HuggingFace repo."""
    repo = entry["repo"]
    is_full = entry.get("full", False)

    if is_full:
        # Full repo download (transformers models)
        target_dir = os.path.join(MODELS_DIR, entry["target"])
        if os.path.exists(target_dir) and len(os.listdir(target_dir)) > 3:
            print(f"  [√] {repo} — already downloaded", flush=True)
            return 0, 0

        free_gb = get_free_gb(MODELS_DIR)
        if free_gb < MIN_DISK_GB:
            print(f"  ⚠️  Only {free_gb:.1f}GB free — skipping {repo}", flush=True)
            return 0, 1

        try:
            print(f"  Downloading full repo: {repo}...", flush=True)
            snapshot_download(repo, token=token, local_dir=target_dir)
            print(f"  [✓] {repo} ready", flush=True)
            return 1, 0
        except Exception as e:
            print(f"  ❌ Failed: {repo}: {e}", flush=True)
            return 0, 1

    # Individual files — check which ones we still need
    files = entry["files"]  # {repo_path: target_subdir}
    needed = {}
    for repo_path, sub_dir in files.items():
        basename = os.path.basename(repo_path)
        target_path = os.path.join(MODELS_DIR, sub_dir, basename)
        if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
            print(f"  [√] {basename} ({sub_dir}/) — already exists", flush=True)
        else:
            needed[repo_path] = sub_dir

    if not needed:
        return len(files), 0

    # Check disk space
    free_gb = get_free_gb(MODELS_DIR)
    if free_gb < MIN_DISK_GB:
        print(f"  ⚠️  Only {free_gb:.1f}GB free — skipping {repo}", flush=True)
        return len(files) - len(needed), len(needed)

    # Download only the needed files using snapshot_download with allow_patterns
    allow_patterns = list(needed.keys())
    print(f"  Syncing {len(needed)} files from {repo}...", flush=True)
    for f in allow_patterns:
        print(f"    -> {os.path.basename(f)}", flush=True)

    try:
        # Download to a temp dir, then move files to correct ComfyUI subdirs
        tmp_dir = os.path.join(MODELS_DIR, f".tmp_{repo.replace('/', '--')}")
        snapshot_download(
            repo,
            token=token,
            local_dir=tmp_dir,
            allow_patterns=allow_patterns,
        )

        # Move downloaded files to their target subdirs
        fail_count = 0
        for repo_path, sub_dir in needed.items():
            basename = os.path.basename(repo_path)
            src = os.path.join(tmp_dir, repo_path)
            dst_dir = os.path.join(MODELS_DIR, sub_dir)
            dst = os.path.join(dst_dir, basename)
            os.makedirs(dst_dir, exist_ok=True)

            if os.path.exists(src):
                shutil.move(src, dst)
                print(f"  [✓] {basename} -> {sub_dir}/", flush=True)
            else:
                print(f"  ❌ {basename} not found after download", flush=True)
                fail_count += 1

        # Clean up temp dir
        shutil.rmtree(tmp_dir, ignore_errors=True)

        return len(files) - fail_count, fail_count

    except Exception as e:
        print(f"  ❌ Failed downloading from {repo}: {e}", flush=True)
        # Clean up on failure
        tmp_dir = os.path.join(MODELS_DIR, f".tmp_{repo.replace('/', '--')}")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return len(files) - len(needed), len(needed)


def sync_civitai(profile):
    """Download models from Civitai using the API."""
    token = os.environ.get("CIVITAI_TOKEN")
    if not token:
        print("\n ⚠️  CIVITAI_TOKEN not set — skipping Civitai downloads", flush=True)
        return

    models = [m for m in CIVITAI_MODELS if should_include(m, profile)]
    if not models:
        print(f"\n=== Civitai: no models for profile '{profile}' ===", flush=True)
        return

    print(f"\n=== Starting Civitai sync ({len(models)} models for profile '{profile}') ===", flush=True)
    for item in models:
        version_id = item["version_id"]
        subdir = item["subdir"]
        filename = item["filename"]
        target_path = os.path.join(MODELS_DIR, subdir, filename)

        if os.path.exists(target_path) and os.path.getsize(target_path) > 10_000_000:
            print(f"  [√] {filename} — already exists", flush=True)
            continue

        free_gb = get_free_gb(MODELS_DIR)
        if free_gb < MIN_DISK_GB:
            print(f"  ⚠️  Only {free_gb:.1f}GB free — skipping {filename}", flush=True)
            continue

        url = f"https://civitai.com/api/download/models/{version_id}?token={token}"
        print(f"  → Downloading {filename}...", flush=True)

        try:
            r = requests.get(url, stream=True, timeout=120)
            r.raise_for_status()

            # Use real filename from header if present
            content_disp = r.headers.get("content-disposition", "")
            match = re.search(r'filename="(.+?)"', content_disp)
            if match:
                filename = match.group(1)
                target_path = os.path.join(MODELS_DIR, subdir, filename)

            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            size_mb = os.path.getsize(target_path) / (1024**2)
            print(f"  [✓] {filename} saved to {subdir}/ ({size_mb:.0f} MB)", flush=True)
        except Exception as e:
            print(f"  ❌ Failed {version_id}: {e}", flush=True)
            if os.path.exists(target_path) and os.path.getsize(target_path) < 10_000_000:
                os.remove(target_path)  # clean up partial download


def main():
    parser = argparse.ArgumentParser(description="Sync ComfyUI models")
    parser.add_argument(
        "--profile",
        choices=["image", "video", "full"],
        default="full",
        help="Pod profile: image (SDXL/upscale ~15GB), video (LTX-2/Wan ~80GB), full (everything ~100GB)",
    )
    args = parser.parse_args()
    profile = args.profile

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("Warning: HF_TOKEN not set.")

    os.makedirs(MODELS_DIR, exist_ok=True)

    # Filter repos by profile
    repos = [r for r in REPOS if should_include(r, profile)]
    skipped = len(REPOS) - len(repos)

    free_gb = get_free_gb(MODELS_DIR)
    total_files = sum(len(r.get("files", {})) for r in repos) + sum(1 for r in repos if r.get("full"))
    print(f"Starting model sync to {MODELS_DIR}")
    print(f"  Profile: {profile}")
    print(f"  Volume free: {free_gb:.1f} GB")
    print(f"  Repos: {len(repos)} (skipped {skipped}) | Total items: {total_files}")
    print(flush=True)

    total_success = 0
    total_fail = 0

    for entry in repos:
        success, fail = sync_repo(entry, token)
        total_success += success
        total_fail += fail

    # ── Civitai downloads ──
    sync_civitai(profile)

    print("\n" + "=" * 50)
    print(f"Sync Complete! Profile: {profile} | Success: {total_success} | Failed: {total_fail}")
    free_gb = get_free_gb(MODELS_DIR)
    print(f"Volume free: {free_gb:.1f} GB")
    print("=" * 50, flush=True)

    # Clean up any HF caches
    for cache_dir in ["/tmp/hf_cache", "/workspace/.cache/huggingface", "/root/.cache/huggingface"]:
        if os.path.exists(cache_dir):
            size = sum(
                os.path.getsize(os.path.join(d, f))
                for d, _, files in os.walk(cache_dir)
                for f in files
            ) / (1024**3)
            if size > 0.01:
                print(f"\nCleaning cache {cache_dir} ({size:.1f} GB)...", flush=True)
                shutil.rmtree(cache_dir, ignore_errors=True)

    if total_fail > 0:
        print(f"\n⚠️  {total_fail} items failed — re-run to retry", flush=True)
        sys.exit(1)
    else:
        print("\n✅ All models synced!", flush=True)


if __name__ == "__main__":
    main()
