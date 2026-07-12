# TASK — FOCUSED RE-REVIEW of Chunk 5 fixes — Sol

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED to READ, run read-only checks, and WRITE a findings report only. Do NOT edit code, do NOT
commit, do NOT apply migrations. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`,
`git diff`. Be adversarial. This is a re-review of the fixes to YOUR prior findings.

## Context
Your first review (`docs/build-notes/task-programs-chunk5-review.out.md`) found 6 P1 + 2 P2 + 1 P3.
Opus fixed the migration side; Terra fixed the client/UI. The fix brief is
`docs/build-notes/task-programs-chunk5-fixes.md`. Verify via `git diff` that EACH finding is actually
resolved and that NO new defect or regression was introduced. Migration files: `0024_programs.sql` was
reverted to its applied state (should show NO diff); the fix is in a NEW `0026_program_cost_known_lines.sql`.

## Verify each is resolved (cite file:line, confirm or reject)
1. **Full tracker restored (P1-1):** Season progress renders the rich `SeasonTracker` again with Skip,
   Reschedule, Refresh-from-template, Reassign, Unassign, archived/pending/template-update/cancelled/
   empty states — AND the three Chunk 5 features added additively (spray light only on planned spray
   passes and never blocking; application record none/link/create with the free-type disclosure; cost).
   `src/ProgramSeasonTracker.tsx` deleted. No lost control.
2. **Migration 0026 (P1-2, P1-3):** Confirm it uses CREATE OR REPLACE VIEW (no DROP), keeps every
   existing column's name/order/type, appends `planned_known_cost_per_acre`/`actual_known_cost_per_acre`
   at the END of each view, and now GATES `planned_cost_per_acre`/`total_planned_cost` to NULL unless
   every active planned line is priced (so `*_cost_per_acre` nullability == `*_cost_is_complete`).
   Base view replaced before the rollup. security_invoker + authenticated SELECT grants preserved.
   Confirm 0024 shows no diff. Confirm the client cost mapper now matches this gated shape.
3. **Link canonical values (P1-4):** For `kind:'link'`, the client validates echo + reread against the
   SELECTED record's application_date/applied_acres (not the submitted form values); none/create still
   validate against submitted. A link to a record with different date/acres now succeeds and replays
   idempotently. Check the value is threaded from UI → repository safely (no trust of client-sent
   canonical that could mask a server mismatch — it must still compare the server echo/reread).
4. **Inventory completed-link (P1-5):** `program_application_products` rows are validated separately,
   accepted only when the referenced application is draft OR completed (voided rejected), kept OUT of
   the on-hand ledger (no inventory movement, no application_products write), and rendered as un-posted
   / clearly separate. No cross-farm leakage (rows are farm-scoped through the view + validation).
5. **Offline projection (P1-6):** `QueuedProgramsRepository` locates the assignment by
   `assignment.passes.some(p => p.id === assignedPassId)` for apply/skip/reschedule; projects terminal
   status + pending + actual products + application_record_id (+ canonical link date/acres); a queued
   Apply hides Apply/Skip/Reschedule so it cannot be re-submitted. Replay-once preserved.
6. **Cost $0 (P2-7):** formatter never coalesces a missing per-acre/total to 0; mapper fails closed
   unless completeness + per-acre + total nullability all agree.
7. **Regression realism (P2-8):** `programsChunk5.regression.ts` now exercises real behavior (partial
   cost shape incl half-up 1.005→1.01, link-different-date, completed-link/draft render, offline
   projection by assignedPassId) rather than source-substring checks.
8. **P3-9:** spray status word rendered once.

## Also hunt for NEW problems introduced by the fixes
- Any place the link canonical-value threading lets the CLIENT dictate the stored date/acres instead of
  the server/linked record deciding.
- Any farm/tenant scoping gap in the new program_application_products validation path.
- Any tracker control that now mis-targets the wrong assignment/pass after the merge.
- Type/echo validation weakened anywhere.

## Output
Write `docs/build-notes/task-programs-chunk5-rereview.out.md`: per-item CONFIRMED / STILL-BROKEN /
NEW-ISSUE with file:line and a concrete fix, an overall CLEAR-TO-COMMIT or BLOCK verdict, and whether
tsc/build/regression passed for you. Do NOT edit code.
