# TASK — Adversarial review: Feature D (harvest yield tracking) (Sol, read-mostly)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure. Review
fully, then report. Do NOT fix, do NOT commit, do NOT run servers. You MAY read any file and run
`npx tsc -b --force` / `npm run regression` (use repo-local binaries if the npx shim is broken).

## Scope
Feature D built by Terra on applied migration 0022 (crop_assignments.actual_price_per_bu column +
`save_crop_harvest(p_farm_id, p_operation_id, p_entry jsonb)` receipt-idempotent RPC, EXACTLY
4 keys {crop_assignment_id, harvested_bushels, harvest_date, actual_price_per_bu}, updates ONLY
harvest columns, harvest_date>=planting_date, gated owner/manager/worker). Spec:
`docs/harvest-design.md`. NOTE: the orchestrator already FIXED 4 tsc errors Terra left
(actual_price_per_bu missing in FieldsModule.tsx new-record literal + MockFieldsRepository 2 spots
+ a single-cast in harvestWriteQueue.ts) — tsc/build/regression are now green. Review NEW:
`src/HarvestModule.tsx`, `src/data/harvest.ts`, `HarvestDataGateway.ts`,
`SupabaseHarvestDataGateway.ts`, `SupabaseHarvestRepository.ts`, `QueuedHarvestRepository.ts`,
`harvestWriteQueue.ts`, `createSupabaseHarvestServices.ts`,
`SupabaseHarvestRepository.regression.ts`. CHANGED: `App.tsx`, `index.ts`, `backends.ts`,
`syncStatus.ts`, `fields.ts` (added actual_price_per_bu), `FieldsModule.tsx`,
`MockFieldsRepository.ts`, `SupabaseFieldsRepository.ts`, `styles/app.css`, `package.json`.

## Hunt hard (rank P1/P2/P3, file:line + concrete failure)
1. **Never overwrite expected/planting** — the harvest write must touch ONLY harvested_bushels,
   harvest_date, actual_price_per_bu; confirm neither the RPC call nor any Fields-path change wipes
   expected_yield_per_acre/expected_price_per_bu/planting/acres. The house rule: expected != actual.
2. **4-key contract** — the client must ALWAYS send exactly the 4 keys (null for blanks); a missing
   or extra key throws in the RPC. Confirm the repository builds the payload with all 4 every time,
   and the echo mapper compares normalized (harvested_bushels 2dp, actual_price_per_bu 6dp) so a
   valid save is not falsely rejected (the Feature C lesson: rounding/echo mismatches falsely fail).
3. **Yield/revenue math** — actual yield/ac = harvested_bushels/planted_acres (guard divide-by-zero
   / null acres); delta vs expected (null-expected → honest "no expected set", not 0 or NaN);
   actual revenue uses actual_price ?? expected_price and LABELS which; blank honestly if neither.
4. **Write queue** — echo validation, idempotent replay SAME operation_id (different echoed id must
   fail a test), clear-to-null, corrupt envelope fail-closed, blocked-vs-transport; App.tsx harvest
   replay AFTER Fields replay (a harvest references a crop_assignment that may be a queued create).
5. **Interaction with save_field_bundle** — FieldsModule RecordsCard also edits harvested_bushels
   via save_field_bundle; confirm the two paths don't corrupt each other (last-write-wins is ok) and
   that the Fields path does NOT try to write actual_price_per_bu through a bundle the RPC ignores.
6. **Role gating** — read_only view-only (no Enter harvest); worker can enter. Viewer role threaded.
7. **Brand/rules + APH view** — 18px/48px/tabular-nums, plain English, no medical metaphor in nav;
   375px no page overflow; year selector + yield-history strip render sane with 0/1/many years.
8. **Regression realness (7 groups)** — SQL-faithful echoes (rounding, null), wrong-echo rejection,
   idempotent replay, clear-to-null, farm isolation, role fail-closed, 4-key contract, math edges.
   Name any missing critical case; confirm it runs.

## Output
Run `npx tsc -b --force` and `npm run regression`; state real results. Findings ranked P1/P2/P3
with file:line + failure scenario + fix. One-line verdict: SHIP-AFTER-FIXES (list P1s) or CLEAN.
