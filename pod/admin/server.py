#!/usr/bin/env python3
"""
GPU Pod Admin Server — Lightweight management API for ComfyUI pods.
Serves on :8188. No external dependencies (stdlib only).

Endpoints:
  GET  /              → Admin dashboard (index.html)
  GET  /health        → ComfyUI status, GPU VRAM, disk space
  GET  /models        → List installed models by category
  GET  /logs          → Recent log lines (query: source=comfy|admin, lines=50)
  POST /restart       → Restart ComfyUI
  POST /sync-models   → Start model sync (async)
  GET  /sync-status   → Status of running sync job
"""
import json, os, subprocess, sys, threading, time, shutil, pathlib, signal, hashlib, hmac
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# Suppress SIGPIPE
try:
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)
except AttributeError:
    pass

COMFY_PORT = int(os.environ.get("COMFY_PORT", 8189))
ADMIN_PORT = int(os.environ.get("ADMIN_PORT", 8188))
COMFY_DIR = os.environ.get("COMFY_DIR", "/comfyui")
MODELS_DIR = os.environ.get("MODELS_DIR", "/workspace/models")
SYNC_SCRIPT = os.environ.get("SYNC_SCRIPT", "/workspace/sync_models.py")
MANAGE_SCRIPT = os.environ.get("MANAGE_SCRIPT", "/workspace/manage.sh")
COMFY_LOG = "/workspace/comfyui.log"
ADMIN_LOG = "/workspace/admin.log"

# ── Sync state ───────────────────────────────────────────────────────────────
_sync_lock = threading.Lock()
_sync_state = {"running": False, "log": "", "started_at": None, "finished_at": None, "exit_code": None}


def _run_sync(groups=None, verify=False):
    global _sync_state
    with _sync_lock:
        _sync_state = {"running": True, "log": "", "started_at": time.time(), "finished_at": None, "exit_code": None}
    try:
        cmd = ["python3", "-u", SYNC_SCRIPT]
        if groups:
            cmd += ["--groups", ",".join(groups)]
        if verify:
            cmd += ["--verify"]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        output_lines = []
        for line in proc.stdout:
            output_lines.append(line)
            # Keep last 200 lines
            if len(output_lines) > 200:
                output_lines = output_lines[-200:]
            with _sync_lock:
                _sync_state["log"] = "".join(output_lines)
        proc.wait()
        with _sync_lock:
            _sync_state["running"] = False
            _sync_state["finished_at"] = time.time()
            _sync_state["exit_code"] = proc.returncode
    except Exception as e:
        with _sync_lock:
            _sync_state["running"] = False
            _sync_state["log"] += f"\n❌ Error: {e}"
            _sync_state["exit_code"] = -1
            _sync_state["finished_at"] = time.time()


def _get_comfy_health():
    """Check ComfyUI status via its system_stats and queue endpoints."""
    import urllib.request
    try:
        url = f"http://127.0.0.1:{COMFY_PORT}/system_stats"
        resp = urllib.request.urlopen(url, timeout=3)
        data = json.loads(resp.read())
        device = data.get("devices", [{}])[0]
        result = {
            "status": "running",
            "vram_free_gb": round(device.get("vram_free", 0) / 1073741824, 1),
            "vram_total_gb": round(device.get("vram_total", 0) / 1073741824, 1),
            "torch_vram_free_gb": round(device.get("torch_vram_free", 0) / 1073741824, 1),
            "gpu_name": device.get("name", "unknown"),
        }
        # Get queue depth
        try:
            q_resp = urllib.request.urlopen(f"http://127.0.0.1:{COMFY_PORT}/queue", timeout=2)
            q_data = json.loads(q_resp.read())
            result["queue_pending"] = len(q_data.get("queue_pending", []))
            result["queue_running"] = len(q_data.get("queue_running", []))
        except Exception:
            result["queue_pending"] = 0
            result["queue_running"] = 0
        return result
    except Exception:
        return {"status": "stopped"}


def _get_disk_info():
    try:
        usage = shutil.disk_usage("/workspace")
        return {
            "total_gb": round(usage.total / 1073741824, 1),
            "used_gb": round(usage.used / 1073741824, 1),
            "free_gb": round(usage.free / 1073741824, 1),
        }
    except Exception:
        return {}


def _list_models():
    """List models grouped by category."""
    result = {}
    if not os.path.isdir(MODELS_DIR):
        return result
    for subdir in sorted(os.listdir(MODELS_DIR)):
        full = os.path.join(MODELS_DIR, subdir)
        if not os.path.isdir(full):
            continue
        files = []
        for f in sorted(os.listdir(full)):
            fp = os.path.join(full, f)
            if os.path.isfile(fp) or os.path.islink(fp):
                try:
                    size = os.path.getsize(fp)
                except OSError:
                    size = 0
                files.append({"name": f, "size_mb": round(size / 1048576, 1)})
        if files:
            result[subdir] = files
    return result


# Key files that indicate whether a group's models are present.
# Each group maps to a list of (subdir, filename) tuples.
_GROUP_KEY_FILES = {
    "juggernaut": [("checkpoints", "juggernautXL_ragnarokBy.safetensors")],
    "pony": [("checkpoints", "cyberrealisticPony_v160.safetensors")],
    "qwen": [
        ("clip", "qwen_2.5_vl_7b_fp8_scaled.safetensors"),
        ("diffusion_models", "qwen_image_2512_fp8_e4m3fn.safetensors"),
    ],
    "flux2": [
        ("clip", "mistral_3_small_flux2_bf16.safetensors"),
        ("diffusion_models", "flux2_dev_fp8mixed.safetensors"),
    ],
    "z_image": [("diffusion_models", "z_image_bf16.safetensors")],
    "z_image_turbo": [("diffusion_models", "z_image_turbo_nvfp4.safetensors")],
    "wan22": [
        ("diffusion_models", "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors"),
        ("diffusion_models", "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"),
    ],
    "ltx2": [
        ("checkpoints", "ltx-2-19b-dev-fp8.safetensors"),
        ("clip", "gemma_3_12B_it_fp4_mixed.safetensors"),
    ],
    "ltx2_camera": [("loras", "ltx-2-19b-lora-camera-control-static.safetensors")],
    "upscale": [("upscale_models", "RealESRGAN_x4.pth")],
    "shared": [
        ("transformers/Qwen--Qwen2.5-3B-Instruct", "config.json"),
        ("transformers/Qwen--Qwen2.5-VL-7B-Instruct", "config.json"),
    ],
}

MIN_MODEL_SIZE = 10_000_000  # 10MB — anything smaller is likely a stub


def _check_synced_groups():
    """Check which model groups have their key files present on disk."""
    result = {}
    for group, key_files in _GROUP_KEY_FILES.items():
        present = 0
        total_size = 0
        for subdir, filename in key_files:
            path = os.path.join(MODELS_DIR, subdir, filename)
            if os.path.exists(path):
                size = os.path.getsize(path)
                # For config.json (shared group), any size is fine
                # For model files, they should be >10MB
                if filename.endswith(".json") or size > MIN_MODEL_SIZE:
                    present += 1
                    total_size += size
        result[group] = {
            "synced": present == len(key_files),
            "partial": 0 < present < len(key_files),
            "files_present": present,
            "files_total": len(key_files),
            "size_mb": round(total_size / (1024 * 1024), 1),
        }
    return result


def _tail_log(path, lines=50):
    try:
        with open(path, "r") as f:
            all_lines = f.readlines()
            return "".join(all_lines[-lines:])
    except Exception:
        return ""


def _restart_comfy():
    """Restart ComfyUI — kills old process, then starts fresh via manage.sh."""
    output_lines = []
    try:
        subprocess.run(["pkill", "-f", "python3 main.py.*--port"], capture_output=True, timeout=5)
        time.sleep(2)

        result = subprocess.run(
            ["bash", MANAGE_SCRIPT, "restart-comfy"],
            capture_output=True, text=True, timeout=180
        )
        output_lines.append(result.stdout + result.stderr)
        return {"success": result.returncode == 0, "output": "\n".join(output_lines)}
    except Exception as e:
        return {"success": False, "output": str(e)}


# ── Dashboard HTML ───────────────────────────────────────────────────────────
_html_path = pathlib.Path(__file__).parent / "index.html"
_dashboard_html = ""
if _html_path.exists():
    _dashboard_html = _html_path.read_text()


