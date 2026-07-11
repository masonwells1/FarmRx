# TASK — Module 4 Profitability UI adversarial review (Sol, read-only)

Review another agent's Module 4 Profitability UI implementation against the task spec
docs/build-notes/task-m4-ui.md and the calculation semantics in docs/schema-module4.md +
supabase/migrations/0006 (views). Read code; do not run it. Be adversarial — find what is
wrong, not what is fine.

## Scope (uncommitted changes)
New: src/ProfitabilityModule.tsx, src/data/profitability.ts, MockProfitabilityRepository.ts,
MockProfitabilityRepository.regression.ts. Modified: src/App.tsx, src/FieldsModule.tsx,
src/data/{backends,index,grain,MockGrainRepository}.ts, src/styles/app.css, package.json.

## Hunt specifically for
1. **Math correctness vs 0006 semantics**: breakeven price = total cost/acre ÷ expected
   yield; breakeven yield = total cost ÷ expected price; BU TO COVER per line = line cost ÷
   expected price; matrix cell = price×yield − cost basis consistent with the views;
   division-by-zero/empty-cost edge cases; equivalent-cash-rent comparison excludes the
   budget land line exactly once (no double-count, no drop); crop-share = landlord revenue
   share minus landlord-paid inputs; flex = base + bonus per CURRENT UI formula
   {type, trigger, bonus_rate} (NOT the 0006 {basis, rate_pct} shape — decision 6a pending).
2. **Shared formula**: FieldsModule equivalent-rent logic reused, not forked (a forked copy
   that can drift is a P1).
3. **Storage safety**: profitability writes ONLY to its own localStorage key; the
   farm-rx-local-data envelope and write-queue keys byte-untouched by any profitability
   operation; fail-closed on corrupt/unknown envelope; write-verified persistence;
   copy-from-budget deep-copies (no shared references mutating the source).
4. **Seam discipline**: repository interface used by UI; backends manifest updated
   correctly ({fields:'supabase', grain:'mock', profitability:'mock'}); no Supabase
   profitability code; Fields data via injected repository only.
5. **Regression honesty**: do the new tests assert real behaviors (stateful round-trips,
   known-value math checks) or trivial truths?
6. **UI rules**: ≥18px, ≥48px, tabular-nums on all numbers, plain farmer English, matrix
   scrolls inside its own container (no page-level horizontal scroll at 375px), farmerError
   taxonomy on failures, no medical metaphors, empty states teach.
7. Regressions to existing modules: FieldsModule/Grain behavior unchanged for their own
   flows; grain.ts changes safe.

## Output format (FINAL message = ONLY this markdown document)
## Findings
Numbered. Each: **P1**/**P2** — one-line title, file:line, what breaks, concrete fix.
Then a short paragraph on what was verified clean.
VERDICT: COMMIT-READY or NEEDS FIXES (n P1)
