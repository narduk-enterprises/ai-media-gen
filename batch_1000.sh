#!/bin/bash
#
# Batch generate 1000 images using cyberrealistic_pony model
# with auto-generated prompts from the prompt builder endpoint.
#
BASE="https://ai-media-gen.narduk.workers.dev"
SESSION="session=1b9b689f-2179-475b-baf6-0e8746eab371"
MODEL="cyberrealistic_pony"
BATCH_SIZE=16
TOTAL=1000
BATCHES=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))  # 63 batches

echo "🚀 Starting batch generation: $TOTAL images, $BATCHES batches of $BATCH_SIZE"
echo "   Model: $MODEL"
echo ""

SUCCESS=0
FAIL=0
QUEUED=0

for i in $(seq 1 $BATCHES); do
  # Calculate how many images this batch
  REMAINING=$(( TOTAL - QUEUED ))
  if [ $REMAINING -le 0 ]; then
    break
  fi
  COUNT=$BATCH_SIZE
  if [ $REMAINING -lt $BATCH_SIZE ]; then
    COUNT=$REMAINING
  fi

  echo "[$i/$BATCHES] Generating prompt (modelHint=pony)..."

  # Step 1: Generate a prompt using the prompt builder
  PROMPT_RESPONSE=$(curl -s -X POST "$BASE/api/prompt-builder/generate" \
    -H "Content-Type: application/json" \
    -H "Cookie: $SESSION" \
    -H "x-requested-with: XMLHttpRequest" \
    -d "{\"mediaType\":\"image\",\"modelHint\":\"pony\"}")

  # Extract the refined prompt (fall back to raw if refined is empty)
  REFINED=$(echo "$PROMPT_RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    p = d.get('refinedPrompt') or d.get('rawPrompt') or ''
    print(p)
except:
    print('')
" 2>/dev/null)

  if [ -z "$REFINED" ]; then
    echo "  ⚠️  Failed to generate prompt, skipping batch $i"
    echo "  Response: $PROMPT_RESPONSE"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Truncate prompt display for readability
  DISPLAY_PROMPT="${REFINED:0:80}..."
  echo "  📝 Prompt: $DISPLAY_PROMPT"

  # Step 2: Submit image generation batch
  # Escape the prompt for JSON
  ESCAPED_PROMPT=$(echo "$REFINED" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")

  IMAGE_RESPONSE=$(curl -s -X POST "$BASE/api/generate/image" \
    -H "Content-Type: application/json" \
    -H "Cookie: $SESSION" \
    -H "x-requested-with: XMLHttpRequest" \
    -d "{
      \"prompt\": $ESCAPED_PROMPT,
      \"model\": \"$MODEL\",
      \"count\": $COUNT,
      \"steps\": 20,
      \"width\": 1024,
      \"height\": 1024,
      \"seed\": -1,
      \"anyMachine\": true
    }")

  # Check if generation was accepted
  GEN_ID=$(echo "$IMAGE_RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('generation',{}).get('id',''))
except:
    print('')
" 2>/dev/null)

  if [ -n "$GEN_ID" ]; then
    QUEUED=$((QUEUED + COUNT))
    SUCCESS=$((SUCCESS + 1))
    echo "  ✅ Queued $COUNT images (gen: ${GEN_ID:0:8}...) | Total queued: $QUEUED"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ Failed to queue batch"
    echo "  Response: ${IMAGE_RESPONSE:0:200}"
  fi

  # Small delay to avoid overwhelming the server
  sleep 0.5
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Batch Generation Complete"
echo "   Total queued: $QUEUED images"
echo "   Successful batches: $SUCCESS"
echo "   Failed batches: $FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
