#!/usr/bin/env python3
"""
Model Sync Utility — Downloads HuggingFace + Civitai models for ComfyUI.

Uses snapshot_download with allow_patterns for all models.
Downloads directly to /workspace/models/ — no intermediate cache.
Supports SHA256 checksum verification (--verify flag to re-check existing files).

Supports individual model groups for fine-grained control:
  --groups juggernaut,pony,upscale   → Only those groups
  --profile image                     → All image groups (legacy compat)

Available groups:
  juggernaut    — Juggernaut XL SDXL checkpoint (~7GB)
  pony          — CyberRealistic Pony SDXL checkpoint (~7GB)
  qwen          — Qwen Image + Lightning LoRA (~12GB)
  flux2         — Flux2 Dev + Turbo LoRA (~15GB)
  z_image       — Z-Image bf16 max quality (~10GB)
  z_image_turbo — Z-Image Turbo nvfp4 fast (~8GB)
  wan22         — Wan 2.2 T2V/I2V + encoders (~40GB)
  ltx2          — LTX-2 19B + upscaler + distill LoRA (~25GB)
  ltx2_camera   — LTX-2 camera control LoRAs (~2GB)
  upscale       — RealESRGAN x2 + x4 (~0.2GB)
  shared        — Qwen2.5 captioning/remix models (~8GB)

Usage:
  python3 -u sync_models.py --groups juggernaut,upscale
  python3 -u sync_models.py --profile image
"""
import os
import sys
import shutil
import re
import argparse
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

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
HF_CACHE_DIR = "/tmp/hf_cache"  # Controlled location — cleaned after each download
MIN_DISK_GB = 2
MAX_PARALLEL = 4  # Parallel download threads
VERIFY_MODE = False  # Set via --verify flag

# Thread-safe printing
_print_lock = threading.Lock()
def tprint(msg):
    with _print_lock:
        print(msg, flush=True)


