# TASK — FIX Chunk 5 review findings (Terra)

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED. Fix EVERY item below, RUN checks yourself, report with real output. Do NOT git commit.
Do NOT run a dev server. Do NOT edit ANY file under `supabase/migrations/` — the migration side is
already fixed by Opus (0024 reverted; new `0026_program_cost_known_lines.sql` uses CREATE OR REPLACE
to gate partial costs and append known-lines columns). Your job is to make the CLIENT + UI correct and
consistent with that view shape. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

Full findings: `docs/build-notes/task-programs-chunk5-review.out.md`. Fix all P1, both P2, the P3.

## The gated cost-view shape you must match (already in migration 0026)
`program_assignment_costs` and `program_crop_cost_rollups` now return:
- `planned_cost_per_acre` / `total_planned_cost` = NULL unless every active planned line is priced
  (i.e. equal to `..._is_complete`). Same for `actual_*`.
- `planned_known_cost_per_acre` / `actual_known_cost_per_acre` = the sum of the lines that DO carry a
  cost (always present, even when incomplete). Use these for the "partial estimate" display.

## P1-1 — RESTORE the full Season tracker; add Chunk 5 features INTO it (do NOT ship the minimal rewrite)
The Season-progress view now renders the minimal `ProgramSeasonTracker` (`src/ProgramsModule.tsx:18`),
which only exposes Apply and DROPPED Skip, Reschedule, Refresh-from-template, Reassign, Unassign,
archived-history, pending-sync, template-update, cancelled-state, and empty-state. The full, correct
implementation still exists in `src/ProgramsModule.tsx` as `SeasonTracker` / `ReassignControl` /
`TrackerPass`. FIX:
1. Point the Season-progress view back at `SeasonTracker` (pass it the new props it needs:
   `applicationRecords` and `rollups`/`costRollups`). Keep the existing `programs`/`canEdit`/etc.
2. Add the three Chunk 5 features INTO the existing `SeasonTracker`/`TrackerPass` (additively — do not
   remove any existing control or state cue):
   - **Spray light** beside a pass only when `pass.activity_type === 'spray' && pass.status ===
     'planned'`. Reuse `evaluateSprayWindow` + `weatherService` exactly like `WeatherModule.tsx`
     (join assignment lat/long). Guidance only: missing location / no service / fetch fail / stale →
     honest non-blocking note; it must NEVER disable Apply/Skip/Reschedule/Refresh/Reassign/Unassign.
     Show the status word ONCE (see P3).
   - **Application record choice** in the Apply form: default "No application record"; a picker of this
     crop's non-voided records to LINK; and "Create a new draft record" (stable client UUID). Show
     "Products are free-typed — not matched to inventory; on-hand was not changed." for BOTH link and
     create. Wire the selected-record canonical values per P1-4.
   - **Cost display**: per-assignment planned/actual and per-crop rollup, partial-safe (see P2-7).
3. DELETE `src/ProgramSeasonTracker.tsx` and remove its import; remove the now-unneeded
   `export { SeasonTracker }` if nothing else uses it. Salvage its good helpers (SprayLight,
   cost text) into ProgramsModule as needed.

## P1-4 — Link with different date/acres must not be reported as failure
The RPC canonicalizes a LINK to the linked record's `application_date`/`applied_acres`
(`0024:2003-2027`). The client echo/reread check (`SupabaseProgramsRepository.ts:97-98`) currently
compares to the SUBMITTED form date/acres, so a link to a record with different values throws even
though the server committed. FIX: for `kind:'link'`, validate the RPC echo AND the canonical reread
against the SELECTED application record's `application_date`/`applied_acres` (and against each other),
not the submitted values. Keep submitted-value equality for `none`/`create`. Thread the selected
record's canonical date/acres from the Apply UI through `markProgramPassApplied` so the repository can
compare. Add a regression: link a record whose date+acres differ from the form; assert success and a
single idempotent receipt replay.

