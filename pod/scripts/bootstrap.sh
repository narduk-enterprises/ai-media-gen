#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# bootstrap.sh — Self-contained pod setup, triggered by dockerStartCmd.
#
# Expected env vars (injected by CF Worker at deploy time):
#   GITHUB_PAT   — GitHub PAT with repo read access
#   MODEL_GROUPS — Comma-separated model groups (e.g. juggernaut,pony,upscale)
#   REPO_URL     — GitHub repo URL (default: loganrenz/ai-media-gen)
#
# Idempotent. Re-run safe. Runs automatically on pod start.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

LOGDIR=/workspace/logs
REPO_DIR=/workspace/_repo
MODEL_GROUPS="${MODEL_GROUPS:-}"
REPO="${REPO_URL:-loganrenz/ai-media-gen}"
GITHUB_PAT="${GITHUB_PAT:-}"

mkdir -p "$LOGDIR"
exec > >(tee "$LOGDIR/setup.log") 2>&1

echo "═══ BOOTSTRAP START  $(date) ═══"
echo "  Model Groups: ${MODEL_GROUPS:-all}"
echo ""

run_logged() {
    local name="$1" logfile="$LOGDIR/${name}.log"; shift
    echo "[$name] Starting..." | tee "$logfile"
    ("$@") > >(tee -a "$logfile") 2>&1
    local rc=$?
    [ $rc -eq 0 ] && echo "[$name] ✅ Complete" | tee -a "$logfile" || echo "[$name] ⚠️  Exited with code $rc" | tee -a "$logfile"
    return $rc
}

# ══ STEP 1: Clone/update repo ══
echo "▸ [1/5] Syncing repo..."
if [ -z "$GITHUB_PAT" ]; then
    echo "  ⚠️  GITHUB_PAT not set — trying public clone"
    CLONE_URL="https://github.com/${REPO}.git"
else
    CLONE_URL="https://${GITHUB_PAT}@github.com/${REPO}.git"
fi

if [ -d "$REPO_DIR/.git" ]; then
    echo "  Repo exists, pulling latest..."
    cd "$REPO_DIR" && git pull --ff-only 2>/dev/null || true
else
    echo "  Cloning..."
    git clone --depth 1 "$CLONE_URL" "$REPO_DIR"
fi

# Copy files to workspace
echo "  Copying admin server + scripts..."
mkdir -p /workspace/admin/workflows
cp "$REPO_DIR/pod/admin/server.py"          /workspace/admin/server.py
cp "$REPO_DIR/pod/admin/index.html"         /workspace/admin/index.html
cp "$REPO_DIR/pod/admin/workflow_loader.py" /workspace/admin/workflow_loader.py
cp "$REPO_DIR/pod/admin/workflows/"*        /workspace/admin/workflows/
cp "$REPO_DIR/pod/scripts/manage-pod.sh"    /workspace/manage.sh
cp "$REPO_DIR/pod/scripts/sync_models.py"   /workspace/sync_models.py
cp "$REPO_DIR/pod/requirements.txt"         /workspace/requirements.txt 2>/dev/null || true
chmod +x /workspace/manage.sh
echo "  ✅ Files synced"
echo ""

# Install post_start.sh for auto-restart
printf "#!/bin/bash\n[ -f /workspace/manage.sh ] && bash /workspace/manage.sh start\n" > /post_start.sh
chmod +x /post_start.sh

# Write profile
echo "$MODEL_GROUPS" > /workspace/.model_groups