# ── OpenAPI Spec ─────────────────────────────────────────────────────────────
_OPENAPI_SPEC = {
    "openapi": "3.1.0",
    "info": {
        "title": "GPU Pod Admin API",
        "description": "Management and generation API for ComfyUI GPU pods. Provides health monitoring, model management, log access, and multi-segment video generation.",
        "version": "2.0.0",
    },
    "servers": [{"url": "/", "description": "This pod"}],
    "paths": {
        "/health": {
            "get": {
                "operationId": "getHealth",
                "summary": "Health check — ComfyUI status, VRAM, disk",
                "responses": {
                    "200": {
                        "description": "Health info",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/HealthResponse"}}},
                    }
                },
            }
        },
        "/models": {
            "get": {
                "operationId": "listModels",
                "summary": "List installed models grouped by category",
                "responses": {
                    "200": {
                        "description": "Models by category",
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "additionalProperties": {
                                "type": "array",
                                "items": {"$ref": "#/components/schemas/ModelFile"},
                            },
                        }}},
                    }
                },
            }
        },
        "/logs": {
            "get": {
                "operationId": "getLogs",
                "summary": "Get recent log lines",
                "parameters": [
                    {"name": "source", "in": "query", "schema": {"type": "string", "enum": ["comfy", "admin"], "default": "comfy"}},
                    {"name": "lines", "in": "query", "schema": {"type": "integer", "default": 80}},
                ],
                "responses": {
                    "200": {
                        "description": "Log output",
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string"},
                                "lines": {"type": "string"},
                            },
                        }}},
                    }
                },
            }
        },
        "/restart": {
            "post": {
                "operationId": "restartComfyUI",
                "summary": "Restart the ComfyUI process",
                "responses": {
                    "200": {
                        "description": "Restart result",
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "properties": {
                                "success": {"type": "boolean"},
                                "output": {"type": "string"},
                            },
                        }}},
                    }
                },
            }
        },
        "/sync-models": {
            "post": {
                "operationId": "startModelSync",
                "summary": "Start model synchronization (async)",
                "responses": {
                    "200": {"description": "Sync started", "content": {"application/json": {"schema": {"type": "object", "properties": {"status": {"type": "string"}}}}}},
                    "409": {"description": "Sync already running"},
                },
            }
        },
        "/sync-status": {
            "get": {
                "operationId": "getSyncStatus",
                "summary": "Check model sync job status",
                "responses": {
                    "200": {
                        "description": "Sync state",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SyncState"}}},
                    }
                },
            }
        },
        "/restart-admin": {
            "post": {
                "operationId": "restartAdmin",
                "summary": "Restart the admin server process (self-restart via os.execv)",
                "responses": {
                    "200": {"description": "Restarting", "content": {"application/json": {"schema": {"type": "object", "properties": {"status": {"type": "string"}}}}}},
                },
            }
        },
        "/generate/test": {
            "post": {
                "operationId": "generateTestVideo",
                "summary": "Run a quick test generation to verify the pipeline",
                "description": "Creates a test job using a generated solid-color image. Useful for verifying ComfyUI is working without needing images from the frontend.",
                "requestBody": {
                    "content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {
                            "preset": {"type": "string", "enum": ["quick", "medium", "full"], "default": "quick",
                                        "description": "quick=25f/5s, medium=49f/10s, full=97f/20s"},
                        },
                    }}},
                },
                "responses": {
                    "200": {
                        "description": "Test job started",
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "properties": {
                                "job_id": {"type": "string"},
                                "status": {"type": "string"},
                                "preset": {"type": "string"},
                                "frames": {"type": "integer"},
                                "steps": {"type": "integer"},
                            },
                        }}},
                    },
                },
            }
        },
        "/generate/text2image": {
            "post": {
                "operationId": "generateText2Image",
                "summary": "Generate an image from text prompt",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Text2ImageRequest"}}},
                },
                "responses": {
                    "200": {"description": "Job started", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SingleJobResponse"}}}},
                    "400": {"description": "Invalid request"},
                },
            }
        },
        "/generate/image2image": {
            "post": {
                "operationId": "generateImage2Image",
                "summary": "Transform an image using a text prompt",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Image2ImageRequest"}}},
                },
                "responses": {
                    "200": {"description": "Job started", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SingleJobResponse"}}}},
                    "400": {"description": "Invalid request"},
                },
            }
        },
        "/generate/image2video": {
            "post": {
                "operationId": "generateImage2Video",
                "summary": "Generate a video from an image and prompt",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Image2VideoRequest"}}},
                },
                "responses": {
                    "200": {"description": "Job started", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SingleJobResponse"}}}},
                    "400": {"description": "Invalid request"},
                },
            }
        },
        "/generate/multi-segment": {
            "post": {
                "operationId": "generateMultiSegmentVideo",
                "summary": "Generate video from image segments — the universal generation endpoint",
                "description": "Accepts an array of segments (each with an image and prompt). For single image-to-video, send 1 segment. For multi-segment, send multiple. Generates I2V for each on ComfyUI, then stitches with ffmpeg transitions. Also used as a single-segment wrapper for text2image/image2image/image2video from the frontend's buildRequestFromMeta().",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/MultiSegmentRequest"}}},
                },
                "responses": {
                    "200": {
                        "description": "Generation complete",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/MultiSegmentResponse"}}},
                    },
                    "400": {"description": "Invalid request"},
                    "409": {"description": "Generation already in progress"},
                    "500": {"description": "Generation failed"},
                },
            }
        },
        "/generate/text2video": {
            "post": {
                "operationId": "generateText2Video",
                "summary": "Generate a video from a text prompt",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Text2VideoRequest"}}},
                },
                "responses": {
                    "200": {"description": "Job started", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SingleJobResponse"}}}},
                    "400": {"description": "Invalid request"},
                },
            }
        },
        "/generate/upscale": {
            "post": {
                "operationId": "generateUpscale",
                "summary": "Upscale an image or video (RealESRGAN 4x)",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UpscaleRequest"}}},
                },
                "responses": {
                    "200": {"description": "Job started", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SingleJobResponse"}}}},
                    "400": {"description": "Invalid request"},
                },
            }
        },
        "/generate/status/{job_id}": {
            "get": {
                "operationId": "getGenerationStatus",
                "summary": "Check status of a multi-segment generation job",
                "parameters": [
                    {"name": "job_id", "in": "path", "required": True, "schema": {"type": "string"}},
                ],
                "responses": {
                    "200": {
                        "description": "Job status",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GenerationStatus"}}},
                    },
                    "404": {"description": "Job not found"},
                },
            }
        },
    },
    "components": {
        "schemas": {
            "HealthResponse": {
                "type": "object",
                "properties": {
                    "comfy": {
                        "type": "object",
                        "properties": {
                            "status": {"type": "string", "enum": ["running", "stopped"]},
                            "vram_free_gb": {"type": "number"},
                            "vram_total_gb": {"type": "number"},
                            "torch_vram_free_gb": {"type": "number"},
                            "gpu_name": {"type": "string"},
                        },
                    },
                    "disk": {
                        "type": "object",
                        "properties": {
                            "total_gb": {"type": "number"},
                            "used_gb": {"type": "number"},
                            "free_gb": {"type": "number"},
                        },
                    },
                    "admin_port": {"type": "integer"},
                    "comfy_port": {"type": "integer"},
                },
            },
            "ModelFile": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "size_mb": {"type": "number"},
                },
            },
            "SyncState": {
                "type": "object",
                "properties": {
                    "running": {"type": "boolean"},
                    "log": {"type": "string"},
                    "started_at": {"type": "number", "nullable": True},
                    "finished_at": {"type": "number", "nullable": True},
                    "exit_code": {"type": "integer", "nullable": True},
                },
            },
            "SegmentInput": {
                "type": "object",
                "required": ["prompt"],
                "properties": {
                    "image": {"type": "string", "description": "Base64-encoded image (PNG/JPEG), or 'auto' to generate via T2I first"},
                    "prompt": {"type": "string", "description": "Motion/scene prompt for this segment"},
                    "frames": {"type": "integer", "default": 121, "description": "Number of frames (25-721)"},
                    "steps": {"type": "integer", "default": 20},
                    "seed": {"type": "integer", "default": -1, "description": "Random seed (-1 for random)"},
                    "camera_lora": {"type": "string", "description": "Camera motion LoRA name"},
                    "preset": {"type": "string", "description": "I2V preset name"},
                },
            },
            "MultiSegmentRequest": {
                "type": "object",
                "required": ["segments"],
                "properties": {
                    "segments": {"type": "array", "items": {"$ref": "#/components/schemas/SegmentInput"}, "minItems": 1, "maxItems": 10},
                    "model": {"type": "string", "enum": ["ltx2", "wan22"], "default": "ltx2"},
                    "width": {"type": "integer", "default": 1280},
                    "height": {"type": "integer", "default": 720},
                    "fps": {"type": "integer", "default": 24},
                    "transition": {"type": "string", "enum": ["crossfade", "cut"], "default": "crossfade"},
                    "transition_duration": {"type": "number", "default": 0.5, "description": "Transition duration in seconds"},
                    "character_mode": {"type": "string", "enum": ["shared_hero", "independent", "chain_last_frame"], "default": "shared_hero",
                                       "description": "How source images are produced: shared_hero=one T2I image reused for all shots, chain_last_frame=each shot uses last frame of previous, independent=each shot gets its own T2I"},
                    "character_prompt": {"type": "string", "default": "", "description": "Dedicated character description for hero image generation (shared_hero mode)"},
                    "hero_image": {"type": "string", "default": "", "description": "Pre-supplied base64 hero image (skips T2I generation in shared_hero mode)"},
                },
            },
            "MultiSegmentResponse": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["queued", "processing", "completed", "failed"]},
                    "video_base64": {"type": "string", "description": "Final stitched video as base64 (only when completed)"},
                    "duration_seconds": {"type": "number"},
                    "segments_completed": {"type": "integer"},
                    "segments_total": {"type": "integer"},
                },
            },
            "GenerationStatus": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["queued", "processing", "completed", "failed"]},
                    "current_segment": {"type": "integer"},
                    "segments_total": {"type": "integer"},
                    "log": {"type": "string"},
                    "error": {"type": "string", "nullable": True},
                    "video_base64": {"type": "string", "nullable": True},
                    "image_base64": {"type": "string", "nullable": True},
                },
            },
            "Text2ImageRequest": {
                "type": "object",
                "required": ["prompt"],
                "properties": {
                    "prompt": {"type": "string", "description": "Text prompt describing the image"},
                    "negative_prompt": {"type": "string", "default": ""},
                    "width": {"type": "integer", "default": 1024},
                    "height": {"type": "integer", "default": 1024},
                    "steps": {"type": "integer", "default": 20},
                    "seed": {"type": "integer", "default": -1},
                    "model": {"type": "string", "enum": ["wan22", "flux2", "flux2_turbo", "qwen"], "default": "wan22",
                              "description": "Model to use: wan22=Wan 2.2, flux2=Flux2 Dev, flux2_turbo=Flux2 Turbo, qwen=Qwen"},
                    "lora_strength": {"type": "number", "default": 1.0},
                },
            },
            "Image2ImageRequest": {
                "type": "object",
                "required": ["image", "prompt"],
                "properties": {
                    "image": {"type": "string", "description": "Base64-encoded source image"},
                    "prompt": {"type": "string"},
                    "negative_prompt": {"type": "string", "default": ""},
                    "width": {"type": "integer", "default": 1024},
                    "height": {"type": "integer", "default": 1024},
                    "steps": {"type": "integer", "default": 20},
                    "cfg": {"type": "number", "default": 3.5},
                    "denoise": {"type": "number", "default": 0.75, "description": "Denoise strength (0=no change, 1=full regeneration)"},
                    "seed": {"type": "integer", "default": -1},
                    "model": {"type": "string", "enum": ["wan22", "flux2_turbo"], "default": "wan22"},
                },
            },
            "Image2VideoRequest": {
                "type": "object",
                "required": ["image", "prompt"],
                "properties": {
                    "image": {"type": "string", "description": "Base64-encoded source image"},
                    "prompt": {"type": "string", "description": "Motion/scene prompt"},
                    "negative_prompt": {"type": "string", "default": ""},
                    "width": {"type": "integer", "default": 1280},
                    "height": {"type": "integer", "default": 720},
                    "frames": {"type": "integer", "default": 97, "description": "Number of frames (25-721)"},
                    "steps": {"type": "integer", "default": 20},
                    "fps": {"type": "integer", "default": 24},
                    "seed": {"type": "integer", "default": -1},
                    "camera_lora": {"type": "string", "description": "Camera motion LoRA name"},
                    "preset": {"type": "string", "description": "I2V preset name or 'random'"},
                    "model": {"type": "string", "enum": ["ltx2", "wan22"], "default": "ltx2"},
                },
            },
            "Text2VideoRequest": {
                "type": "object",
                "required": ["prompt"],
                "properties": {
                    "prompt": {"type": "string"},
                    "negative_prompt": {"type": "string", "default": ""},
                    "width": {"type": "integer", "default": 832},
                    "height": {"type": "integer", "default": 480},
                    "frames": {"type": "integer", "default": 81},
                    "steps": {"type": "integer", "default": 4},
                    "fps": {"type": "integer", "default": 24},
                    "seed": {"type": "integer", "default": -1},
                    "model": {"type": "string", "enum": ["ltx2", "wan22"], "default": "wan22"},
                    "lora_strength": {"type": "number", "default": 1.0},
                    "camera_lora": {"type": "string"},
                    "audio_prompt": {"type": "string"},
                },
            },
            "UpscaleRequest": {
                "type": "object",
                "properties": {
                    "image": {"type": "string", "description": "Base64-encoded image (provide image OR video)"},
                    "video": {"type": "string", "description": "Base64-encoded video (provide image OR video)"},
                    "scale": {"type": "integer", "enum": [2, 4], "default": 2},
                    "fps": {"type": "integer", "default": 24, "description": "Output FPS (video only)"},
                },
            },
            "SingleJobResponse": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["queued"]},
                },
            },
        }
    },
}




# ── Multi-Segment Generation Orchestrator ────────────────────────────────────

import uuid, base64, urllib.request, urllib.error, glob, re
from copy import deepcopy
import workflow_loader as wfl  # Modular workflow builders

JOBS_DIR = "/workspace/jobs"
os.makedirs(JOBS_DIR, exist_ok=True)

_jobs_lock = threading.Lock()
_jobs: dict = {}  # job_id -> state dict
JOB_TTL_S = 24 * 3600  # Clean up completed/failed jobs after 24 hours


