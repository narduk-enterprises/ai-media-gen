#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# setup-machine.sh — Bootstrap a fresh GPU pod
#
# Usage:
#   bash scripts/setup-machine.sh <ip> <port> [--profile image|video|full]
#
# Architecture:
#   1. SCPs admin server, manage.sh, sync_models.py, workflows
#   2. Installs /post_start.sh (auto-start on reboot)
#   3. Launches on-pod setup (ComfyUI + custom nodes + models + services)
#
# On-pod setup runs these IN PARALLEL:
#   - sync_models.py (background — slowest, starts first)
#   - System deps + ComfyUI + custom nodes (foreground)
#   Then waits for sync_models, symlinks models, starts services.
#
# Logs:
#   /workspace/logs/setup.log       — collector
#   /workspace/logs/deps.log        — system deps + PyTorch
#   /workspace/logs/comfyui.log     — ComfyUI install
#   /workspace/logs/nodes.log       — custom nodes install
#   /workspace/logs/sync_models.log — model downloads
#   /workspace/logs/services.log    — service startup
#
# Idempotent. Re-run safe.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

IP="${1:?Usage: $0 <ip> <port> [--profile image|video|full]}"
PORT="${2:?Usage: $0 <ip> <port> [--profile image|video|full]}"
PROFILE="full"  # default
shift 2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done
KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
SSH="ssh $SSH_OPTS root@$IP -p $PORT -i $KEY"
SCP="scp $SSH_OPTS -P $PORT -i $KEY"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══ setup-machine.sh ═══  $IP:$PORT  profile=$PROFILE"

# ─────────────────────────────────────────────────────────────
# PHASE 1 — Upload
# ─────────────────────────────────────────────────────────────
echo ""
echo "▸ Uploading admin server + scripts..."
$SSH "mkdir -p /workspace/admin/workflows /workspace/logs"
$SCP "$DIR/admin/server.py"           "root@$IP:/workspace/admin/server.py"
$SCP "$DIR/admin/index.html"          "root@$IP:/workspace/admin/index.html"
$SCP "$DIR/admin/workflow_loader.py"  "root@$IP:/workspace/admin/workflow_loader.py"
$SCP "$DIR/admin/workflows/"*         "root@$IP:/workspace/admin/workflows/"
$SCP "$DIR/scripts/manage-pod.sh"     "root@$IP:/workspace/manage.sh"
$SCP "$DIR/scripts/sync_models.py"    "root@$IP:/workspace/sync_models.py"
$SSH "chmod +x /workspace/manage.sh"
echo "  ✅ uploaded"

# ─────────────────────────────────────────────────────────────
# PHASE 2 — Install /post_start.sh
# ─────────────────────────────────────────────────────────────
echo ""
echo "▸ Installing auto-start (/post_start.sh)..."
$SSH 'printf "#!/bin/bash\n[ -f /workspace/manage.sh ] && bash /workspace/manage.sh start\n" > /post_start.sh && chmod +x /post_start.sh'
echo "  ✅ pods will auto-start on reboot"

# ─────────────────────────────────────────────────────────────
# PHASE 3 — Write on-pod setup script, launch with nohup
# ─────────────────────────────────────────────────────────────
echo ""
echo "▸ Writing on-pod setup script..."
$SSH "echo '$PROFILE' > /workspace/.pod_profile"

cat > /tmp/_pod_setup.sh << 'PODSCRIPT'
#!/bin/bash
set -euo pipefail

LOGDIR=/workspace/logs
mkdir -p "$LOGDIR"
exec > >(tee "$LOGDIR/setup.log") 2>&1

echo "═══ ON-POD SETUP START  $(date) ═══"
echo ""

run_logged() {
    local name="$1" logfile="$LOGDIR/${name}.log"; shift
    echo "[$name] Starting..." | tee "$logfile"
    ("$@") > >(tee -a "$logfile") 2>&1
    local rc=$?
    [ $rc -eq 0 ] && echo "[$name] ✅ Complete" | tee -a "$logfile" || echo "[$name] ⚠️  Exited with code $rc" | tee -a "$logfile"
    return $rc
}

# ══ STEP 1: Model sync in BACKGROUND ══
# Read pod profile written by setup-machine.sh
POD_PROFILE="$(cat /workspace/.pod_profile 2>/dev/null || echo full)"
echo "  Pod profile: $POD_PROFILE"