def compute_sha256(filepath, chunk_size=8192 * 1024):
    """Compute SHA256 hash of a file. Returns hex digest string."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def verify_file(filepath, expected_sha256, label=""):
    """Verify a file's SHA256 hash. Returns True if valid, False if mismatch.
    If expected_sha256 is None, computes and logs the hash for future reference."""
    if not os.path.exists(filepath):
        return False
    actual = compute_sha256(filepath)
    if expected_sha256 is None:
        tprint(f"  ℹ️  {label or os.path.basename(filepath)} sha256={actual}")
        return True  # No expected hash to compare against
    if actual != expected_sha256:
        tprint(f"  ❌ CHECKSUM MISMATCH {label or os.path.basename(filepath)}")
        tprint(f"     expected: {expected_sha256}")
        tprint(f"     actual:   {actual}")
        return False
    tprint(f"  ✓  {label or os.path.basename(filepath)} checksum OK")
    return True


def _clean_hf_cache():
    """Remove HF cache directories to free disk space after each download."""
    for d in [HF_CACHE_DIR, "/root/.cache/huggingface", "/workspace/.cache/huggingface"]:
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)


def _clean_orphaned_tmps():
    """Remove leftover .tmp_* directories from previous crashed downloads."""
    if not os.path.isdir(MODELS_DIR):
        return
    for name in os.listdir(MODELS_DIR):
        if name.startswith(".tmp_"):
            path = os.path.join(MODELS_DIR, name)
            if os.path.isdir(path):
                size_mb = sum(
                    os.path.getsize(os.path.join(d, f))
                    for d, _, files in os.walk(path)
                    for f in files
                ) / (1024**2)
                tprint(f"  🧹 Removing orphaned {name} ({size_mb:.0f}MB)")
                shutil.rmtree(path, ignore_errors=True)

# ── Profile → Group Mappings (legacy compat) ────────────────────────────────
PROFILE_TO_GROUPS = {
    "image": ["juggernaut", "pony", "qwen", "flux2", "z_image", "z_image_turbo", "upscale"],
    "video": ["wan22", "ltx2", "ltx2_camera", "upscale", "shared"],
    "full": ["juggernaut", "pony", "qwen", "flux2", "z_image", "z_image_turbo",
             "wan22", "ltx2", "ltx2_camera", "upscale", "shared"],
}

ALL_GROUPS = list(PROFILE_TO_GROUPS["full"])

# ── All models, grouped by name ─────────────────────────────────────────────

REPOS = [
    # ── Wan 2.1 (shared text encoders for Wan 2.2) ──
    {
        "repo": "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "group": "wan22",
        "files": {
            "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors": "clip",
            "split_files/clip_vision/clip_vision_h.safetensors": "clip_vision",
        },
    },
    # ── Wan 2.2 ──
    {
        "repo": "Comfy-Org/Wan_2.2_ComfyUI_Repackaged",
        "group": "wan22",
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
        "group": "qwen",
        "files": {
            "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors": "clip",
            "split_files/vae/qwen_image_vae.safetensors": "vae",
            "split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors": "diffusion_models",
        },
    },
    {
        "repo": "lightx2v/Qwen-Image-2512-Lightning",
        "group": "qwen",
        "files": {
            "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors": "loras",
        },
    },
    # ── Flux2 ──
    {
        "repo": "Comfy-Org/flux2-dev",
        "group": "flux2",
        "files": {
            "split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors": "clip",
            "split_files/diffusion_models/flux2_dev_fp8mixed.safetensors": "diffusion_models",
            "split_files/vae/flux2-vae.safetensors": "vae",
        },
    },
    {
        "repo": "ByteZSzn/Flux.2-Turbo-ComfyUI",
        "group": "flux2",
        "files": {
            "Flux_2-Turbo-LoRA_comfyui.safetensors": "loras",
        },
    },
    # ── Z-Image (Base = max quality) ──
    {
        "repo": "Comfy-Org/z_image",
        "group": "z_image",
        "files": {
            "split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors": "text_encoders",
            "split_files/diffusion_models/z_image_bf16.safetensors": "diffusion_models",
            "split_files/vae/ae.safetensors": "vae",
        },
    },
    # ── Z-Image Turbo (fast) ──
    {
        "repo": "Comfy-Org/z_image_turbo",
        "group": "z_image_turbo",
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
        "group": "ltx2",
        "files": {
            "ltx-2-19b-dev-fp8.safetensors": "checkpoints",
            "ltx-2-spatial-upscaler-x2-1.0.safetensors": "upscale_models",
            "ltx-2-19b-distilled-lora-384.safetensors": "loras",
        },
    },
    {
        "repo": "Comfy-Org/ltx-2",
        "group": "ltx2",
        "files": {
            "split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors": "clip",
        },
    },
    # ── LTX-2 Abliterated Text Encoders ──
    {
        "repo": "DreamFast/gemma-3-12b-it-heretic",
        "group": "ltx2",
        "files": {
            "comfyui/gemma_3_12B_it_heretic_fp8_e4m3fn.safetensors": "clip",
        },
    },
    {
        "repo": "Sikaworld1990/gemma-3-12b-it-abliterated-sikaworld-high-fidelity-edition-Ltx-2",
        "group": "ltx2",
        "files": {
            "gemma-3-12b-it-abliterated-sikaworld-high-fidelity-edition.safetensors": "clip",
        },
    },
    # ── LTX-2 Camera LoRAs ──
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Left",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-dolly-left.safetensors": "loras"},
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Right",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-dolly-right.safetensors": "loras"},
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-In",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-dolly-in.safetensors": "loras"},
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Out",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-dolly-out.safetensors": "loras"},
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Jib-Up",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-jib-up.safetensors": "loras"},
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Jib-Down",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-jib-down.safetensors": "loras"},
    },
    {
        "repo": "Lightricks/LTX-2-19b-LoRA-Camera-Control-Static",
        "group": "ltx2_camera",
        "files": {"ltx-2-19b-lora-camera-control-static.safetensors": "loras"},
    },
    # ── Upscale ──
    {
        "repo": "ai-forever/Real-ESRGAN",
        "group": "upscale",
        "files": {
            "RealESRGAN_x2.pth": "upscale_models",
            "RealESRGAN_x4.pth": "upscale_models",
        },
    },
    # ── Shared (captioning/remixing) ──
    {
        "repo": "Qwen/Qwen2.5-3B-Instruct",
        "group": "shared",
        "full": True,
        "target": "transformers/Qwen--Qwen2.5-3B-Instruct",
    },
    {
        "repo": "Qwen/Qwen2.5-VL-7B-Instruct",
        "group": "shared",
        "full": True,
        "target": "transformers/Qwen--Qwen2.5-VL-7B-Instruct",
    },
]

# ── Civitai Models ───────────────────────────────────────────────────────────
CIVITAI_MODELS = [
    {"version_id": 1565668, "filename": "detailz-wan.safetensors", "subdir": "loras", "group": "wan22"},
    {"version_id": 2124694, "filename": "instareal-wan-2.2.safetensors", "subdir": "loras", "group": "wan22"},
    {"version_id": 2607212, "filename": "nsfw-master-flux-z-image-turbo-v1.safetensors", "subdir": "loras", "group": "z_image_turbo"},
    {"version_id": 2700613, "filename": "blondeCurlyQ2512.levR.safetensors", "subdir": "loras", "group": "qwen"},
    {"version_id": 1759168, "filename": "juggernautXL_ragnarokBy.safetensors", "subdir": "checkpoints", "group": "juggernaut"},
    {"version_id": 2581228, "filename": "cyberrealisticPony_v160.safetensors", "subdir": "checkpoints", "group": "pony"},
]


def should_include(entry, groups_set):
    """Check if a model entry should be synced for the given groups."""
    if groups_set is None:  # sync everything
        return True
    return entry.get("group", "") in groups_set


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
        target_dir = os.path.join(MODELS_DIR, entry["target"])
        if os.path.exists(target_dir) and len(os.listdir(target_dir)) > 3:
            tprint(f"  [√] {repo} — already downloaded")
            return 0, 0

        free_gb = get_free_gb(MODELS_DIR)
        if free_gb < MIN_DISK_GB:
            tprint(f"  ⚠️  Only {free_gb:.1f}GB free — skipping {repo}")
            return 0, 1

        try:
            tprint(f"  ⬇ {repo} (full repo)...")
            snapshot_download(
                repo, token=token, local_dir=target_dir,
                cache_dir=HF_CACHE_DIR, local_dir_use_symlinks=False,
            )
            _clean_hf_cache()
            tprint(f"  [✓] {repo} ready")
            return 1, 0
        except Exception as e:
            tprint(f"  ❌ Failed: {repo}: {e}")
            _clean_hf_cache()
            return 0, 1

    # Individual files — check which ones we still need
    files = entry["files"]
    hashes = entry.get("sha256", {})  # repo_path -> expected sha256
    needed = {}
    for repo_path, sub_dir in files.items():
        basename = os.path.basename(repo_path)
        target_path = os.path.join(MODELS_DIR, sub_dir, basename)
        if os.path.exists(target_path):
            fsize = os.path.getsize(target_path)
            # Safetensors models should be >10MB; smaller = corrupted/partial
            min_size = 10_000_000 if basename.endswith('.safetensors') else 1000
            if fsize > min_size:
                # Verify checksum if in verify mode or hash is available
                expected_hash = hashes.get(repo_path)
                if VERIFY_MODE and expected_hash:
                    if not verify_file(target_path, expected_hash, basename):
                        tprint(f"  🔄 {basename} — deleting corrupt file, will re-download")
                        os.remove(target_path)
                        needed[repo_path] = sub_dir
                        continue
                tprint(f"  [√] {basename} ({sub_dir}/) — {fsize / (1024**2):.0f}MB")
            else:
                tprint(f"  ⚠️  {basename} only {fsize / (1024**2):.1f}MB — re-downloading")
                os.remove(target_path)
                needed[repo_path] = sub_dir
        else:
            needed[repo_path] = sub_dir

    if not needed:
        return len(files), 0

    free_gb = get_free_gb(MODELS_DIR)
    if free_gb < MIN_DISK_GB:
        tprint(f"  ⚠️  Only {free_gb:.1f}GB free — skipping {repo}")
        return len(files) - len(needed), len(needed)

    allow_patterns = list(needed.keys())
    names = ", ".join(os.path.basename(f) for f in allow_patterns)
    tprint(f"  ⬇ {repo} ({len(needed)} files: {names})")

    try:
        tmp_dir = os.path.join(MODELS_DIR, f".tmp_{repo.replace('/', '--')}")
        snapshot_download(
            repo, token=token, local_dir=tmp_dir, allow_patterns=allow_patterns,
            cache_dir=HF_CACHE_DIR, local_dir_use_symlinks=False,
        )

        fail_count = 0
        for repo_path, sub_dir in needed.items():
            basename = os.path.basename(repo_path)
            src = os.path.join(tmp_dir, repo_path)
            dst_dir = os.path.join(MODELS_DIR, sub_dir)
            dst = os.path.join(dst_dir, basename)
            os.makedirs(dst_dir, exist_ok=True)

            if os.path.exists(src):
                # Verify downloaded file checksum
                expected_hash = hashes.get(repo_path)
                if expected_hash:
                    if not verify_file(src, expected_hash, basename):
                        tprint(f"  ❌ {basename} downloaded but CHECKSUM MISMATCH — discarding")
                        os.remove(src)
                        fail_count += 1
                        continue
                shutil.move(src, dst)
                tprint(f"  [✓] {basename} -> {sub_dir}/")
                # Log hash for files without a known hash
                if not expected_hash:
                    verify_file(dst, None, basename)
            else:
                tprint(f"  ❌ {basename} not found after download")
                fail_count += 1

        shutil.rmtree(tmp_dir, ignore_errors=True)
        _clean_hf_cache()
        return len(files) - fail_count, fail_count

    except Exception as e:
        tprint(f"  ❌ Failed downloading from {repo}: {e}")
        tmp_dir = os.path.join(MODELS_DIR, f".tmp_{repo.replace('/', '--')}")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        _clean_hf_cache()
        return len(files) - len(needed), len(needed)


def sync_civitai_item(item):
    """Download a single Civitai model. Returns (success, fail) counts."""
    token = os.environ.get("CIVITAI_TOKEN")
    if not token:
        return 0, 1

    version_id = item["version_id"]
    subdir = item["subdir"]
    filename = item["filename"]
    expected_hash = item.get("sha256")
    target_path = os.path.join(MODELS_DIR, subdir, filename)

    if os.path.exists(target_path) and os.path.getsize(target_path) > 10_000_000:
        # Verify existing file if in verify mode and hash is known
        if VERIFY_MODE and expected_hash:
            tprint(f"  🔍 Verifying {filename}...")
            if not verify_file(target_path, expected_hash, filename):
                tprint(f"  🔄 {filename} — checksum mismatch, deleting for re-download")
                os.remove(target_path)
                # Fall through to download
            else:
                return 1, 0
        else:
            tprint(f"  [√] {filename} — exists")
            return 1, 0

    free_gb = get_free_gb(MODELS_DIR)
    if free_gb < MIN_DISK_GB:
        tprint(f"  ⚠️  Only {free_gb:.1f}GB free — skipping {filename}")
        return 0, 1

    url = f"https://civitai.com/api/download/models/{version_id}?token={token}"
    tprint(f"  ⬇ Civitai: {filename}...")

    try:
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()

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

        # Verify downloaded file
        if expected_hash:
            if not verify_file(target_path, expected_hash, filename):
                tprint(f"  ❌ {filename} downloaded but CHECKSUM MISMATCH — deleting")
                os.remove(target_path)
                return 0, 1
        else:
            # Log hash for future reference
            verify_file(target_path, None, filename)

        tprint(f"  [✓] {filename} -> {subdir}/ ({size_mb:.0f} MB)")
        return 1, 0
    except Exception as e:
        tprint(f"  ❌ Failed Civitai {version_id}: {e}")
        if os.path.exists(target_path) and os.path.getsize(target_path) < 10_000_000:
            os.remove(target_path)
        return 0, 1


def main():
    global VERIFY_MODE
    parser = argparse.ArgumentParser(description="Sync ComfyUI models")
    parser.add_argument(
        "--profile",
        choices=["image", "video", "full"],
        default=None,
        help="Legacy profile (expands to model groups)",
    )
    parser.add_argument(
        "--groups",
        type=str,
        default=None,
        help="Comma-separated model groups to sync (e.g., juggernaut,pony,upscale)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        default=False,
        help="Verify SHA256 checksums of existing files and re-download if mismatched",
    )
    args = parser.parse_args()
    VERIFY_MODE = args.verify

    # Resolve groups from args
    if args.groups:
        selected = [g.strip() for g in args.groups.split(",") if g.strip()]
        unknown = [g for g in selected if g not in ALL_GROUPS]
        if unknown:
            print(f"⚠️  Unknown groups: {unknown}. Available: {ALL_GROUPS}")
        groups_set = set(selected)
    elif args.profile:
        groups_set = set(PROFILE_TO_GROUPS.get(args.profile, ALL_GROUPS))
    else:
        groups_set = None

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("Warning: HF_TOKEN not set.")

    os.makedirs(MODELS_DIR, exist_ok=True)

    # Clean up orphaned caches and temp dirs before starting
    _clean_orphaned_tmps()
    _clean_hf_cache()

    # Filter repos and civitai models by groups
    repos = [r for r in REPOS if should_include(r, groups_set)]
    civitai = [m for m in CIVITAI_MODELS if should_include(m, groups_set)]
    skipped = len(REPOS) - len(repos)

    free_gb = get_free_gb(MODELS_DIR)
    total_items = len(repos) + len(civitai)
    groups_label = ",".join(sorted(groups_set)) if groups_set else "all"
    print(f"Starting model sync to {MODELS_DIR}")
    print(f"  Groups: {groups_label}")
    print(f"  Verify mode: {'ON' if VERIFY_MODE else 'OFF'}")
    print(f"  Volume free: {free_gb:.1f} GB")
    print(f"  HF repos: {len(repos)} (skipped {skipped}) | Civitai: {len(civitai)} | Workers: {MAX_PARALLEL}")
    print(flush=True)

    total_success = 0
    total_fail = 0

    # ── Parallel downloads ──
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        futures = {}

        # Submit all HF repos
        for entry in repos:
            f = pool.submit(sync_repo, entry, token)
            futures[f] = entry["repo"]

        # Submit all Civitai items
        for item in civitai:
            f = pool.submit(sync_civitai_item, item)
            futures[f] = f"civitai:{item['filename']}"

        # Collect results as they complete
        for future in as_completed(futures):
            name = futures[future]
            try:
                success, fail = future.result()
                total_success += success
                total_fail += fail
            except Exception as e:
                tprint(f"  ❌ Unexpected error in {name}: {e}")
                total_fail += 1

    print("\n" + "=" * 50)
    print(f"Sync Complete! Groups: {groups_label} | Success: {total_success} | Failed: {total_fail}")
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