def _cleanup_old_jobs():
    """Remove completed/failed jobs older than JOB_TTL_S to free memory and disk."""
    now = time.time()
    to_remove = []
    with _jobs_lock:
        for jid, job in _jobs.items():
            if job["status"] not in ("completed", "failed"):
                continue
            created = job.get("created_at", 0)
            if now - created > JOB_TTL_S:
                to_remove.append(jid)
        for jid in to_remove:
            del _jobs[jid]
    for jid in to_remove:
        job_dir = os.path.join(JOBS_DIR, jid)
        if os.path.isdir(job_dir):
            try:
                shutil.rmtree(job_dir)
            except OSError:
                pass


def _fire_callback(job_id):
    """POST lightweight completion/failure notification to the callback URL.
    Does NOT send base64 blobs — the web server fetches result data separately.
    Retries 3× with exponential backoff (1s, 3s, 9s)."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        callback_url = job.get("callback_url")
        callback_secret = job.get("callback_secret", "")
        if not callback_url:
            return
        payload = {
            "job_id": job_id,
            "status": job["status"],
            "result_type": job.get("result_type"),
            "has_video": job.get("result_type") == "video",
            "has_image": job.get("result_type") == "image",
            "error": job.get("error"),
        }

    body = json.dumps(payload).encode("utf-8")
    # Sign with HMAC-SHA256 if secret provided
    signature = ""
    if callback_secret:
        signature = hmac.new(callback_secret.encode(), body, hashlib.sha256).hexdigest()

    delays = [1, 3, 9]
    for attempt, delay in enumerate(delays, 1):
        try:
            import urllib.request
            req = urllib.request.Request(
                callback_url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": signature,
                },
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=10)
            print(f"[Callback] ✅ {job_id[:8]} → {callback_url} (attempt {attempt}, HTTP {resp.status})")
            return
        except Exception as e:
            print(f"[Callback] ⚠️ {job_id[:8]} attempt {attempt}/{len(delays)} failed: {e}")
            if attempt < len(delays):
                time.sleep(delay)

    print(f"[Callback] ❌ {job_id[:8]} all {len(delays)} attempts failed for {callback_url}")
    if to_remove:
        print(f"[Cleanup] Removed {len(to_remove)} old jobs")


def _comfy_api(path, data=None, method=None, timeout=30):
    """Call ComfyUI API. Returns parsed JSON or raw bytes."""
    url = f"http://127.0.0.1:{COMFY_PORT}{path}"
    if data is not None:
        body = json.dumps(data).encode() if isinstance(data, dict) else data
        req = urllib.request.Request(url, data=body, method=method or "POST")
        req.add_header("Content-Type", "application/json")
    else:
        req = urllib.request.Request(url, method=method or "GET")
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            err_json = json.loads(err_body)
            raise RuntimeError(f"ComfyUI {e.code}: {json.dumps(err_json, indent=2)}") from e
        except json.JSONDecodeError:
            raise RuntimeError(f"ComfyUI {e.code}: {err_body[:500]}") from e
    ct = resp.headers.get("Content-Type", "")
    raw = resp.read()
    # Always try JSON first — ComfyUI sometimes returns JSON without proper Content-Type
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return raw


def _comfy_upload_image(image_bytes, filename):
    """Upload an image to ComfyUI's /upload/image endpoint (multipart)."""
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex[:16]}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + image_bytes + f"\r\n--{boundary}--\r\n".encode()

    url = f"http://127.0.0.1:{COMFY_PORT}/upload/image"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    return result.get("name", filename)


# ---------- ComfyUI output directory (for file-watching) ----------
COMFY_OUTPUT = os.path.join(COMFY_DIR, "output")


# Lock for atomic file claiming in Method 2
_file_claim_lock = threading.Lock()
_claimed_files = set()  # Files already claimed by another thread


def _comfy_queue_and_wait(workflow, output_prefix="LTX-2-I2V", poll_interval=5):
    """Queue a ComfyUI prompt and wait for the output video file.
    Works with both old-style (prompt_id in response + /history) and
    ComfyUI 0.14+ (exec_info response, inline execution).

    CONCURRENCY SAFE: When prompt_id is available (the normal case),
    uses /history/{prompt_id} exclusively — each prompt gets its own
    unique output reference, so concurrent threads never collide.
    Method 2 (file scanning) is only used when no prompt_id is available
    and uses atomic claiming to prevent races.

    Returns file_info dict: {filename, subfolder, type}."""

    # Snapshot existing output files before queuing
    video_dir = os.path.join(COMFY_OUTPUT, "video")
    os.makedirs(video_dir, exist_ok=True)
    before = set(os.listdir(video_dir))

    # Queue the prompt (large timeout — ComfyUI 0.14+ may execute synchronously)
    client_id = str(uuid.uuid4())
    result = _comfy_api("/prompt", {"prompt": workflow, "client_id": client_id}, timeout=600)

    # Check if prompt was rejected
    if isinstance(result, dict) and "error" in result and "prompt_id" not in result and "exec_info" not in result:
        error = result.get("error", {})
        node_errors = result.get("node_errors", {})
        msg = error.get("message", "unknown") if isinstance(error, dict) else str(error)
        raise RuntimeError(f"ComfyUI rejected prompt: {msg} | node_errors: {json.dumps(node_errors)[:500]}")

    prompt_id = result.get("prompt_id") if isinstance(result, dict) else None
    is_exec_info = isinstance(result, dict) and "exec_info" in result
    print(f"[Orchestrator] Prompt queued: prompt_id={prompt_id}, exec_info={is_exec_info}")

    history_errors = 0

    while True:
        # ── Method 1 (PRIMARY): Use prompt_id + /history ──────────────
        # This is the ONLY concurrency-safe method. Each prompt_id maps
        # to exactly one execution with its own output files.
        if prompt_id:
            try:
                history = _comfy_api(f"/history/{prompt_id}")
                if prompt_id in history:
                    entry = history[prompt_id]
                    status = entry.get("status", {})
                    if status.get("status_str") == "error":
                        raise RuntimeError(f"ComfyUI execution failed: {status}")
                    if status.get("completed", False) or status.get("status_str") == "success":
                        outputs = entry.get("outputs", {})
                        for node_out in outputs.values():
                            for vid in node_out.get("videos", []):
                                fname = vid["filename"]
                                subfolder = vid.get("subfolder", "")
                                ftype = vid.get("type", "output")
                                print(f"[Orchestrator] prompt_id={prompt_id[:8]} -> {fname}")
                                return {"filename": fname, "subfolder": subfolder, "type": ftype}
                history_errors = 0  # Reset on successful poll
            except RuntimeError:
                raise  # Re-raise execution failures
            except Exception as e:
                history_errors += 1
                if history_errors <= 3:
                    print(f"[Orchestrator] /history poll error #{history_errors}: {e}")
                # DON'T fall through to Method 2 — just retry on next loop

            # When we have prompt_id, NEVER use Method 2.
            # Just sleep and retry /history on the next iteration.
            time.sleep(poll_interval)
            continue

        # ── Method 2 (FALLBACK): File scanning with atomic claim ──────
        # Only used when there's NO prompt_id (exec_info mode).
        # Uses a lock + claimed set to prevent two threads from grabbing
        # the same file.
        after = set(os.listdir(video_dir))
        new_files = sorted([
            f for f in after - before
            if f.endswith(".mp4") and output_prefix in f
        ])

        if new_files:
            with _file_claim_lock:
                # Filter out files already claimed by other threads
                unclaimed = [f for f in new_files if f not in _claimed_files]
                if unclaimed:
                    target = unclaimed[-1]  # newest unclaimed
                    path = os.path.join(video_dir, target)
                    size1 = os.path.getsize(path)
                    if size1 > 0:
                        # Release lock, wait for file to settle
                        pass
                    else:
                        target = None
                else:
                    target = None

            if target:
                path = os.path.join(video_dir, target)
                size1 = os.path.getsize(path)
                time.sleep(2)
                size2 = os.path.getsize(path)
                if size1 == size2 and size1 > 0:
                    with _file_claim_lock:
                        if target not in _claimed_files:
                            _claimed_files.add(target)
                            print(f"[Orchestrator] Claimed output: {target} ({size2} bytes)")
                            return {"filename": target, "subfolder": "video", "type": "output"}
                        # else: another thread claimed it between our checks

        # Check ComfyUI queue status for exec_info completion
        try:
            queue = _comfy_api("/queue")
            running = len(queue.get("queue_running", []))
            pending = len(queue.get("queue_pending", []))
            if is_exec_info and running == 0 and pending == 0:
                after = set(os.listdir(video_dir))
                new_files = sorted([
                    f for f in after - before
                    if f.endswith(".mp4") and output_prefix in f
                ])
                if new_files:
                    with _file_claim_lock:
                        unclaimed = [f for f in new_files if f not in _claimed_files]
                        if unclaimed:
                            target = unclaimed[-1]
                            path = os.path.join(video_dir, target)
                            if os.path.getsize(path) > 0:
                                _claimed_files.add(target)
                                return {"filename": target, "subfolder": "video", "type": "output"}
        except Exception:
            pass

        time.sleep(poll_interval)


def _comfy_download_file(file_info, dest_dir):
    """Download a file from ComfyUI output. Returns the local file path."""
    fname = file_info["filename"]
    subfolder = file_info.get("subfolder", "")
    ftype = file_info.get("type", "output")
    url = f"http://127.0.0.1:{COMFY_PORT}/view?filename={fname}&subfolder={subfolder}&type={ftype}"
    data = urllib.request.urlopen(url, timeout=120).read()
    out_path = os.path.join(dest_dir, fname)
    with open(out_path, "wb") as f:
        f.write(data)
    return out_path


def _build_ltx2_i2v_workflow(image_filename, prompt, neg_prompt, width, height, frames, steps, fps, seed, camera_lora=None, preset=None, lora_strength=1.0, image_strength=1.0):
    """Build an LTX-2 I2V workflow — delegates to workflow_loader."""
    return wfl.build_ltx_2_i2v_workflow(
        image_filename=image_filename, prompt=prompt, negative_prompt=neg_prompt,
        width=width, height=height, frames=frames, steps=steps,
        seed=seed, fps=fps, lora_strength=lora_strength,
        image_strength=image_strength, camera_lora=camera_lora, preset=preset,
    )


