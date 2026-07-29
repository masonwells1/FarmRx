# TASK — Module 4 Profitability UI on MOCK data (Terra, workspace-write)

PRE-APPROVED: modify src/** and package.json. Do NOT touch supabase/migrations/**, do NOT
run database operations, do NOT use git. Dev server may be running; don't start/stop servers.

## Mission
Build the Profitability module UI on a mock repository, mirroring the semantics of the
DRAFT schema (docs/schema-module4.md + supabase/migrations/0006/0007 as the calculation
spec — read them; the UI must compute what the views will later compute). This is the
flagship differentiator: the interactive PROFITABILITY MATRIX must be front-and-center.

## Read first
- docs/farm-rx-handoff.md (three rules; Part 4 profitability spec; Part 5 brand tokens)
- docs/design-brief-codex.md — MANDATORY design brief for all UI
- docs/schema-module4.md — owner-approved semantics (budgets, cost lines, matrix, views)
- docs/competitor-farmprofitmanager.md — the ADOPT list for Module 4 (BU TO COVER,
  equivalent cash rent, breakeven yield, copy-from-budget, beatable static matrix)
- src/data/index.ts, backends.ts, MockFieldsRepository.ts, MockGrainRepository.ts,
  GrainModule.tsx + FieldsModule.tsx (existing patterns: repository seam, edit-in-place
  cards, aria-live saves, farmerError taxonomy, 18px/48px/tabular-nums styles)

## Data layer rules (critical)
- New `MockProfitabilityRepository` implementing a new `ProfitabilityRepository` interface
  in the same seam style. **Persist in a SEPARATE localStorage key**
  (`farm-rx-profitability-mock:v1`) — do NOT touch or version-bump the existing
  `farm-rx-local-data` envelope; do NOT modify MockFieldsRepository/MockGrainRepository
  persistence. Fields data comes via injected FieldsRepository (same pattern as Grain).
- Fail closed exactly like the other mocks: verify writes by read-back; unknown/corrupt
  envelope → clear error, never overwrite; seed only when the key is absent.
- Register in backends.ts as `profitability: 'mock'` and compose in index.ts.
- Flex formula: use the CURRENT UI shape {type, trigger, bonus_rate} (decision 6a pending —
  do not adopt the 0006 {basis, rate_pct} shape in UI).

## UI scope (route /profitability, nav already exists)
1. **Budgets**: list per crop year + commodity (optional entity label hidden in v1); create,
   edit, and "Copy from another budget" (copies cost lines + matrix steps). Expected yield
   and expected price inputs (manual, plain).
2. **Cost lines**: per-acre entry grid by category (seed, chemical, fertilizer, fuel,
   repairs, labor, land, crop insurance, equipment, interest, custom). Inline add/edit rows,
   autosave on blur/Enter (aria-live "Saved"), and a **BU TO COVER** column on every line
   (line cost ÷ expected price), plus totals: cost/acre, total cost, breakeven PRICE
   (cost ÷ yield) AND breakeven YIELD (cost ÷ price), expected profit/acre.
3. **PROFITABILITY MATRIX ⭐** (the hero, above the fold on desktop): price steps × yield
   steps heat map of profit/loss per acre, computed live from current costs; owner-editable
   axis ranges/steps; color scale from brand red-loss → neutral → green-profit; a visible
   **breakeven contour** (cells nearest zero outlined); tap/click a cell shows the plain
   sentence ("At $4.60 and 210 bu/ac you make $87/ac, $13,920 on 160 ac"). Must be readable
   on a phone (horizontal scroll INSIDE the matrix container only) and use tabular-nums.
4. **Field allocation + cost/acre by field**: allocate a budget to crop assignments (from
   injected Fields data), per-field acre override, list showing each allocated field's
   cost/acre, net/acre, total net; unallocated planted acres surfaced as a gentle nudge.
5. **Arrangement comparison**: for an allocated field, show owned vs cash vs flex vs crop-
   share in equivalent-cash-rent terms (reuse the exact same math/labels FieldsModule uses
   for field-level equivalent rent — import/share, don't fork the formula), replacing the
   budget's land line (never double-count land; note this on screen in plain English).
6. Brand + a11y: ≥18px, ≥48px targets, tabular-nums, plain farmer English, no medical
   metaphors, farmerError taxonomy for failures, empty states that teach ("Add your seed
   cost to see bushels to cover").
7. Branded PDF export: OUT of this task (later).

## Regression
`src/data/MockProfitabilityRepository.regression.ts` wired into `npm run regression`:
round-trip, copy-from-budget deep-copies (no shared references), matrix math spot checks
(breakeven price/yield, a known cell), fail-closed corrupt envelope, write-verified persist,
Fields envelope bytes untouched by profitability saves.

## Proof required (run, paste real output)
`npm run build` clean · `npx tsc --noEmit` clean · `npm run regression` all 4 suites pass.
FINAL message: what you built (files), proof output, deviations with one-line justifications.
