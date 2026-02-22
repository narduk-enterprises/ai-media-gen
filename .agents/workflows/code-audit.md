---
description: Find opportunities to reduce code, use better patterns for components/composables/stores, and improve overall code quality
---

# Code Simplification & Quality Audit

// turbo-all

Systematically find areas where code can be simplified, deduplicated, or improved. Produces a prioritized report — **no code changes are made**.

---

## Phase 1: Size & Complexity Inventory

1. Get a line-count ranking of the largest files:

```bash
find app/components app/composables app/pages server/api server/utils -name '*.vue' -o -name '*.ts' | xargs wc -l | sort -rn | head -40
```

2. Flag files **>250 lines** as candidates for splitting.
3. For each flagged file, view its outline to understand its responsibilities.

---

## Phase 2: Duplication Detection

4. Search for duplicated reactive state patterns across components and composables:

```bash
grep -rn 'useState\|ref(\|computed(' app/composables/ --include='*.ts' | cut -d: -f1 | sort | uniq -c | sort -rn
```

5. Search for repeated preset/constant definitions:

```bash
grep -rn 'Presets\|presets\|PRESETS\|options.*=.*\[' app/components/ app/composables/ --include='*.vue' --include='*.ts'
```

6. Search for duplicated API fetch patterns:

```bash
grep -rn '\$fetch\|useFetch\|useAsyncData' app/ --include='*.vue' --include='*.ts' | cut -d: -f1 | sort | uniq -c | sort -rn
```

7. Search for duplicated form state (common generation params):

```bash
grep -rn 'steps\|width\|height\|numFrames\|imageStrength\|loraStrength\|fps' app/components/ --include='*.vue' | cut -d: -f1 | sort | uniq -c | sort -rn
```

8. For each cluster of duplication, view the relevant files side by side and note:
   - What's duplicated and where (file + line range)
   - Whether it should become a **shared composable**, **shared constants file**, or **shared component**
   - Estimated lines that would be removed

---

## Phase 3: Composable Design Audit

9. For every composable in `app/composables/`, view its outline and check:
   - **Single responsibility**: Does it do more than one thing? If so, suggest splitting.
   - **Reinventing the wheel**: Does it reimplement something available in VueUse or Nuxt?
   - **Unused exports**: Are any exported functions/refs never imported elsewhere?
   - **Cleanup**: Does it properly clean up watchers, event listeners, intervals?
   - **Merge candidates**: Are any composables closely related and should be combined?

10. Verify every composable export is used:

```bash
for f in app/composables/*.ts; do
  funcs=$(grep -oP 'export (function|const) \K\w+' "$f" 2>/dev/null)
  for func in $funcs; do
    count=$(grep -rl "$func" app/ --include='*.vue' --include='*.ts' | grep -v "$f" | wc -l)
    if [ "$count" -eq 0 ]; then echo "UNUSED EXPORT: $func in $f"; fi
  done
done
```

---

## Phase 4: Component Pattern Review

11. For the top 15 largest components, view their code and check:
    - **Inline logic** blocks >15 lines in `<script setup>` that should be composables
    - **Prop drilling** through 2+ levels (should be `provide/inject` or composable)
    - **Template complexity**: nested `v-if`/`v-for` >3 levels deep → should be sub-components
    - **Hardcoded values**: magic numbers, repeated strings, inline styles
    - **Missing types**: untyped refs, props, or emits

12. Check for components that could be consolidated:

```bash
# Find components with very similar names (likely overlapping purpose)
ls app/components/*.vue | sed 's/.*\///' | sed 's/\.vue//' | sort
```

---

## Phase 5: Server-Side Review

13. Check API routes for duplicated patterns:

```bash
# Find repeated DB/R2/auth patterns
grep -rn 'hubDatabase\|hubBlob\|requireAuth\|getValidatedQuery' server/api/ --include='*.ts' | cut -d: -f1 | sort | uniq -c | sort -rn
```

14. For the most repeated patterns, check if they should be:
    - Extracted into `server/utils/` functions
    - Consolidated into shared middleware
    - Merged into fewer, more capable endpoints

15. Check for inconsistent error handling:

```bash
grep -rn 'createError\|throw\|catch' server/api/ server/utils/ --include='*.ts'
```

---

## Phase 6: Dead Code Scan

16. Find unused components:

```bash
for f in app/components/*.vue; do
  base=$(basename "$f" .vue)
  count=$(grep -rl "$base" app/ server/ --include='*.vue' --include='*.ts' | grep -v "$f" | wc -l)
  if [ "$count" -eq 0 ]; then echo "UNUSED COMPONENT: $f"; fi
done
```

17. Find debug artifacts and commented-out code:

```bash
grep -rn 'console\.log\|console\.warn\|console\.error\|// TODO\|// HACK\|// FIXME' app/ server/ --include='*.vue' --include='*.ts'
```

18. Find unused imports:
    - View files flagged in Phase 1 and manually check for unused imports at the top of each file.

---

## Phase 7: Anti-Pattern Scan

19. Check for Nuxt/Vue anti-patterns:

```bash
# State outside setup (SSR cross-request leak risk)
grep -rn 'const .* = ref(\|const .* = reactive(' app/ --include='*.ts' --include='*.vue' | grep -v 'composables/' | grep -v '<script'

# Missing key on v-for
grep -rn 'v-for=' app/ --include='*.vue' | grep -v ':key'

# Deeply nested ternaries in templates
grep -rn '? .* : .* ? .* :' app/ --include='*.vue'
```

---

## Phase 8: Produce Report

20. Create an artifact at `<artifacts>/code-audit-report.md` containing:
    1. **Executive Summary** — total findings, top 3 highest-impact wins
    2. **Findings Table** sorted by impact:
       | # | File(s) | Category | Finding | Fix | Impact | LOC Δ |
    3. **Quick Wins** — changes doable in <15 min each
    4. **Refactoring Candidates** — larger changes for a dedicated session
    5. **Architecture Notes** — systemic patterns worth rethinking

21. Present the report via `notify_user` for review. **Do NOT make code changes — this workflow is audit-only.**
