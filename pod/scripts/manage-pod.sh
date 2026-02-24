#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Pod Manager — start/stop/restart ComfyUI + Admin Server
# Lives at /workspace/manage.sh on the pod
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

COMFY_DIR="/comfyui"
ADMIN_DIR="/workspace/admin"
COMFY_LOG="/workspace/comfyui.log"
ADMIN_LOG="/workspace/admin.log"
COMFY_PORT=${COMFY_PORT:-8189}
ADMIN_PORT=${ADMIN_PORT:-8188}

# ── Helpers ──────────────────────────────────────────────────

_comfy_pid() { pgrep -f "python3 main.py.*--port $COMFY_PORT" 2>/dev/null | head -1 || true; }
_admin_pid() { pgrep -f "python3.*server\.py" 2>/dev/null | head -1 || true; }

_kill_proc() {
  local pid=$1 name=$2
  if [ -n "$pid" ]; then
    echo "  Killing $name (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || { echo "  $name stopped"; return 0; }
      sleep 0.5
    done
    echo "  Force-killing $name..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
}

_clean_zombies() {
  local zombies
  zombies=$(ps aux 2>/dev/null | grep '\[.*defunct\]' | grep -v grep | awk '{print $2}' || true)
  if [ -n "$zombies" ]; then
    echo "  Cleaning zombie processes..."
    echo "$zombies" | xargs -r kill -9 2>/dev/null || true
  fi
}

_wait_comfy() {
  echo "  Waiting for ComfyUI on :$COMFY_PORT..."
  for i in $(seq 1 90); do
    if curl -s --max-time 2 "http://127.0.0.1:$COMFY_PORT/system_stats" >/dev/null 2>&1; then
      echo "  ✅ ComfyUI ready (${i}s)"
      return 0
    fi
    sleep 2
  done
  echo "  ❌ ComfyUI failed to start after 180s"
  return 1
}

_wait_admin() {
  echo "  Waiting for Admin on :$ADMIN_PORT..."
  for i in $(seq 1 10); do
    local resp
    resp=$(curl -s --max-time 2 "http://127.0.0.1:$ADMIN_PORT/health" 2>/dev/null || true)
    if [ -n "$resp" ]; then
      echo "  ✅ Admin ready"
      return 0
    fi
    sleep 1
  done
  echo "  ⏳ Admin still starting"
  return 0
}

# ── Commands ─────────────────────────────────────────────────

cmd_start() {
  echo "═══ Starting services ═══"

  ln -sf /workspace/ComfyUI /comfyui 2>/dev/null || true

  # Start ComfyUI
  local cpid=$(_comfy_pid)
  if [ -n "$cpid" ]; then
    echo "  ComfyUI already running (PID $cpid)"
  else
    echo "  Starting ComfyUI on :$COMFY_PORT..."
    cd "$COMFY_DIR"
    nohup python3 main.py \
      --listen 0.0.0.0 \
      --port "$COMFY_PORT" \
      --disable-auto-launch \
      --gpu-only \
      > "$COMFY_LOG" 2>&1 &
    echo "  ComfyUI started (PID $!)"
    _wait_comfy
  fi

  # Start Admin server
  local apid=$(_admin_pid)
  if [ -n "$apid" ]; then
    echo "  Admin already running (PID $apid)"
  else
    echo "  Starting Admin on :$ADMIN_PORT..."
    cd "$ADMIN_DIR"
    COMFY_PORT=$COMFY_PORT ADMIN_PORT=$ADMIN_PORT \
      nohup python3 -u server.py > "$ADMIN_LOG" 2>&1 &
    echo "  Admin started (PID $!)"
    _wait_admin
  fi

  echo "═══ All services started ═══"
}

cmd_stop() {
  echo "═══ Stopping services ═══"
  _kill_proc "$(_admin_pid)" "Admin"
  _kill_proc "$(_comfy_pid)" "ComfyUI"
  _clean_zombies
  echo "═══ All services stopped ═══"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_restart_comfy() {
  echo "═══ Restarting ComfyUI only ═══"
  _kill_proc "$(_comfy_pid)" "ComfyUI"
  _clean_zombies
  cd "$COMFY_DIR"
  nohup python3 main.py \
    --listen 0.0.0.0 \
    --port "$COMFY_PORT" \
    --disable-auto-launch \
    --gpu-only \
    > "$COMFY_LOG" 2>&1 &
  echo "  ComfyUI started (PID $!)"
  _wait_comfy
  echo "═══ ComfyUI restarted ═══"
}

cmd_status() {
  echo "═══ Service Status ═══"
  local cpid=$(_comfy_pid)
  local apid=$(_admin_pid)

  if [ -n "$cpid" ]; then
    echo "  ComfyUI: ✅ running (PID $cpid) on :$COMFY_PORT"
    local stats
    stats=$(curl -s --max-time 2 "http://127.0.0.1:$COMFY_PORT/system_stats" 2>/dev/null || echo "")
    if [ -n "$stats" ]; then
      echo "           $(echo "$stats" | python3 -c 'import sys,json; d=json.load(sys.stdin); g=d["devices"][0]; print(f"VRAM: {g[\"vram_free\"]//1073741824}GB free / {g[\"vram_total\"]//1073741824}GB total")' 2>/dev/null || true)"
    fi
  else
    echo "  ComfyUI: ❌ stopped"
  fi

  if [ -n "$apid" ]; then
    echo "  Admin:   ✅ running (PID $apid) on :$ADMIN_PORT"
  else
    echo "  Admin:   ❌ stopped"
  fi

  local zcount
  zcount=$(ps aux 2>/dev/null | grep '\[.*defunct\]' | grep -cv grep 2>/dev/null || echo "0")
  if [ "$zcount" -gt 0 ] 2>/dev/null; then
    echo "  ⚠️  $zcount zombie process(es)"
  fi
}

cmd_logs() {
  local target="${1:-comfy}"
  case "$target" in
    comfy*)  tail -f "$COMFY_LOG" ;;
    admin*)  tail -f "$ADMIN_LOG" ;;
    *)       echo "Usage: manage.sh logs [comfy|admin]" ;;
  esac
}

# ── Dispatch ─────────────────────────────────────────────────

case "${1:-help}" in
  start)          cmd_start ;;
  stop)           cmd_stop ;;
  restart)        cmd_restart ;;
  restart-comfy)  cmd_restart_comfy ;;
  status)         cmd_status ;;
  logs)           cmd_logs "${2:-comfy}" ;;
  *)
    echo "Usage: manage.sh {start|stop|restart|restart-comfy|status|logs [comfy|admin]}"
    echo ""
    echo "  start         — Start ComfyUI + Admin server"
    echo "  stop          — Stop everything"
    echo "  restart       — Full restart"
    echo "  restart-comfy — Restart ComfyUI only"
    echo "  status        — Show running services"
    echo "  logs          — Tail logs (comfy or admin)"
    ;;
esac
