# TASK — ADVERSARIAL REVIEW of Chunk 5 (Programs weather + applied-record link + cost) — Sol

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED to READ, run read-only checks, and WRITE a findings report. Do NOT edit product code.
Do NOT git commit. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`, and
read-only `git diff`. You are the schema/security/architecture advisor — be adversarial, assume the
build is wrong until proven otherwise, and rank findings P0/P1/P2/P3 with file:line and a concrete fix.

## What was built (Chunk 5, by Terra — uncommitted working tree)
Spec: `docs/programs-design.md` §1, §5, §9. Three features on the Programs Season tracker:
1. A weather "spray light" (Good/Caution/Poor + reason + forecast time + honest stale/offline/
   no-location wording) beside PLANNED spray passes only, reusing `src/data/weatherService.ts` +
   the pure `evaluateSprayWindow`. Guidance only — must NEVER block save/assign/reschedule/Apply.
2. Apply → application record: default = no record; optional LINK an existing non-voided record for
   the SAME farm+crop; optional CREATE a product-less DRAFT (client-supplied stable UUID, inserted
   status='draft', NOT posted → on-hand unchanged). Both show "Products are free-typed — not matched
   to inventory; on-hand was not changed." Program free-type actual products render via the
   `program_application_products` view; a zero-catalog-product draft must render safely (un-posted)
   in the Inventory module.
3. Planned-vs-actual cost per assignment + per-crop rollup from views `program_assignment_costs` /
   `program_crop_cost_rollups`. Partial (any line missing a cost) must show "partial estimate" + the
   known-lines sum and NEVER coalesce a missing cost to $0 or imply complete. tabular-nums + half-up.

## Files to scrutinize (run `git status` / `git diff` first)
- NEW `src/ProgramSeasonTracker.tsx` (the tracker UI: spray light, Apply link/create, cost display)
- NEW `src/data/programsChunk5.regression.ts` (7 groups)
- `supabase/migrations/0024_programs.sql` — **NOTE: Terra edited this file, which is ALREADY APPLIED
  to the farm-rx TEST project.** It added `planned_known_cost_per_acre` / `actual_known_cost_per_acre`
  to views `program_assignment_costs` and `program_crop_cost_rollups`. Assess this as a MIGRATION-
  HYGIENE DEFECT: the on-disk migration now diverges from the applied DB, and the client reads columns
  the live views don't have. Recommend the correct fix (a NEW forward migration, e.g. 0026, that
  CREATE OR REPLACE VIEWs with the new columns APPENDED AT THE END so it applies cleanly to the
  existing DB; revert 0024 to its applied state). Confirm CREATE OR REPLACE VIEW constraints
  (identical leading columns/order/types; new columns only at the end) and that the rollup view can
  reference the new base-view column. Flag any security_invoker regression.
- `src/data/SupabaseProgramsRepository.ts` + `.regression.ts`, `src/data/programs.ts`,
  `src/data/ProgramsDataGateway.ts`, `src/data/SupabaseProgramsDataGateway.ts`,
  `src/data/QueuedProgramsRepository.ts`, `src/data/programsWriteQueue.ts`
- Inventory touch: `src/InventoryModule.tsx`, `src/data/inventory.ts`,
  `src/data/InventoryDataGateway.ts`, `src/data/SupabaseInventoryDataGateway.ts`,
  `src/data/SupabaseInventoryRepository.ts` + `.regression.ts` (draft-render path)
- `src/ProgramsModule.tsx`, `src/styles/app.css`, `package.json`

## Hunt specifically for
1. **mark_program_pass_applied LINK/CREATE** (RPC in 0024): can a LINK reach a record of ANOTHER
   farm or ANOTHER crop_assignment, or a voided record? Does CREATE ever post/decrement on-hand or
   write application_products? Is the client UUID validated? Replay/idempotency intact (receipt lock)?
2. **Draft render safety**: a product-less draft application_record opened in Inventory — any code
   path that assumes ≥1 product, divides by product count, or crashes on empty? Does it read clearly
   as un-posted (no implied inventory movement)?
3. **Cost math**: any place a missing cost becomes 0 or a partial reads as complete; half-up rounding
   at boundaries; per-acre × acres totals; rollup completeness = bool_and across assignments.
4. **Weather**: is it truly non-blocking (fetch failure / no location / stale never throws, never
   disables Apply)? Only spray passes show a light? Does it re-implement or correctly reuse weather?
5. **RLS/security-invoker** on the changed views; **offline queue** correctness for the new
   link/create-draft actions (canonical echo, idempotent replay, blocked-vs-transport).
6. Brand/mobile: 18px/48px/tabular-nums/no medical metaphor/375px no overflow/status words.

## Output
Write findings to `docs/build-notes/task-programs-chunk5-review.out.md`: ranked P0–P3, each with
file:line, why it's wrong, a concrete fix, and whether it blocks commit. State whether tsc/build/
regression passed for you. End with the top 3 things Opus must browser-prove. Do NOT edit code.
