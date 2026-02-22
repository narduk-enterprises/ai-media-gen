---
description: Systematically audit the codebase for logic errors, race conditions, stale comments, and incorrect defaults
---

# Logic Error Audit Workflow

Run this workflow to find and fix logic bugs that are easy to miss in code review.

// turbo-all

## Phase 1: Server-Side Critical Path

Audit each file in the job processing pipeline for logic errors:

1. `server/utils/queueProcessor.ts` — Check for:
   - Stale threshold values matching comments
   - Retry logic edge cases (what happens at exactly MAX_RETRIES?)
   - Race conditions between submit/poll/cleanup phases
   - Generation status not updated after failures

2. `server/api/generate/my-queue.get.ts` — Check for:
   - Inline poll racing with cron poll (double completion/upload)
   - In-memory item mutations not matching DB state
   - Missing error handling in Promise.allSettled callbacks

3. `server/utils/backgroundComplete.ts` — Check for:
   - Timeout handling (does it leave items in limbo?)
   - Generation status update after timeout
   - Race with cron completing the same items

4. `server/utils/ai.ts` — Check for:
   - Fallback logic correctness (what if slim URL isn't set?)
   - Poll loop termination conditions
   - 404 handling vs actual failures

## Phase 2: API Route Consistency

5. Check all POST endpoints in `server/api/generate/` for:
   - Metadata preservation (does `runpodInput` survive the success path?)
   - Correct Zod validation ranges
   - Default values matching what the frontend sends
   - Missing error responses (silent failures)

6. `server/api/generate/retry.post.ts` — Check:
   - Does it verify `runpodInput` exists in metadata?
   - Does it reset the right fields?
   - Does it update generation status back to processing?

## Phase 3: Client-Side Composables

7. Check composable defaults match server defaults:
   - `useGeneration.ts` — model, width, height, numFrames, steps defaults
   - `useVideoDefaults.ts` — preset arrays match what the server expects
   - `useCreateShared.ts` — model parameter configs

8. Check for stale model references:
   - Are old model names still hardcoded anywhere?
   - Do default resolutions match the active model (LTX2)?

## Phase 4: Race Conditions & Data Integrity

9. Search for concurrent write patterns:

   ```bash
   grep -rn 'db.update(mediaItems)' server/ --include='*.ts' | grep -v 'node_modules'
   ```

   - Identify all places that write to the same item
   - Check if any can race (cron + inline + background)
   - Add guards where needed (re-check status before write)

10. Search for unsafe metadata parsing:
    ```bash
    grep -rn 'JSON.parse' server/ --include='*.ts'
    ```

    - Every parse should be in a try/catch
    - Check what happens if metadata is null/undefined

## Phase 5: Fix and Verify

11. Fix each bug found, documenting:
    - What the bug was
    - What the impact was (data corruption, silent failure, etc.)
    - What the fix is

12. Build and deploy:
    ```bash
    npx nuxt build && npx wrangler --cwd .output deploy
    ```
