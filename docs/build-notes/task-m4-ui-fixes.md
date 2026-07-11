# TASK — Fix Module 4 UI per review (Terra, workspace-write)

PRE-APPROVED: modify src/** only. No migrations, no git, no database operations, no servers.

Fix ALL 13 findings in **docs/review-m4-ui.md** (read it first; numbering below matches).
Spec references: docs/build-notes/task-m4-ui.md, docs/schema-module4.md, migration 0006 views.

P1s:
1. Owned ground → equivalent rent ZERO from the SHARED formula (land never charged from the
   budget for owned fields); keep Fields' display wording.
2. Crop-share equivalent rent = landlord revenue share MINUS landlord-paid input costs
   (each categorized cost × its landlord share pct) — extend the shared formula; Fields and
   Profitability must both use it (no forks).
3. Arrangement selection = the latest arrangement whose effective window overlaps the
   budget's crop year (not "first open-ended").
4. Reset pickedCell to the new budget's expected price/yield when selectedId changes.
5. Bind persisted profitability data to the injected farm: store farm_id in the envelope;
   fail closed (clear farmer-English error, no overwrite) if it mismatches the current farm.
6. Enforce unique (budget, crop_assignment) allocations; block repeated submission while a
   save is in flight.

P2s:
7. Category value `equipment_depreciation` internally (farmer label stays "Equipment").
8. Extract shared calculation functions and regression-test THEM (owned, crop-share, flex,
   zero-cost, farm isolation, allocation uniqueness, envelope byte preservation) — no
   locally re-derived arithmetic assertions.
9. Surface invalid matrix-range errors via the page error state (farmer English).
10. ≥18px text and ≥48px targets everywhere in Profitability (KPI labels, matrix controls,
    headers, remove buttons, matrix inputs, field results).
11. Empty-budget state must include a create-first-budget control.
12. Add a labeled total-cost result across allocated acres (field-adjusted cost basis).
13. Breakeven contour = cells actually nearest the zero/sign boundary of the real grid.

NOTE: src/data/index.ts currently contains a marked TEMP block injecting MockFieldsRepository
for browser verification — LEAVE IT EXACTLY AS IS (the orchestrator reverts it at commit).

Proof required (run, paste real output): `npm run build` clean · `npx tsc --noEmit` clean ·
`npm run regression` all 4 suites pass.
FINAL message: numbered fixes, proof output, deviations if any.