def _ffmpeg_stitch(video_paths, output_path, transition="crossfade", transition_duration=0.5, fps=24):
    """Stitch multiple videos with ffmpeg transitions."""

    def _run_ffmpeg(cmd, label="ffmpeg"):
        print(f"[Stitch] {label}: {' '.join(cmd[-8:])}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"[Stitch] {label} FAILED (rc={result.returncode}): {result.stderr[-500:]}")
        return result.returncode == 0

    def _get_duration(vp):
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", vp],
            capture_output=True, text=True, timeout=30
        )
        try:
            return float(probe.stdout.strip())
        except (ValueError, AttributeError):
            return 4.0

    def _get_resolution(vp):
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", vp],
            capture_output=True, text=True, timeout=30
        )
        try:
            w, h = probe.stdout.strip().split(",")
            return int(w), int(h)
        except (ValueError, AttributeError):
            return None, None

    if len(video_paths) == 1:
        ok = _run_ffmpeg([
            "ffmpeg", "-y", "-i", video_paths[0],
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-an", "-movflags", "+faststart", output_path
        ], "single-faststart")
        if ok and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return
        shutil.copy2(video_paths[0], output_path)
        return

    def _normalize_all(paths, target_w, target_h):
        """Pre-normalize all clips to identical resolution/fps/pixel format."""
        normalized = []
        for i, vp in enumerate(paths):
            norm = vp.rsplit(".", 1)[0] + "_norm.mp4"
            ew = target_w if target_w % 2 == 0 else target_w + 1
            eh = target_h if target_h % 2 == 0 else target_h + 1
            ok = _run_ffmpeg([
                "ffmpeg", "-y", "-i", vp,
                "-vf", f"scale={ew}:{eh}:force_original_aspect_ratio=disable,fps={fps},format=yuv420p",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-an", "-movflags", "+faststart", norm
            ], f"normalize[{i}]")
            if ok and os.path.exists(norm) and os.path.getsize(norm) > 0:
                normalized.append(norm)
            else:
                normalized.append(vp)
        return normalized

    def _cleanup_normalized(normalized, original_paths):
        for n in normalized:
            if n not in original_paths and n.endswith("_norm.mp4"):
                try:
                    os.remove(n)
                except OSError:
                    pass

    # Determine target resolution from first clip
    target_w, target_h = _get_resolution(video_paths[0])
    if not target_w:
        target_w, target_h = 1280, 720

    if transition == "cut":
        normalized = _normalize_all(video_paths, target_w, target_h)
        list_file = output_path + ".txt"
        with open(list_file, "w") as f:
            for vp in normalized:
                f.write(f"file '{vp}'\n")
        ok = _run_ffmpeg([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
            "-c", "copy", "-movflags", "+faststart", output_path
        ], "concat-copy")
        try:
            os.remove(list_file)
        except OSError:
            pass
        _cleanup_normalized(normalized, video_paths)
        if ok and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return
        raise RuntimeError("ffmpeg concat failed")

    # Crossfade — normalize first, then xfade, fall back to concat
    normalized = _normalize_all(video_paths, target_w, target_h)
    durations = [_get_duration(vp) for vp in normalized]
    print(f"[Stitch] Segment durations (after normalize): {durations}")

    td = transition_duration
    inputs = []
    for vp in normalized:
        inputs.extend(["-i", vp])

    if len(normalized) == 2:
        offset = max(0, durations[0] - td)
        filter_str = f"[0:v][1:v]xfade=transition=fade:duration={td}:offset={offset:.2f},format=yuv420p[v]"
        cmd = ["ffmpeg", "-y"] + inputs + [
            "-filter_complex", filter_str, "-map", "[v]",
            "-an", "-r", str(fps), "-movflags", "+faststart", output_path
        ]
    else:
        filters = []
        running_offset = 0
        for i in range(len(normalized) - 1):
            running_offset += durations[i] - td if i > 0 else durations[0] - td
            offset = max(0, running_offset)
            if i == 0:
                filters.append(f"[0:v][1:v]xfade=transition=fade:duration={td}:offset={offset:.2f}[v{i}]")
            elif i < len(normalized) - 2:
                filters.append(f"[v{i-1}][{i+1}:v]xfade=transition=fade:duration={td}:offset={offset:.2f}[v{i}]")
            else:
                filters.append(f"[v{i-1}][{i+1}:v]xfade=transition=fade:duration={td}:offset={offset:.2f},format=yuv420p[v]")

        filter_str = ";".join(filters)
        cmd = ["ffmpeg", "-y"] + inputs + [
            "-filter_complex", filter_str, "-map", "[v]",
            "-an", "-r", str(fps), "-movflags", "+faststart", output_path
        ]

    if _run_ffmpeg(cmd, "xfade"):
        _cleanup_normalized(normalized, video_paths)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return

    # xfade failed — fall back to concat with normalized clips
    print(f"[Stitch] xfade failed, falling back to concat with normalized clips")
    list_file = output_path + ".txt"
    with open(list_file, "w") as f:
        for vp in normalized:
            f.write(f"file '{vp}'\n")
    ok = _run_ffmpeg([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
        "-c", "copy", "-movflags", "+faststart", output_path
    ], "concat-fallback")
    try:
        os.remove(list_file)
    except OSError:
        pass
    _cleanup_normalized(normalized, video_paths)
    if ok and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        return
    raise RuntimeError("ffmpeg stitching failed (both xfade and concat fallback)")


def _extract_last_frame(video_path, output_path):
    """Extract the last frame of a video using ffmpeg. Returns the output path."""
    # Get total frame count
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", video_path],
        capture_output=True, text=True, timeout=60
    )
    try:
        total_frames = int(probe.stdout.strip())
    except (ValueError, AttributeError):
        total_frames = 100  # fallback

    # Extract the last frame
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", video_path,
         "-vf", f"select=eq(n\\,{total_frames - 1})",
         "-vframes", "1", output_path],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not os.path.exists(output_path):
        # Fallback: grab from last 0.1s
        subprocess.run(
            ["ffmpeg", "-y", "-sseof", "-0.1", "-i", video_path,
             "-vframes", "1", "-update", "1", output_path],
            capture_output=True, text=True, timeout=30
        )
    return output_path


