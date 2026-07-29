# TASK — BUILD Chunk 3: Programs assign + season tracker (Terra)

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, RUN the checks yourself, report with real output. Do NOT git commit.
Do NOT run a dev server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

## Spec + contracts
- `docs/programs-design.md` §9 Chunk 3 + §2/§3/§4 (Revision 2 = MULTIPLE programs per crop). Read it.
- RPC contracts in `supabase/migrations/0024_programs.sql` (all applied + proven on farm-rx TEST):
  `assign_program(p_farm_id,p_operation_id,p_program_id,p_crop_assignment_ids uuid[])`,
  `reassign_program_assignment(...,p_assignment_id,p_new_program_id,p_reason)`,
  `refresh_program_assignment(...,p_assignment_id)`,
  `reschedule_program_pass(...,p_assigned_pass_id,p_due_on,p_timing_label)`,
  `mark_program_pass_applied(...,p_assigned_pass_id,p_applied_on,p_applied_acres,p_actual_products,
   p_application_record_id,p_create_application_record)` —
   **THIS CHUNK: call it with p_application_record_id=null and p_create_application_record=false**
   (capture status + actual free-type products ONLY; the create/link-application-record UI is Chunk 5),
  `skip_program_pass(...,p_assigned_pass_id,p_skipped_on,p_reason)`,
  `unassign_program(...,p_assignment_id,p_reason)`.
  Read views (security-invoker): `program_assignment_tracker` (assignment + field/crop/year/planting
  + ordered pass progress), and the assigned rows in `assigned_program_passes` /
  `assigned_program_pass_products` (is_active filtered).
- Continue the SAME seam + patterns you built in Chunk 2 (repository/gateway/versioned FIFO queue/
  regression) and the proven harvest/scouting modules. Extend `programsWriteQueue.ts` with the new
  assignment mutations (new discriminated entry types), keep Web-Lock cross-tab + canonical echo +
  offline pending projection.

## Build (assignment + tracker layer)
Enable the "Assign to fields" view (remove the "coming next" placeholder) and add a "Season progress"
tracker, per design §8:
- **Assign to fields**: pick a program, then choose one or more crop-years to assign it to. Each choice
  reads like "North 80 — Soybeans — 2026 — planting 1" (NEVER raw UUIDs) — join crop_assignments →
  fields → commodities. MULTIPLE programs may be active on one crop (Rev 2); the SAME program twice on
  one crop is rejected by the RPC (surface the farmer-English error). Respect the program's optional
  commodity/crop_year scope (don't offer crops the RPC would reject; if the RPC rejects, show the
  message).
- **Season progress (tracker)**: for each crop-year, group by PROGRAM (show program name + kind badge),
  then its ordered passes with status (Planned/Applied/Skipped/Cancelled) + due date if any. Primary
  action on a Planned pass = **Apply** (capture applied date, applied acres [<= planted], and editable
  actual free-type product lines starting from the plan — the actual-products confirmation); secondary
  = **Skip** (reason) and **Reschedule** (set/adjust due date + timing label). Per-assignment: **Refresh
  from template** (only when tracker shows "Template has updates" i.e. program.revision >
  assignment.template_revision — never rewrites Applied/Skipped/overridden), **Reassign** (replace ONE
  program on that crop, leaving sibling programs untouched), **Unassign** (archive; Applied history
  preserved — confirmation says so). All actions operate on ONE specific assignment, never "the crop's
  program". Do NOT create/link an application record here (Chunk 5).
- Wire assignment-mutation replay in `App.tsx` after Fields, same sync key `programs`.

## Rules
- Snapshots are authoritative: editing a template must NOT change already-assigned passes until the
  farmer taps Refresh (prove this). Double-crop: two crop_assignments on one field stay fully
  independent. Marking a pass Applied must never touch the crop's expected/planting/acres.
- Brand/mobile: 18px / 48px / tabular-nums / plain English / no medical metaphor / 375px no horizontal
  overflow / two-tap / calm empty-loading-error. Status shown as WORDS + not color-only.
- Extend the regression suite with assignment/tracker coverage groups (assign, multiple-per-crop,
  same-program-twice rejected mirror, reschedule, apply w/ actual products, skip, refresh preserves
  terminal, unassign preserves applied, offline replay of an assignment mutation). State the new count.

## Proof (RUN yourself, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (state new Programs
coverage-group count). `git status`. Do NOT commit. Report files changed, exact check output, coverage
count, deviations, and top 3 things for the reviewer to check.