# ══ STEP 2: Model sync in BACKGROUND ══
echo "▸ [2/5] Starting model sync in background..."
if [ -d "/workspace/.cache/huggingface/hub" ]; then
    rm -rf /workspace/.cache/huggingface/hub/*/blobs /workspace/.cache/huggingface/hub/.locks
fi
(
    pip install -q huggingface-hub requests hf_transfer 2>&1 | tail -1 || true
    SYNC_ARGS=""
    [ -n "$MODEL_GROUPS" ] && SYNC_ARGS="--groups $MODEL_GROUPS"
    python3 -u /workspace/sync_models.py $SYNC_ARGS > >(tee -a "$LOGDIR/sync_models.log") 2>&1
) &
SYNC_PID=$!
echo "  Model sync running (PID $SYNC_PID)"
echo ""

# ══ STEP 3: System deps ══
echo "▸ [3/5] Installing system deps..."
(
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq git wget ffmpeg >/dev/null 2>&1 || true
    pip install -q -r /workspace/requirements.txt 2>&1 | tail -1 || true

    GPU_ARCH=$(python3 -c "import torch; cc=torch.cuda.get_device_capability(0); print(f'{cc[0]}{cc[1]}')" 2>/dev/null || echo "0")
    TORCH_ARCHS=$(python3 -c "import torch; print(torch.cuda.get_arch_list())" 2>/dev/null || echo "[]")
    if [ "$GPU_ARCH" -ge "120" ] && ! echo "$TORCH_ARCHS" | grep -q "sm_${GPU_ARCH}"; then
        echo "  ⚠️  GPU is sm_${GPU_ARCH} (Blackwell) — upgrading PyTorch..."
        pip uninstall -y torch torchvision torchaudio 2>&1 | tail -1 || true
        pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128 2>&1 | tail -3 || true
    fi
    echo "  ✅ system deps installed"
) > >(tee -a "$LOGDIR/deps.log") 2>&1
echo ""

# ══ STEP 4: ComfyUI + Custom nodes ══
echo "▸ [4/5] Installing ComfyUI + custom nodes..."
(
    if [ ! -f /workspace/ComfyUI/main.py ]; then
        git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI
    fi
    cd /workspace/ComfyUI && pip install -q -r requirements.txt 2>&1 | tail -3 || true
    ln -sf /workspace/ComfyUI /comfyui
    mkdir -p /comfyui/output /comfyui/input

    # Patch ComfyUI for z_image support
    if ! grep -q 'z_image' /workspace/ComfyUI/nodes.py 2>/dev/null; then
        sed -i 's/"ovis"]/"ovis", "z_image"]/' /workspace/ComfyUI/nodes.py
        echo "  ✅ Patched CLIPLoader for z_image"
    fi
    if ! grep -q 'Z_IMAGE' /workspace/ComfyUI/comfy/sd.py 2>/dev/null; then
        sed -i 's/    FLUX2 = 25/    FLUX2 = 25\n    Z_IMAGE = 26/' /workspace/ComfyUI/comfy/sd.py
        echo "  ✅ Patched CLIPType for Z_IMAGE"
    fi

    echo "  ✅ ComfyUI installed"
) > >(tee -a "$LOGDIR/comfyui.log") 2>&1

(
    NODES=/workspace/ComfyUI/custom_nodes
    mkdir -p "$NODES"
    for pair in \
      "https://github.com/Fannovel16/ComfyUI-Video-Matting.git ComfyUI-Video-Matting" \
      "https://github.com/ltdrdata/ComfyUI-Manager.git ComfyUI-Manager" \
      "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git ComfyUI-VideoHelperSuite"
    do
        url="${pair%% *}"
        name="${pair##* }"
        if [ ! -d "$NODES/$name" ]; then
            git clone --depth 1 "$url" "$NODES/$name"
            [ -f "$NODES/$name/requirements.txt" ] && pip install -q -r "$NODES/$name/requirements.txt" 2>&1 | tail -1 || true
        fi
        echo "  ✅ $name"
    done
) > >(tee -a "$LOGDIR/nodes.log") 2>&1
echo ""

# ══ STEP 5: Symlink model dirs + start services (DON'T wait for models) ══
# Use directory-level symlinks so ComfyUI sees models as they download.
# Services start immediately — models appear as sync progresses.

echo "▸ [5/5] Starting services (models syncing in background)..."
MODELS=/workspace/models
if [ -d "$MODELS" ] || mkdir -p "$MODELS"; then
    shopt -s nullglob
    # Create model subdirs in workspace if they don't exist
    for sub in diffusion_models checkpoints clip clip_vision vae loras upscale_models text_encoders; do
        mkdir -p "$MODELS/$sub"
    done

    # Symlink workspace model dirs into ComfyUI
    mkdir -p /comfyui/models/text_encoders
    for f in "$MODELS/clip/"*.safetensors; do
        ln -sf "$f" "/comfyui/models/text_encoders/$(basename "$f")" || true
    done
    for sub in diffusion_models checkpoints clip clip_vision vae loras upscale_models latent_upscale_models text_encoders; do
        mkdir -p "/comfyui/models/$sub"
        src_sub="$sub"
        [ "$sub" = "latent_upscale_models" ] && src_sub="upscale_models"
        for f in "$MODELS/$src_sub/"*.safetensors "$MODELS/$src_sub/"*.pth; do
            [ -f "$f" ] && ln -sf "$f" "/comfyui/models/$sub/$(basename "$f")" || true
        done
    done

    # Also create ComfyUI extra_model_paths so it auto-discovers new files
    cat > /comfyui/extra_model_paths.yaml << 'YAML'
workspace:
    base_path: /workspace/models
    checkpoints: checkpoints
    clip: clip
    clip_vision: clip_vision
    diffusion_models: diffusion_models
    loras: loras
    upscale_models: upscale_models
    text_encoders: text_encoders
    vae: vae
YAML
    echo "  ✅ Model paths configured"
    shopt -u nullglob
fi

echo ""
echo "▸ Starting services..."
(bash /workspace/manage.sh start) > >(tee -a "$LOGDIR/services.log") 2>&1

# Wait for model sync to finish (non-blocking — services already running)
echo ""
echo "▸ Waiting for background model sync to complete..."
wait $SYNC_PID
SYNC_RC=$?
[ $SYNC_RC -eq 0 ] && echo "  ✅ All models synced" || echo "  ⚠️  sync_models exited with code $SYNC_RC"

# Re-symlink any new models that appeared after initial symlink
if [ -d "$MODELS" ]; then
    shopt -s nullglob
    for f in "$MODELS/clip/"*.safetensors; do
        ln -sf "$f" "/comfyui/models/text_encoders/$(basename "$f")" 2>/dev/null || true
    done
    for sub in diffusion_models checkpoints clip clip_vision vae loras upscale_models text_encoders; do
        src_sub="$sub"
        [ "$sub" = "latent_upscale_models" ] && src_sub="upscale_models"
        for f in "$MODELS/$src_sub/"*.safetensors "$MODELS/$src_sub/"*.pth; do
            [ -f "$f" ] && ln -sf "$f" "/comfyui/models/$sub/$(basename "$f")" 2>/dev/null || true
        done
    done
    shopt -u nullglob
    echo "  ✅ Models re-symlinked"
fi

echo ""
echo "═══ BOOTSTRAP DONE  $(date) ═══"
for f in "$LOGDIR"/*.log; do
    size=$(du -sh "$f" 2>/dev/null | cut -f1)
    echo "  $size  $f"
done