def _run_multi_segment(job_id, request_data):
    """Run multi-segment generation in a background thread.

    Supports three character_mode values:
      - shared_hero:     Generate ONE hero image, reuse for ALL segments (character consistency)
      - chain_last_frame: Each segment uses the last frame of the previous clip (visual continuity)
      - independent:      Each segment generates its own T2I image (original behavior)
    """
    segments = request_data["segments"]
    model = request_data.get("model", "ltx2")
    width = request_data.get("width", 1280)
    height = request_data.get("height", 720)
    fps = request_data.get("fps", 24)
    transition = request_data.get("transition", "crossfade")
    transition_duration = request_data.get("transition_duration", 0.5)
    character_mode = request_data.get("character_mode", "shared_hero")
    character_prompt = request_data.get("character_prompt", "")
    hero_image_b64 = request_data.get("hero_image", "")
    neg_prompt = "blurry, low quality, still frame, watermark, overlay, titles, subtitles, text, logo"

    job_dir = os.path.join(JOBS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    # Clear ComfyUI history to avoid stale prompt_id conflicts
    try:
        _comfy_api("/history", {"clear": True}, method="POST")
    except Exception:
        pass  # Non-critical

    def _log(msg):
        with _jobs_lock:
            _jobs[job_id]["log"] += msg + "\n"
        print(f"[Job {job_id[:8]}] {msg}")

    segment_videos = []
    hero_img_data = None  # Cached hero image bytes for shared_hero mode

    try:
        # ── Step 0: Generate or load hero image for shared_hero mode ──
        if character_mode == "shared_hero":
            if hero_image_b64 and len(hero_image_b64) > 100:
                _log(f"▸ Using supplied hero image ({len(hero_image_b64)} chars b64)")
                hero_img_data = base64.b64decode(hero_image_b64)
            else:
                # Generate a hero image via T2I
                hero_prompt = character_prompt or segments[0].get("prompt", "beautiful woman, cinematic")
                _log(f"▸ Generating hero image: {hero_prompt[:80]}...")
                t2i_wf = wfl.build_text2image_workflow(
                    prompt=hero_prompt, negative_prompt=neg_prompt,
                    width=width, height=height, steps=35, seed=-1,
                )
                t2i_output = _comfy_queue_and_wait_image(t2i_wf)
                _log(f"  ✅ Hero image generated: {os.path.basename(t2i_output)}")
                with open(t2i_output, "rb") as f:
                    hero_img_data = f.read()

        for i, seg in enumerate(segments):
            with _jobs_lock:
                _jobs[job_id]["current_segment"] = i + 1
                _jobs[job_id]["status"] = "processing"

            _log(f"▸ Segment {i+1}/{len(segments)}: {seg['prompt'][:60]}...")

            # 1. Determine source image based on character_mode
            raw_image = seg.get("image", "")
            has_explicit_image = raw_image and raw_image != "auto" and len(raw_image) > 100

            if has_explicit_image:
                # Segment has its own image — always use it regardless of mode
                img_data = base64.b64decode(raw_image)
                _log(f"  📷 Using segment's explicit image")

            elif character_mode == "shared_hero" and hero_img_data:
                # Reuse the hero image for every segment
                img_data = hero_img_data
                _log(f"  🧍 Using shared hero image (character consistency)")

            elif character_mode == "chain_last_frame" and i > 0 and segment_videos:
                # Extract last frame from previous segment's video
                last_frame_path = os.path.join(job_dir, f"last_frame_{i}.png")
                _extract_last_frame(segment_videos[-1], last_frame_path)
                if os.path.exists(last_frame_path) and os.path.getsize(last_frame_path) > 0:
                    with open(last_frame_path, "rb") as f:
                        img_data = f.read()
                    _log(f"  🔗 Using last frame from segment {i} (chain mode)")
                else:
                    # Fallback to T2I
                    _log(f"  ⚠️ Last frame extraction failed, falling back to T2I")
                    t2i_wf = wfl.build_text2image_workflow(
                        prompt=seg["prompt"], negative_prompt=neg_prompt,
                        width=width, height=height, steps=35, seed=-1,
                    )
                    t2i_output = _comfy_queue_and_wait_image(t2i_wf)
                    with open(t2i_output, "rb") as f:
                        img_data = f.read()

            else:
                # Independent mode OR first segment in chain mode — generate via T2I
                t2i_steps = seg.get("t2i_steps", 35)
                t2i_seed = seg.get("seed", -1)
                t2i_prompt = seg["prompt"]
                # In chain mode first segment, prefer character_prompt if available
                if character_mode == "chain_last_frame" and i == 0 and character_prompt:
                    t2i_prompt = character_prompt
                _log(f"  🎨 Generating via T2I ({t2i_steps} steps)...")
                t2i_wf = wfl.build_text2image_workflow(
                    prompt=t2i_prompt, negative_prompt=neg_prompt,
                    width=width, height=height, steps=t2i_steps, seed=t2i_seed,
                )
                t2i_output = _comfy_queue_and_wait_image(t2i_wf)
                _log(f"  ✅ T2I image generated: {os.path.basename(t2i_output)}")
                with open(t2i_output, "rb") as f:
                    img_data = f.read()

            img_filename = f"seg_{job_id[:8]}_{i}.png"
            uploaded_name = _comfy_upload_image(img_data, img_filename)
            _log(f"  ✅ Image uploaded as {uploaded_name}")

            # 2. Build workflow based on selected model
            frames = seg.get("frames", 121)
            steps = seg.get("steps", 20)
            camera_lora = seg.get("camera_lora")
            seed = seg.get("seed", -1)

            if model == "wan22":
                workflow = wfl.build_image2video_workflow(
                    image_filename=uploaded_name,
                    prompt=seg["prompt"], negative_prompt=neg_prompt,
                    width=width, height=height,
                    frames=frames, steps=steps, seed=seed,
                )
                output_prefix = "wan_i2v"
            else:
                workflow = _build_ltx2_i2v_workflow(
                    image_filename=uploaded_name,
                    prompt=seg["prompt"], neg_prompt=neg_prompt,
                    width=width, height=height,
                    frames=frames, steps=steps, fps=fps,
                    seed=seed, camera_lora=camera_lora,
                )
                output_prefix = "LTX-2-I2V"

            # 3. Queue prompt and wait for output
            _log(f"  ⏳ Queuing generation (model={model})...")
            file_info = _comfy_queue_and_wait(workflow, output_prefix=output_prefix, poll_interval=5)
            _log(f"  ✅ Generation complete: {file_info['filename']}")

            # 4. Download output video
            vid_path = _comfy_download_file(file_info, job_dir)
            segment_videos.append(vid_path)
            _log(f"  ✅ Downloaded: {os.path.basename(vid_path)}")

            with _jobs_lock:
                _jobs[job_id]["segments_completed"] = i + 1

        # 5. Stitch with ffmpeg
        _log(f"▸ Stitching {len(segment_videos)} videos ({transition}, {transition_duration}s)...")
        final_path = os.path.join(job_dir, "final.mp4")
        _ffmpeg_stitch(segment_videos, final_path, transition, transition_duration, fps)

        if not os.path.exists(final_path):
            raise RuntimeError("ffmpeg stitching produced no output")

        file_size = os.path.getsize(final_path)
        _log(f"✅ Done! Final video: {file_size / 1048576:.1f} MB")

        with _jobs_lock:
            _jobs[job_id]["status"] = "completed"
            _jobs[job_id]["result_path"] = final_path
            _jobs[job_id]["result_type"] = "video"
            _jobs[job_id]["file_size_mb"] = round(file_size / 1048576, 1)

    except Exception as e:
        _log(f"❌ Failed: {e}")
        with _jobs_lock:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = str(e)
    finally:
        _fire_callback(job_id)
        _cleanup_old_jobs()


def _comfy_queue_and_wait_image(workflow, poll_interval=3):
    """Queue a ComfyUI prompt and wait for image output via /history polling.
    Returns the local file path to the output image."""
    client_id = str(uuid.uuid4())
    result = _comfy_api("/prompt", {"prompt": workflow, "client_id": client_id}, timeout=300)

    if isinstance(result, dict) and "error" in result and "prompt_id" not in result and "exec_info" not in result:
        error = result.get("error", {})
        node_errors = result.get("node_errors", {})
        msg = error.get("message", "unknown") if isinstance(error, dict) else str(error)
        raise RuntimeError(f"ComfyUI rejected prompt: {msg} | node_errors: {json.dumps(node_errors)[:500]}")

    prompt_id = result.get("prompt_id") if isinstance(result, dict) else None
    print(f"[Orchestrator] Image prompt queued: prompt_id={prompt_id}")

    while True:
        if prompt_id:
            try:
                history = _comfy_api(f"/history/{prompt_id}")
                if prompt_id in history:
                    entry = history[prompt_id]
                    status = entry.get("status", {})
                    if status.get("status_str") == "error":
                        raise RuntimeError(f"ComfyUI execution failed: {status}")
                    if status.get("completed", False) or status.get("status_str") == "success":
                        outputs = entry.get("outputs", {})
                        for node_out in outputs.values():
                            for img in node_out.get("images", []):
                                fname = img["filename"]
                                subfolder = img.get("subfolder", "")
                                fpath = os.path.join(COMFY_OUTPUT, subfolder, fname) if subfolder else os.path.join(COMFY_OUTPUT, fname)
                                if os.path.exists(fpath) and os.path.getsize(fpath) > 0:
                                    return fpath
            except (urllib.error.URLError, ConnectionError, RuntimeError) as e:
                if isinstance(e, RuntimeError) and "execution failed" in str(e):
                    raise
        time.sleep(poll_interval)

        # (loops forever — server may be backed up)


# ── Prompt Remix (Qwen2.5-3B-Instruct) ──────────────────────────────────────

_remix_pipeline = None
_remix_lock = threading.Lock()

_REMIX_SYSTEM = (
    "You are a creative AI image prompt engineer. Given a user's image generation prompt, "
    "create a variation that is visually distinct but thematically related. Make it more vivid, "
    "detailed, and cinematic. Add interesting artistic styles, lighting, color palettes, "
    "composition details, and atmosphere. Keep the core subject but transform the scene into "
    "something fresh and stunning. Output ONLY the new prompt, nothing else. No explanations, "
    "no quotes, no prefixes."
)

def _get_remix_pipeline():
    global _remix_pipeline
    if _remix_pipeline is not None:
        return _remix_pipeline
    with _remix_lock:
        if _remix_pipeline is not None:
            return _remix_pipeline
        from transformers import pipeline as hf_pipeline
        model_path = "/workspace/models/transformers/Qwen--Qwen2.5-3B-Instruct"
        print(f"[Remix] Loading Qwen2.5-3B-Instruct from {model_path}...")
        _remix_pipeline = hf_pipeline(
            "text-generation",
            model=model_path,
            device_map="auto",
            torch_dtype="auto",
        )
        print("[Remix] ✅ Model loaded")
        return _remix_pipeline

def _remix_prompts(prompt, count=1, temperature=0.9):
    """Generate creative prompt variations using Qwen2.5-3B-Instruct."""
    pipe = _get_remix_pipeline()
    prompts = []
    for _ in range(count):
        messages = [
            {"role": "system", "content": _REMIX_SYSTEM},
            {"role": "user", "content": f"Create a creative variation of this image prompt:\n\n{prompt}"},
        ]
        result = pipe(
            messages,
            max_new_tokens=300,
            temperature=temperature,
            do_sample=True,
            top_p=0.95,
        )
        text = result[0]["generated_text"]
        # The pipeline returns the full conversation; extract the assistant's reply
        if isinstance(text, list):
            # Chat format: list of message dicts
            text = text[-1]["content"] if text else ""
        elif isinstance(text, str):
            # Raw text — strip the input prefix if present
            pass
        text = text.strip().strip('"').strip("'")
        if text:
            prompts.append(text)
    return prompts


def _run_single_generation(job_id, action, data):
    """Orchestrator for single image/video generation (text2image, image2image, image2video)."""
    import random

    def _log(msg):
        with _jobs_lock:
            _jobs[job_id]["log"] += msg + "\n"
        print(f"[Job {job_id[:8]}] {msg}")

    try:
        with _jobs_lock:
            _jobs[job_id]["status"] = "processing"

        if action == "image2video":
            img_data = base64.b64decode(data["image"])
            img_filename = f"i2v_{job_id[:8]}.png"
            uploaded_name = _comfy_upload_image(img_data, img_filename)
            _log(f"✅ Image uploaded as {uploaded_name}")

            model = data.get("model", "ltx2")
            seed = data.get("seed", -1)
            frames = data.get("frames", 97)
            steps = data.get("steps", 20)

            if model == "wan22":
                workflow = wfl.build_image2video_workflow(
                    image_filename=uploaded_name,
                    prompt=data.get("prompt", ""),
                    negative_prompt=data.get("negative_prompt", "blurry, low quality, watermark"),
                    width=data.get("width", 768), height=data.get("height", 768),
                    frames=frames, steps=steps, seed=seed,
                )
                output_prefix = "wan_i2v"
            else:
                workflow = _build_ltx2_i2v_workflow(
                    image_filename=uploaded_name,
                    prompt=data.get("prompt", ""),
                    neg_prompt=data.get("negative_prompt", "blurry, low quality, watermark"),
                    width=data.get("width", 1280), height=data.get("height", 720),
                    frames=frames, steps=steps, fps=data.get("fps", 24),
                    seed=seed, camera_lora=data.get("camera_lora"),
                    preset=data.get("preset"),
                    lora_strength=data.get("lora_strength", 1.0),
                    image_strength=data.get("image_strength", 1.0),
                )
                output_prefix = "LTX-2-I2V"

            _log(f"⏳ Queuing I2V generation ({frames} frames, {steps} steps, model={model})...")
            file_info = _comfy_queue_and_wait(workflow, output_prefix=output_prefix, poll_interval=5)
            _log(f"✅ Generation complete: {file_info['filename']}")

            job_dir = os.path.join(JOBS_DIR, job_id)
            os.makedirs(job_dir, exist_ok=True)
            vid_path = _comfy_download_file(file_info, job_dir)

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = vid_path
                _jobs[job_id]["result_type"] = "video"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done! Video: {os.path.getsize(vid_path) / 1048576:.1f} MB")

        elif action == "text2image":
            model = data.get("model", "wan22")
            w = data.get("width", 1024)
            h = data.get("height", 1024)
            steps = data.get("steps", 20)
            seed = data.get("seed", -1)

            # Use the proper workflow builder per model
            if model == "flux2" or model == "flux2_turbo":
                wf = wfl.build_flux2_text2image_workflow(
                    prompt=data.get("prompt", ""), width=w, height=h,
                    steps=steps, seed=seed, turbo=(model == "flux2_turbo"),
                )
            elif model == "qwen":
                wf = wfl.build_qwen_image_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, seed=seed,
                )
            elif model == "qwen_lora":
                wf = wfl.build_qwen_lora_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 4.0), seed=seed,
                    lora_strength=data.get("lora_strength", 0.75),
                    sampler_name=data.get("sampler_name", "euler"),
                    scheduler=data.get("scheduler", "simple"),
                )
            elif model == "z_image":
                wf = wfl.build_z_image_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 3.8), seed=seed,
                    lora_strength=data.get("lora_strength", 0.72),
                    sampler_name=data.get("sampler_name", "dpmpp_2m"),
                    scheduler=data.get("scheduler", "beta"),
                )
            elif model == "z_image_turbo":
                wf = wfl.build_z_image_turbo_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 3.5), seed=seed,
                    sampler_name=data.get("sampler_name", "dpmpp_2m"),
                    scheduler=data.get("scheduler", "beta"),
                )
            elif model == "juggernaut":
                wf = wfl.build_juggernaut_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 5.0), seed=seed,
                    sampler_name=data.get("sampler_name", "dpmpp_2m_sde"),
                    scheduler=data.get("scheduler", "karras"),
                )
            elif model == "cyberrealistic_pony":
                wf = wfl.build_cyberrealistic_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 5.0), seed=seed,
                    sampler_name=data.get("sampler_name", "dpmpp_2m_sde"),
                    scheduler=data.get("scheduler", "karras"),
                    lora_name=data.get("lora_name"), lora_strength=data.get("lora_strength", 0.7),
                )
            elif model == "qwen_lora":
                wf = wfl.build_qwen_lora_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 4.0), seed=seed,
                    lora_strength=data.get("lora_strength", 0.75),
                    sampler_name=data.get("sampler_name", "euler"),
                    scheduler=data.get("scheduler", "simple"),
                )
            else:  # wan22
                wf = wfl.build_text2image_workflow(
                    prompt=data.get("prompt", ""), negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 3.7), seed=seed,
                    lora_strength=data.get("lora_strength", 1.0),
                    sampler_name=data.get("sampler_name", "dpmpp_2m_sde"),
                    scheduler=data.get("scheduler", "karras"),
                    custom_loras=data.get("custom_loras"),
                )

            _log(f"⏳ Queuing T2I ({w}x{h}, {steps} steps, model={model})...")
            output = _comfy_queue_and_wait_image(wf)
            _log(f"✅ Image generated: {output}")

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = output
                _jobs[job_id]["result_type"] = "image"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done!")

        elif action == "text2image_then_video":
            # ── Phase 1: Generate the image ──
            model = data.get("image_model", "cyberrealistic_pony")
            w = data.get("width", 832)
            h = data.get("height", 480)
            steps = data.get("steps", 30)
            seed = data.get("seed", random.randint(0, 2**32 - 1))
            img_prompt = data.get("prompt", "")

            if model == "cyberrealistic_pony":
                wf = wfl.build_cyberrealistic_workflow(
                    prompt=img_prompt, negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 5.0), seed=seed,
                    sampler_name=data.get("sampler_name", "dpmpp_2m_sde"),
                    scheduler=data.get("scheduler", "karras"),
                    lora_name=data.get("lora_name"), lora_strength=data.get("lora_strength", 0.7),
                )
            elif model == "juggernaut":
                wf = wfl.build_juggernaut_workflow(
                    prompt=img_prompt, negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 5.0), seed=seed,
                    sampler_name=data.get("sampler_name", "dpmpp_2m_sde"),
                    scheduler=data.get("scheduler", "karras"),
                )
            else:
                wf = wfl.build_text2image_workflow(
                    prompt=img_prompt, negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps, cfg=data.get("cfg", 3.7), seed=seed,
                )

            _log(f"⏳ Phase 1: Generating image ({w}x{h}, {steps} steps, model={model})...")
            img_path = _comfy_queue_and_wait_image(wf)
            _log(f"✅ Phase 1 complete: {img_path}")

            # Save image as intermediate result
            with _jobs_lock:
                _jobs[job_id]["image_path"] = img_path
                _jobs[job_id]["log"] += f"Image ready: {img_path}\n"

            # ── Phase 2: Feed image into I2V ──
            video_prompt = data.get("video_prompt", img_prompt)
            video_model = data.get("video_model", "wan22")
            vid_steps = data.get("video_steps", 20)
            vid_frames = data.get("video_frames", 81)
            vid_fps = data.get("video_fps", 16)

            with open(img_path, "rb") as f:
                img_bytes = f.read()
            uploaded_name = _comfy_upload_image(img_bytes, f"t2v_{job_id[:8]}.png")
            _log(f"✅ Phase 2: Image uploaded as {uploaded_name}")

            if video_model == "ltx2":
                workflow = _build_ltx2_i2v_workflow(
                    image_filename=uploaded_name,
                    prompt=video_prompt,
                    neg_prompt=data.get("negative_prompt", ""),
                    width=w, height=h,
                    frames=vid_frames, steps=vid_steps,
                    fps=vid_fps, seed=seed,
                    lora_strength=data.get("lora_strength", 1.0),
                    image_strength=data.get("image_strength", 1.0),
                )
                output_prefix = "LTX-2-I2V"
            else:
                workflow = wfl.build_image2video_workflow(
                    image_filename=uploaded_name,
                    prompt=video_prompt,
                    negative_prompt=data.get("negative_prompt", "blurry, low quality, watermark"),
                    width=w, height=h,
                    frames=vid_frames, steps=vid_steps, seed=seed,
                )
                output_prefix = "wan_i2v"

            _log(f"⏳ Phase 2: Queuing I2V ({vid_frames} frames, {vid_steps} steps, model={video_model})...")
            file_info = _comfy_queue_and_wait(workflow, output_prefix=output_prefix, poll_interval=5)
            _log(f"✅ Phase 2 complete: {file_info['filename']}")

            job_dir = os.path.join(JOBS_DIR, job_id)
            os.makedirs(job_dir, exist_ok=True)
            vid_path = _comfy_download_file(file_info, job_dir)

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = vid_path
                _jobs[job_id]["result_type"] = "video"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done! Video: {os.path.getsize(vid_path) / 1048576:.1f} MB")

        elif action == "image2image":
            # Upload source image
            img_data = base64.b64decode(data["image"])
            img_filename = f"i2i_{job_id[:8]}.png"
            uploaded_name = _comfy_upload_image(img_data, img_filename)
            _log(f"✅ Source image uploaded as {uploaded_name}")

            model = data.get("model", "wan22")
            w = data.get("width", 1024)
            h = data.get("height", 1024)
            steps = data.get("steps", 20)
            seed = data.get("seed", -1)

            if model == "flux2_turbo":
                wf = wfl.build_flux2_turbo_i2i_workflow(
                    image_filename=uploaded_name, prompt=data.get("prompt", ""),
                    width=w, height=h, steps=steps, seed=seed,
                )
            else:  # wan22
                wf = wfl.build_image2image_workflow(
                    image_filename=uploaded_name, prompt=data.get("prompt", ""),
                    negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, steps=steps,
                    cfg=data.get("cfg", 3.5), denoise=data.get("denoise", 0.75),
                    seed=seed,
                )

            _log(f"⏳ Queuing I2I ({w}x{h}, {steps} steps, model={model})...")
            output = _comfy_queue_and_wait_image(wf)
            _log(f"✅ Image generated: {output}")

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = output
                _jobs[job_id]["result_type"] = "image"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done!")

        elif action == "text2video":
            model = data.get("model", "wan22")
            w = data.get("width", 832)
            h = data.get("height", 480)
            frames = data.get("frames", data.get("num_frames", 81))
            steps = data.get("steps", 4)
            seed = data.get("seed", -1)
            fps = data.get("fps", 24)

            if model == "ltx2":
                wf = wfl.build_ltx_2_t2v_workflow(
                    prompt=data.get("prompt", ""),
                    negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, frames=frames, steps=steps,
                    seed=seed, fps=fps,
                    lora_strength=data.get("lora_strength", 1.0),
                    camera_lora=data.get("camera_lora"),
                    audio_prompt=data.get("audio_prompt"),
                )
                output_prefix = "LTX-2"
            else:
                wf = wfl.build_text2video_workflow(
                    prompt=data.get("prompt", ""),
                    negative_prompt=data.get("negative_prompt", ""),
                    width=w, height=h, frames=frames, steps=steps,
                    seed=seed, lora_strength=data.get("lora_strength", 1.0),
                )
                output_prefix = "wan_t2v"

            _log(f"⏳ Queuing T2V ({w}x{h}, {frames}f, {steps} steps, model={model})...")
            file_info = _comfy_queue_and_wait(wf, output_prefix=output_prefix, poll_interval=5)
            _log(f"✅ Video generated: {file_info['filename']}")

            job_dir = os.path.join(JOBS_DIR, job_id)
            os.makedirs(job_dir, exist_ok=True)
            vid_path = _comfy_download_file(file_info, job_dir)

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = vid_path
                _jobs[job_id]["result_type"] = "video"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done! Video: {os.path.getsize(vid_path) / 1048576:.1f} MB")

        elif action == "upscale":
            img_data = base64.b64decode(data["image"])
            img_filename = f"upscale_{job_id[:8]}.png"
            uploaded_name = _comfy_upload_image(img_data, img_filename)
            _log(f"✅ Image uploaded as {uploaded_name}")

            scale = data.get("scale", 2)
            wf = wfl.build_upscale_workflow(image_filename=uploaded_name, scale=scale)

            _log(f"⏳ Queuing upscale ({scale}x)...")
            output = _comfy_queue_and_wait_image(wf)
            _log(f"✅ Upscaled: {output}")

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = output
                _jobs[job_id]["result_type"] = "image"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done!")

        elif action == "upscale_video":
            vid_data = base64.b64decode(data["video"])
            vid_filename = f"upscale_{job_id[:8]}.mp4"
            # Write video to ComfyUI input dir
            vid_path = os.path.join(COMFY_DIR, "input", vid_filename)
            with open(vid_path, "wb") as f:
                f.write(vid_data)
            _log(f"✅ Video uploaded as {vid_filename}")

            scale = data.get("scale", 2)
            fps = data.get("fps", 24)
            wf = wfl.build_video_upscale_workflow(video_filename=vid_filename, scale=scale, fps=fps)

            _log(f"⏳ Queuing video upscale ({scale}x)...")
            file_info = _comfy_queue_and_wait(wf, output_prefix="upscaled", poll_interval=5)
            _log(f"✅ Video upscaled: {file_info['filename']}")

            job_dir = os.path.join(JOBS_DIR, job_id)
            os.makedirs(job_dir, exist_ok=True)
            out_path = _comfy_download_file(file_info, job_dir)

            with _jobs_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["result_path"] = out_path
                _jobs[job_id]["result_type"] = "video"
                _jobs[job_id]["segments_completed"] = 1
            _log(f"✅ Done! Video: {os.path.getsize(out_path) / 1048576:.1f} MB")

        elif action == "custom_workflow":
            # Raw ComfyUI workflow JSON — queue directly
            workflow = data.get("workflow")
            if not workflow:
                raise ValueError("'workflow' field required (raw ComfyUI JSON)")
            expect_video = data.get("expect_video", False)

            if expect_video:
                _log("⏳ Queuing custom workflow (expecting video)...")
                file_info = _comfy_queue_and_wait(workflow, output_prefix="custom", poll_interval=5)
                _log(f"✅ Custom workflow complete: {file_info['filename']}")
                job_dir = os.path.join(JOBS_DIR, job_id)
                os.makedirs(job_dir, exist_ok=True)
                out_path = _comfy_download_file(file_info, job_dir)
                with _jobs_lock:
                    _jobs[job_id]["status"] = "completed"
                    _jobs[job_id]["result_path"] = out_path
                    _jobs[job_id]["result_type"] = "video"
                    _jobs[job_id]["segments_completed"] = 1
                _log(f"✅ Done! Video: {os.path.getsize(out_path) / 1048576:.1f} MB")
            else:
                _log("⏳ Queuing custom workflow (expecting image)...")
                output = _comfy_queue_and_wait_image(workflow)
                _log(f"✅ Custom workflow complete: {output}")
                with _jobs_lock:
                    _jobs[job_id]["status"] = "completed"
                    _jobs[job_id]["result_path"] = output
                    _jobs[job_id]["result_type"] = "image"
                    _jobs[job_id]["segments_completed"] = 1
                _log("✅ Done!")

        else:
            raise ValueError(f"Unknown action: {action}")

    except Exception as e:
        _log(f"❌ Failed: {e}")
        with _jobs_lock:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = str(e)
    finally:
        _fire_callback(job_id)
        _cleanup_old_jobs()


