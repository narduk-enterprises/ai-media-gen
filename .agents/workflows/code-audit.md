---
description: Find opportunities to reduce code, use better patterns for components/composables/stores, and improve overall code quality
---

# Code Audit Workflow

Run this workflow to systematically identify opportunities for code reduction, better patterns, and improved architecture.

## Phase 1: Inventory

1. List all components, composables, pages, and server utils
   // turbo
2. Count lines per file: `find app/components app/composables app/pages server -name '*.vue' -o -name '*.ts' | xargs wc -l | sort -rn | head -40`
3. Note files over 200 lines as candidates for splitting

## Phase 2: Duplication Detection

4. Search for duplicated patterns across components:
   - Identical preset arrays (directionPresets, audioPresets, resolutionPresets)
   - Repeated API fetch patterns
   - Duplicated form state management (steps, width, height, numFrames, etc.)
   - Copy-pasted UI sections (resolution pickers, fidelity buttons, prompt fields)
     // turbo
5. Run: `grep -rn 'directionPresets\|audioPresets\|resolutionPresets' app/components/ --include='*.vue'`
   // turbo
6. Run: `grep -rn 'imageStrength\|loraStrength\|numFrames' app/components/ --include='*.vue' | cut -d: -f1 | sort | uniq -c | sort -rn`

## Phase 3: Extract Shared Logic

7. For each duplicated pattern found, determine if it should become:
   - **Shared composable** — for reactive state + logic (e.g., `useVideoSettings()` for steps/fps/resolution/frames)
   - **Shared constants** — for static data (presets, model configs)
   - **Shared component** — for repeated UI patterns (resolution picker, fidelity selector)
8. Document each extraction opportunity with:
   - What's duplicated and where
   - Proposed extraction (composable/constant/component)
   - Estimated lines saved

## Phase 4: Component Pattern Review

9. Check each component for:
   - Props that should be emits (or vice versa)
   - Logic that belongs in a composable instead of the component
   - Inline styles that should be classes
   - Template logic that should be computed properties
   - Missing TypeScript types on refs/props

## Phase 5: Server-Side Review

10. Check API routes for:
    - Duplicated DB query patterns that could be shared utils
    - Missing error handling
    - Redundant data transformations
    - Opportunities to consolidate similar endpoints

## Phase 6: Report

11. Create an implementation plan with all findings, grouped by priority:
    - **High**: Duplicated code that's actively causing maintenance burden
    - **Medium**: Pattern improvements that would simplify future development
    - **Low**: Nice-to-have cleanups

## Phase 7: Execute (with user approval)

12. Implement the approved changes, one extraction at a time
13. Build and verify after each change
14. Deploy when complete