## P1-5 — Linking a COMPLETED application must not break the Inventory workspace
`SupabaseInventoryRepository.ts:43` rejects every Program-product row (from
`program_application_products`) unless the application status is exactly `draft`. Linking a completed
record is explicitly supported, so this makes Inventory fail to load. FIX: accept a non-voided
application (`draft` OR `completed`). Render a draft clearly as "Draft / un-posted"; render a completed
record's free-typed Program lines separately, without implying those free-typed lines caused any
inventory movement (they never write `application_products` and never change on-hand). Add regressions:
(a) a completed record linked to a Program pass renders safely with its free-type lines shown separately;
(b) a product-less draft renders safely and reads as un-posted.

## P1-6 — Offline Apply/Skip/Reschedule projection can't find the assignment
`QueuedProgramsRepository.ts:22` locates an assignment by an entry's `assignmentId`, but
`mark_program_pass_applied`, `skip_program_pass`, and `reschedule_program_pass` entries carry
`assignedPassId` (no `assignmentId`), so projection `continue`s and the pass still shows as Planned
with an Apply button — allowing duplicate queued ops. FIX: for assigned-pass entries, find the
containing assignment via `assignment.passes.some((p) => p.id === entry.assignedPassId)`. Project the
terminal status + `pending`, the actual products, and `application_record_id`; for a link, project the
selected record's canonical date/acres; for create, project the created id. A queued Apply must make
the pass show pending and hide its Apply/Skip/Reschedule so it cannot be submitted again. Add
regressions: offline apply(none/link/create)/skip/reschedule project correctly by `assignedPassId`;
reconnect replays once; transport-unknown stays pending; definite-blocked surfaces honestly.

## P2-7 — Never render a missing total as $0.00; fail closed in the mapper
The cost text coalesced `total ?? 0` when "complete". FIX: in the cost formatter never coalesce a
missing per-acre OR total to 0 — show the partial/unavailable wording instead. In the cost mapper,
fail closed unless `*_cost_is_complete`, `*_cost_per_acre` nullability, AND `total_*` nullability all
agree (all non-null when complete, all null when incomplete); `*_known_cost_per_acre` stays the known
sum. This matches 0026's gated view.

## P2-8 — Replace the static Chunk 5 regression with real behavior coverage
`programsChunk5.regression.ts` mostly asserts source-file substrings; it passed while all six P1 bugs
were live. Rebuild it as behavior-level cases: partial-cost SQL result shape (mixed priced/unpriced →
is_complete=false, per_acre=null, known=sum, half-up incl `1.005 → 1.01`); link-different-date canonical
validation + single receipt replay; completed-link + product-less-draft Inventory render; offline
projection by `assignedPassId` for none/link/create + skip + reschedule. Keep a FEW static contract
checks as supplements only. State the new coverage-group counts across every suite you touch.

## P3-9 — Spray status announced once
The spray card renders the level word twice ("Good · Good — …"). Put only reason/staleness/timestamp in
the text; render the status word once (in the `<strong>`).

## Rules / scope
- Additive only — do NOT remove any existing tracker control, state, or empty/cancelled/archived cue.
- Do NOT touch `supabase/migrations/`. Do NOT decrement inventory, write `application_products`, or
  post a draft. Free-type stays free-type.
- Brand/mobile: 18px/48px/tabular-nums/plain English/no medical metaphor/375px no overflow/status words.

## Proof (RUN yourself, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (STATE new counts).
`git status`. Do NOT commit. Per-fix: what changed + file:line. List the exact new regression cases.
Note: Opus will apply 0026 to the farm-rx TEST db and browser-prove: all tracker actions still present
at 375px; weather only on planned spray passes and never blocking; link-completed + create-draft render
safely in Inventory with on-hand unchanged; partial cost shows "Partial estimate" of known lines and
never $0; offline apply sticks (pass shows pending, no re-Apply).