# ── Test Suite ───────────────────────────────────────────────────────────────

# Tiny 8x8 red PNG for tests that need an image input
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12P4z8BQDwAEgAF/"
    "QualfQAAAABJRU5ErkJggg=="
)

_test_lock = threading.Lock()
_test_state = {
    "running": False,
    "tests": {},         # test_name -> {status, time_s, error, log}
    "started_at": None,
    "finished_at": None,
}


def _make_test_png_b64():
    """Create a small 64x64 gradient PNG (base64) for tests."""
    import struct, zlib
    w, h = 64, 64
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            r = int(50 + 200 * x / w)
            g = int(30 + 180 * y / h)
            b_val = int(180)
            raw += struct.pack('BBB', r, g, b_val)

    def _png_chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + _png_chunk(b'IHDR', ihdr) + _png_chunk(b'IDAT', zlib.compress(raw)) + _png_chunk(b'IEND', b'')
    return base64.b64encode(png).decode()


def _test_health():
    """Test: ComfyUI health check."""
    health = _get_comfy_health()
    if health["status"] != "running":
        raise RuntimeError("ComfyUI not running")
    if health.get("vram_total_gb", 0) < 1:
        raise RuntimeError(f"GPU VRAM too low: {health}")
    return f"ComfyUI running, GPU: {health.get('gpu_name','?')}, VRAM: {health.get('vram_free_gb',0):.1f}GB free/{health.get('vram_total_gb',0):.1f}GB total"


def _test_text2image_flux2():
    """Test: Flux2 Turbo T2I (256x256, 1 step)."""
    wf = wfl.build_flux2_text2image_workflow(
        prompt="solid red square, simple test pattern",
        width=256, height=256, steps=1, seed=42, turbo=True,
    )
    output = _comfy_queue_and_wait_image(wf)
    return f"Image: {os.path.basename(output)}"