echo "▸ [1/4] Starting model sync in background..."
if [ -d "/workspace/.cache/huggingface/hub" ]; then
    rm -rf /workspace/.cache/huggingface/hub/*/blobs /workspace/.cache/huggingface/hub/.locks
fi
(
    python3 -u /workspace/sync_models.py --profile "$POD_PROFILE" > >(tee -a "$LOGDIR/sync_models.log") 2>&1
) &
SYNC_PID=$!
echo "  Model sync running (PID $SYNC_PID)"
echo ""

# ══ STEP 2: System deps ══
echo "▸ [2/4] Installing system deps..."
(
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq git wget ffmpeg >/dev/null 2>&1 || true
    pip install -q sqlalchemy -r /workspace/requirements.txt 2>&1 | tail -1 || true

    GPU_ARCH=$(python3 -c "import torch; cc=torch.cuda.get_device_capability(0); print(f'{cc[0]}{cc[1]}')" 2>/dev/null || echo "0")
    TORCH_ARCHS=$(python3 -c "import torch; print(torch.cuda.get_arch_list())" 2>/dev/null || echo "[]")
    if [ "$GPU_ARCH" -ge "120" ] && ! echo "$TORCH_ARCHS" | grep -q "sm_${GPU_ARCH}"; then
        echo "  ⚠️  GPU is sm_${GPU_ARCH} (Blackwell) — upgrading PyTorch..."
        pip uninstall -y torch torchvision torchaudio 2>&1 | tail -1 || true
        pip install --no-cache-dir --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128 2>&1 | tail -3 || true
    fi
    echo "  ✅ system deps installed"
) > >(tee -a "$LOGDIR/deps.log") 2>&1
echo ""

# ══ STEP 3: ComfyUI + Custom nodes ══
echo "▸ [3/4] Installing ComfyUI + custom nodes..."
(
    if [ ! -f /workspace/ComfyUI/main.py ]; then
        git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI
    fi
    cd /workspace/ComfyUI && pip install -q -r requirements.txt 2>&1 | tail -3 || true
    ln -sf /workspace/ComfyUI /comfyui
    mkdir -p /comfyui/output /comfyui/input

    # Patch ComfyUI for z_image support (upstream hasn't added it to the node UI yet)
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

# ══ STEP 4: Wait for models, symlink, start services ══
echo "▸ [4/4] Waiting for model sync..."
wait $SYNC_PID
SYNC_RC=$?
[ $SYNC_RC -eq 0 ] && echo "  ✅ All models synced" || echo "  ⚠️  sync_models exited with code $SYNC_RC"

MODELS=/workspace/models
if [ -d "$MODELS" ]; then
    shopt -s nullglob
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
    shopt -u nullglob
    echo "  ✅ models symlinked"
fi

echo ""
echo "▸ Starting services..."
(bash /workspace/manage.sh start) > >(tee -a "$LOGDIR/services.log") 2>&1

echo ""
echo "═══ ON-POD SETUP DONE  $(date) ═══"
for f in "$LOGDIR"/*.log; do
    size=$(du -sh "$f" 2>/dev/null | cut -f1)
    echo "  $size  $f"
done
PODSCRIPT

$SCP /tmp/_pod_setup.sh "root@$IP:/workspace/run-setup.sh"
$SSH "chmod +x /workspace/run-setup.sh"
rm -f /tmp/_pod_setup.sh
echo "  ✅ on-pod script ready"

# ─────────────────────────────────────────────────────────────
# PHASE 4 — Launch and tail
# ─────────────────────────────────────────────────────────────
echo ""
echo "▸ Launching setup on pod (nohup — survives SSH disconnect)..."
$SSH 'nohup bash /workspace/run-setup.sh </dev/null >/dev/null 2>&1 & echo "PID=$!"'
sleep 2

echo ""
echo "▸ Tailing /workspace/logs/setup.log  (Ctrl-C to detach — setup keeps running)"
echo "  Re-attach anytime: $SSH 'tail -f /workspace/logs/setup.log'"
echo "  Watch models:      $SSH 'tail -f /workspace/logs/sync_models.log'"
echo ""
$SSH 'tail -f /workspace/logs/setup.log' || true

echo ""
echo "═══ Detached. Setup continues on pod. ═══"
echo "  Check:     $SSH 'tail -20 /workspace/logs/setup.log'"
echo "  Models:    $SSH 'tail -20 /workspace/logs/sync_models.log'"
echo "  Status:    $SSH '/workspace/manage.sh status'"
echo "  Admin UI:  http://$IP:8080"