def _test_text2image_wan22():
    """Test: Wan 2.2 T2I (512x512, 4 steps)."""
    wf = wfl.build_text2image_workflow(
        prompt="solid blue circle on white background, simple",
        width=512, height=512, steps=4, seed=42,
    )
    output = _comfy_queue_and_wait_image(wf)
    return f"Image: {os.path.basename(output)}"


def _test_text2image_qwen():
    """Test: Qwen Image T2I (512x512, 4 steps)."""
    wf = wfl.build_qwen_image_workflow(
        prompt="red triangle on white background, simple geometric",
        width=512, height=512, steps=4, seed=42,
    )
    output = _comfy_queue_and_wait_image(wf)
    return f"Image: {os.path.basename(output)}"


def _test_image2image_flux2():
    """Test: Flux2 Turbo I2I (256x256, 1 step)."""
    test_png = base64.b64decode(_make_test_png_b64())
    uploaded = _comfy_upload_image(test_png, "test_i2i_flux2.png")
    wf = wfl.build_flux2_turbo_i2i_workflow(
        image_filename=uploaded,
        prompt="red and blue gradient, test pattern",
        width=256, height=256, steps=1, seed=42,
    )
    output = _comfy_queue_and_wait_image(wf)
    return f"Image: {os.path.basename(output)}"


def _test_image2image_wan22():
    """Test: Wan 2.2 I2I (512x512, 4 steps)."""
    test_png = base64.b64decode(_make_test_png_b64())
    uploaded = _comfy_upload_image(test_png, "test_i2i_wan22.png")
    wf = wfl.build_image2image_workflow(
        image_filename=uploaded,
        prompt="vibrant colorful abstract pattern",
        width=512, height=512, steps=4, seed=42,
    )
    output = _comfy_queue_and_wait_image(wf)
    return f"Image: {os.path.basename(output)}"


def _test_text2video_ltx2():
    """Test: LTX-2 T2V (256x256, 9 frames, 4 steps)."""
    wf = wfl.build_ltx_2_t2v_workflow(
        prompt="A red square gently pulsing on white background",
        width=256, height=256, frames=9, steps=4, seed=42, fps=8,
    )
    file_info = _comfy_queue_and_wait(wf, output_prefix="LTX", poll_interval=3)
    return f"Video: {file_info['filename']}"


def _test_text2video_wan22():
    """Test: Wan 2.2 T2V (512x320, 41 frames, 4 steps)."""
    wf = wfl.build_text2video_workflow(
        prompt="A gentle wave motion, ocean, calm",
        width=512, height=320, frames=41, steps=4, seed=42,
    )
    file_info = _comfy_queue_and_wait(wf, output_prefix="wan_t2v", poll_interval=5)
    return f"Video: {file_info['filename']}"


def _test_image2video_ltx2():
    """Test: LTX-2 I2V (256x256, 9 frames, 4 steps)."""
    test_png = base64.b64decode(_make_test_png_b64())
    uploaded = _comfy_upload_image(test_png, "test_i2v_ltx2.png")
    wf = wfl.build_ltx_2_i2v_workflow(
        image_filename=uploaded,
        prompt="The image gently comes to life with subtle motion",
        width=256, height=256, frames=9, steps=4, seed=42, fps=8,
    )
    file_info = _comfy_queue_and_wait(wf, output_prefix="LTX", poll_interval=3)
    return f"Video: {file_info['filename']}"


def _test_image2video_wan22():
    """Test: Wan 2.2 I2V (512x512, 41 frames, 4 steps)."""
    test_png = base64.b64decode(_make_test_png_b64())
    uploaded = _comfy_upload_image(test_png, "test_i2v_wan22.png")
    wf = wfl.build_image2video_workflow(
        image_filename=uploaded,
        prompt="gentle subtle motion, cinematic",
        width=512, height=512, frames=41, steps=4, seed=42,
    )
    file_info = _comfy_queue_and_wait(wf, output_prefix="wan_i2v", poll_interval=5)
    return f"Video: {file_info['filename']}"


# All available tests in execution order
_TEST_REGISTRY = [
    ("health",           "Health Check",              _test_health),
    ("t2i_flux2",        "T2I Flux2 Turbo",           _test_text2image_flux2),
    ("t2i_wan22",        "T2I Wan 2.2",               _test_text2image_wan22),
    ("t2i_qwen",         "T2I Qwen Image",            _test_text2image_qwen),
    ("i2i_flux2",        "I2I Flux2 Turbo",           _test_image2image_flux2),
    ("i2i_wan22",        "I2I Wan 2.2",               _test_image2image_wan22),
    ("t2v_ltx2",         "T2V LTX-2",                 _test_text2video_ltx2),
    ("t2v_wan22",        "T2V Wan 2.2",               _test_text2video_wan22),
    ("i2v_ltx2",         "I2V LTX-2",                 _test_image2video_ltx2),
    ("i2v_wan22",        "I2V Wan 2.2",               _test_image2video_wan22),
]


def _run_test_suite(test_names=None):
    """Run tests sequentially. If test_names is None, run all."""
    global _test_state
    tests_to_run = [(k, label, fn) for k, label, fn in _TEST_REGISTRY
                    if test_names is None or k in test_names]
    with _test_lock:
        _test_state = {
            "running": True,
            "tests": {k: {"label": label, "status": "pending", "time_s": 0, "error": None, "log": ""}
                      for k, label, _ in tests_to_run},
            "started_at": time.time(),
            "finished_at": None,
        }

    for key, label, fn in tests_to_run:
        with _test_lock:
            _test_state["tests"][key]["status"] = "running"
        t0 = time.time()
        try:
            msg = fn()
            dt = time.time() - t0
            with _test_lock:
                _test_state["tests"][key]["status"] = "passed"
                _test_state["tests"][key]["time_s"] = round(dt, 1)
                _test_state["tests"][key]["log"] = msg or ""
        except Exception as e:
            dt = time.time() - t0
            with _test_lock:
                _test_state["tests"][key]["status"] = "failed"
                _test_state["tests"][key]["time_s"] = round(dt, 1)
                _test_state["tests"][key]["error"] = str(e)
                _test_state["tests"][key]["log"] = str(e)

    with _test_lock:
        _test_state["running"] = False
        _test_state["finished_at"] = time.time()


# ── Auto I2V Prompt Generator ────────────────────────────────────────────────

_MOTION_PREFIXES = [
    "smooth cinematic camera movement,",
    "gentle natural motion, subtle camera push,",
    "dynamic dolly zoom,",
    "slow left-to-right pan,",
    "atmospheric floating camera,",
    "steady tracking shot,",
    "subtle breathing motion,",
    "sweeping aerial drift,",
    "elegant parallax movement,",
    "gently rocking natural motion,",
]


def _handle_image2video_auto(input_data):
    """Generate motion-ready prompts from an image's description.

    Since no dedicated captioning model is installed, uses the original
    prompt or base prompt as the caption, then creates ``count`` motion
    prompt variations by prepending cinematic motion descriptors.

    Returns the RunPod-compatible response format:
      { output: { prompts, caption, caption_seconds, prompt_seconds, elapsed_seconds } }
    """
    import random as _rng
    t0 = time.time()

    base_prompt = input_data.get("base_prompt", "")
    original_prompt = input_data.get("original_prompt", "")
    count = int(input_data.get("count", 1))

    # Use original prompt as the "caption" (best we can do without a captioning model)
    caption = original_prompt or base_prompt or "high quality image"
    t_caption = time.time() - t0

    # Build motion-ready prompts
    t1 = time.time()
    prompt_base = base_prompt or original_prompt or caption
    available_prefixes = list(_MOTION_PREFIXES)
    _rng.shuffle(available_prefixes)

    prompts = []
    for i in range(count):
        prefix = available_prefixes[i % len(available_prefixes)]
        prompts.append(f"{prefix} {prompt_base}")

    t_prompts = time.time() - t1
    elapsed = time.time() - t0

    print(f"[AutoI2V] Generated {len(prompts)} prompts from caption ({elapsed:.2f}s)")

    return {
        "output": {
            "output": {
                "prompts": prompts,
                "caption": caption,
                "caption_seconds": round(t_caption, 2),
                "prompt_seconds": round(t_prompts, 2),
                "elapsed_seconds": round(elapsed, 2),
            }
        }
    }


# ── HTTP Handler ─────────────────────────────────────────────────────────────
class AdminHandler(BaseHTTPRequestHandler):
    def _json(self, code, data):
        body = json.dumps(data).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _html(self, code, content):
        body = content.encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def do_OPTIONS(self):
        try:
            self.send_response(200)
            for k, v in [
                ("Access-Control-Allow-Origin", "*"),
                ("Access-Control-Allow-Methods", "GET,POST,OPTIONS"),
                ("Access-Control-Allow-Headers", "Content-Type,Authorization"),
            ]:
                self.send_header(k, v)
            self.end_headers()
        except BrokenPipeError:
            pass

    def do_GET(self):
        path = self.path.split("?")[0]
        params = {}
        if "?" in self.path:
            for pair in self.path.split("?")[1].split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    params[k] = v

        if path == "/":
            return self._html(200, _dashboard_html or "<h1>Admin — no index.html found</h1>")

        if path == "/openapi.json":
            return self._json(200, _OPENAPI_SPEC)

        if path == "/docs":
            html = f"""<!DOCTYPE html><html><head><title>Pod API Docs</title>
            <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
            </head><body><div id="ui"></div>
            <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
            <script>SwaggerUIBundle({{url:'/openapi.json',dom_id:'#ui'}})</script>
            </body></html>"""
            return self._html(200, html)

        if path == "/health":
            comfy = _get_comfy_health()
            disk = _get_disk_info()
            groups = _check_synced_groups()
            return self._json(200, {"comfy": comfy, "disk": disk, "synced_groups": groups, "admin_port": ADMIN_PORT, "comfy_port": COMFY_PORT})

        if path == "/models":
            return self._json(200, _list_models())

        if path == "/synced-groups":
            return self._json(200, _check_synced_groups())

        if path == "/logs":
            source = params.get("source", "comfy")
            lines = int(params.get("lines", "80"))
            log_path = COMFY_LOG if source == "comfy" else ADMIN_LOG
            return self._json(200, {"source": source, "lines": _tail_log(log_path, lines)})

        if path == "/sync-status":
            with _sync_lock:
                state = dict(_sync_state)
            return self._json(200, state)

        # GET /generate/status/{job_id}
        m = re.match(r"^/generate/status/([a-f0-9-]+)$", path)
        if m:
            jid = m.group(1)
            with _jobs_lock:
                job = _jobs.get(jid)
            if not job:
                return self._json(404, {"error": "Job not found"})
            resp = {k: v for k, v in job.items()
                    if k not in ("video_base64", "image_base64", "result_path")}
            result_type = job.get("result_type", "")
            has_result = bool(job.get("result_path") and os.path.exists(job.get("result_path", "")))
            # Backward compat: also check legacy in-memory fields
            resp["has_video"] = (result_type == "video" and has_result) or bool(job.get("video_base64"))
            resp["has_image"] = (result_type == "image" and has_result) or bool(job.get("image_base64"))
            return self._json(200, resp)

        # GET /generate/result/{job_id} — get the full result as base64
        m = re.match(r"^/generate/result/([a-f0-9-]+)$", path)
        if m:
            jid = m.group(1)
            with _jobs_lock:
                job = _jobs.get(jid)
            if not job:
                return self._json(404, {"error": "Job not found"})
            if job["status"] != "completed":
                return self._json(400, {"error": "Job not completed yet", "status": job["status"]})

            # Read from disk (new path) or fall back to in-memory (legacy)
            result_path = job.get("result_path")
            result_type = job.get("result_type", "video")
            video_b64 = None
            image_b64 = None

            if result_path and os.path.exists(result_path):
                with open(result_path, "rb") as f:
                    b64_data = base64.b64encode(f.read()).decode()
                if result_type == "video":
                    video_b64 = b64_data
                else:
                    image_b64 = b64_data
            else:
                video_b64 = job.get("video_base64")
                image_b64 = job.get("image_base64")

            return self._json(200, {
                "job_id": jid, "status": "completed",
                "video_base64": video_b64,
                "image_base64": image_b64,
            })

        # GET /test/status — current test suite state
        if path == "/test/status":
            with _test_lock:
                state = {
                    "running": _test_state["running"],
                    "tests": dict(_test_state["tests"]),
                    "started_at": _test_state["started_at"],
                    "finished_at": _test_state["finished_at"],
                }
            return self._json(200, state)

        # GET /test/list — available tests
        if path == "/test/list":
            tests = [{"key": k, "label": label} for k, label, _ in _TEST_REGISTRY]
            return self._json(200, {"tests": tests})

        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0]

        if path == "/restart":
            result = _restart_comfy()
            return self._json(200, result)

        # POST /test/run-all — run entire test suite
        if path == "/test/run-all":
            with _test_lock:
                if _test_state["running"]:
                    return self._json(409, {"error": "Tests already running"})
            threading.Thread(target=_run_test_suite, daemon=True).start()
            return self._json(200, {"status": "started", "tests": [k for k, _, _ in _TEST_REGISTRY]})

        # POST /test/run/{name} — run single test
        m = re.match(r"^/test/run/([a-z0-9_]+)$", path)
        if m:
            test_name = m.group(1)
            valid = [k for k, _, _ in _TEST_REGISTRY]
            if test_name not in valid:
                return self._json(400, {"error": f"Unknown test '{test_name}'. Available: {valid}"})
            with _test_lock:
                if _test_state["running"]:
                    return self._json(409, {"error": "Tests already running"})
            threading.Thread(target=_run_test_suite, args=([test_name],), daemon=True).start()
            return self._json(200, {"status": "started", "tests": [test_name]})

        if path == "/restart-admin":
            self._json(200, {"status": "restarting"})
            def _do_restart():
                time.sleep(1)
                os.execv(sys.executable, [sys.executable] + sys.argv)
            threading.Thread(target=_do_restart, daemon=True).start()
            return

        if path == "/run-command":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}
            command = body.get("command")
            if not command:
                return self._json(400, {"error": "command is required"})
            background = body.get("background", False)
            print(f"[Admin] run-command: {command} (bg={background})")

            if background:
                def _run_bg():
                    try:
                        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=600)
                        print(f"[Admin] bg-command done: rc={result.returncode}")
                    except Exception as e:
                        print(f"[Admin] bg-command error: {e}")
                threading.Thread(target=_run_bg, daemon=True).start()
                return self._json(200, {"status": "started", "background": True})
            else:
                try:
                    result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=120)
                    return self._json(200, {
                        "status": "done",
                        "exit_code": result.returncode,
                        "stdout": result.stdout[-5000:] if result.stdout else "",
                        "stderr": result.stderr[-2000:] if result.stderr else "",
                    })
                except subprocess.TimeoutExpired:
                    return self._json(504, {"error": "Command timed out (120s)"})
                except Exception as e:
                    return self._json(500, {"error": str(e)})

        if path == "/sync-models":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}
            groups = body.get("groups", [])
            verify = body.get("verify", False)
            with _sync_lock:
                if _sync_state["running"]:
                    return self._json(409, {"error": "Sync already running"})
            threading.Thread(target=_run_sync, args=(groups, verify), daemon=True).start()
            return self._json(200, {"status": "started", "groups": groups, "verify": verify})

        if path == "/generate/test":
            # Quick test generation — creates a tiny job to verify pipeline
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}
            preset = body.get("preset", "quick")  # quick, medium, full

            if preset == "medium":
                frames, steps = 49, 10
            elif preset == "full":
                frames, steps = 97, 20
            else:
                frames, steps = 25, 5

            # Create a small solid-color test image (640x640 blue gradient)
            import struct, zlib
            w, h = 640, 640
            raw = b''
            for y in range(h):
                raw += b'\x00'  # filter byte
                for x in range(w):
                    r = int(30 + 60 * x / w)
                    g = int(30 + 100 * y / h)
                    b_val = int(180 + 60 * (x + y) / (w + h))
                    raw += struct.pack('BBB', r, g, b_val)
            def _png_chunk(tag, data):
                c = tag + data
                return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
            ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
            png = b'\x89PNG\r\n\x1a\n' + _png_chunk(b'IHDR', ihdr) + _png_chunk(b'IDAT', zlib.compress(raw)) + _png_chunk(b'IEND', b'')
            test_image = base64.b64encode(png).decode()

            request_data = {
                "segments": [{
                    "image": test_image,
                    "prompt": "Beautiful cinematic scene, gentle camera movement, professional lighting, 4k quality",
                    "frames": frames,
                    "steps": steps,
                    "seed": 42,
                }],
                "width": 640,
                "height": 640,
                "fps": 24,
            }

            job_id = str(uuid.uuid4())
            with _jobs_lock:
                _jobs[job_id] = {
                    "job_id": job_id,
                    "status": "queued",
                    "segments_total": 1,
                    "segments_completed": 0,
                    "log": f"▸ Test job ({preset}): {frames} frames, {steps} steps\n",
                    "created_at": time.time(),
                }
            threading.Thread(target=_run_multi_segment, args=(job_id, request_data), daemon=True).start()
            return self._json(200, {"job_id": job_id, "status": "queued", "preset": preset, "frames": frames, "steps": steps})

        # ── Single generation endpoints ──────────────────────────
        def _read_post_body():
            cl = int(self.headers.get("Content-Length", 0))
            if cl == 0:
                return None
            try:
                return json.loads(self.rfile.read(cl))
            except json.JSONDecodeError:
                return None

        def _start_single_job(action, data):
            job_id = str(uuid.uuid4())
            callback_url = data.pop("callback_url", None)
            callback_secret = data.pop("callback_secret", None)
            with _jobs_lock:
                _jobs[job_id] = {
                    "job_id": job_id,
                    "status": "queued",
                    "current_segment": 0,
                    "segments_total": 1,
                    "segments_completed": 0,
                    "log": "",
                    "error": None,
                    "video_base64": None,
                    "image_base64": None,
                    "created_at": time.time(),
                    "callback_url": callback_url or "",
                    "callback_secret": callback_secret or "",
                }
            threading.Thread(target=_run_single_generation, args=(job_id, action, data), daemon=True).start()
            return job_id

        if path == "/generate/remix":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            prompt = data.get("prompt", "")
            if not prompt:
                return self._json(400, {"error": "'prompt' field required"})
            count = min(max(data.get("count", 1), 1), 10)
            temperature = data.get("temperature", 0.9)

            try:
                t0 = time.time()
                prompts = _remix_prompts(prompt, count=count, temperature=temperature)
                elapsed = round(time.time() - t0, 2)
                return self._json(200, {"prompts": prompts, "elapsed_seconds": elapsed})
            except Exception as e:
                print(f"[Remix] Error: {e}")
                return self._json(500, {"error": str(e)})

        if path == "/generate/image2video":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "image" not in data:
                return self._json(400, {"error": "'image' field required (base64)"})
            if "prompt" not in data:
                return self._json(400, {"error": "'prompt' field required"})
            job_id = _start_single_job("image2video", data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/text2image":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "prompt" not in data:
                return self._json(400, {"error": "'prompt' field required"})
            job_id = _start_single_job("text2image", data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/text2image-then-video":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "prompt" not in data:
                return self._json(400, {"error": "'prompt' field required"})
            job_id = _start_single_job("text2image_then_video", data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/image2image":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "image" not in data:
                return self._json(400, {"error": "'image' field required (base64)"})
            if "prompt" not in data:
                return self._json(400, {"error": "'prompt' field required"})
            job_id = _start_single_job("image2image", data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/custom":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "workflow" not in data:
                return self._json(400, {"error": "'workflow' field required (raw ComfyUI JSON)"})
            job_id = _start_single_job("custom_workflow", data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/text2video":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "prompt" not in data:
                return self._json(400, {"error": "'prompt' field required"})
            job_id = _start_single_job("text2video", data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/upscale":
            data = _read_post_body()
            if not data:
                return self._json(400, {"error": "Empty or invalid request body"})
            if "image" not in data and "video" not in data:
                return self._json(400, {"error": "'image' or 'video' field required (base64)"})
            action = "upscale_video" if "video" in data else "upscale"
            job_id = _start_single_job(action, data)
            return self._json(200, {"job_id": job_id, "status": "queued"})

        if path == "/generate/multi-segment":
            # Read request body
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                return self._json(400, {"error": "Empty request body"})
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                return self._json(400, {"error": "Invalid JSON"})

            if "segments" not in data or not data["segments"]:
                return self._json(400, {"error": "segments array required"})

            # Validate segments have prompts (image is optional — 'auto' generates via T2I)
            for i, seg in enumerate(data["segments"]):
                if "prompt" not in seg:
                    return self._json(400, {"error": f"Segment {i+1} missing 'prompt' field"})
                if "image" not in seg:
                    seg["image"] = "auto"

            callback_url = data.pop("callback_url", None)
            callback_secret = data.pop("callback_secret", None)

            job_id = str(uuid.uuid4())
            with _jobs_lock:
                _jobs[job_id] = {
                    "job_id": job_id,
                    "status": "queued",
                    "current_segment": 0,
                    "segments_total": len(data["segments"]),
                    "segments_completed": 0,
                    "log": "",
                    "error": None,
                    "video_base64": None,
                    "created_at": time.time(),
                    "callback_url": callback_url or "",
                    "callback_secret": callback_secret or "",
                }

            threading.Thread(target=_run_multi_segment, args=(job_id, data), daemon=True).start()
            return self._json(200, {"job_id": job_id, "status": "queued", "segments_total": len(data["segments"])})

        # ── Legacy /runsync endpoint (backward compat) ──────────
        if path == "/runsync":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                return self._json(400, {"error": "Empty request body"})
            try:
                body = json.loads(self.rfile.read(content_length))
            except json.JSONDecodeError:
                return self._json(400, {"error": "Invalid JSON"})

            input_data = body.get("input", body)
            action = input_data.get("action", "")

            if action == "image2video_auto":
                return self._json(200, _handle_image2video_auto(input_data))

            return self._json(400, {"error": f"Unknown runsync action: {action}"})

        self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(f"[Admin] {args[0]}")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    srv = ThreadedHTTPServer(("0.0.0.0", ADMIN_PORT), AdminHandler)
    srv.allow_reuse_address = True
    print(f"[Admin] GPU Pod Admin Server on :{ADMIN_PORT}")
    print(f"[Admin] ComfyUI expected on :{COMFY_PORT}")
    print(f"[Admin] Dashboard: http://localhost:{ADMIN_PORT}/")
    srv.serve_forever()
