# TASK — FIX Chunk 4 review findings (Terra)

CRITICAL EXECUTION RULE: headless, no human. PRE-APPROVED. Fix EVERY item, RUN checks yourself,
report with real output. Do NOT git commit. Do NOT run a dev server. You MAY run `npx tsc -b --force`,
`npm run build`, `npm run regression`.

Context: a DB hard guard `farm_tasks_program_linkage_check` (migration 0025, ALREADY APPLIED to
farm-rx TEST) now REJECTS any source='program' task lacking program_assigned_pass_id/program_cycle_key
— proven. So the P1 can no longer brick the board silently, but the UI must not attempt such a save
and must not offer edits the tracker owns.

## P1 — Program task cards must not be edited/deleted on the board
`EquipmentTasksModule.tsx:30` lets a farmer Edit/Delete a `source='program'` card; the save
(`SupabaseEquipmentTasksRepository.ts:46`) drops the program linkage fields. FIX: for cards with
`source='program'`, HIDE the Edit and Delete controls on the Tasks board. The card stays visible and
TAPPABLE, navigating to `/programs?pass=<program_assigned_pass_id>` (Season progress) where date/content
changes belong. Program cards are closed by Apply/Skip/Cancel in the tracker, not by board editing.
(The board may still show/complete-via-drag if that path preserves linkage AND status only — but the
simplest correct fix is: no inline Edit/Delete for program cards.) Confirm a program card no longer
exposes Edit/Delete and that tapping it routes to the pass.

## P2-1 — reconnect generates before queued Programs writes replay
`App.tsx:111` calls `generateDueProgramItems()` before `replayProgramsQueue()`, so a reconnected
offline assignment/reschedule can miss its new card/reminder. FIX: after `replayProgramsQueue()`
resolves in the background reconnect flow, run ANOTHER caught, best-effort `generateDueProgramItems()`.
It must stay best-effort (swallow errors) and must NOT gate rendering or any Programs write.

## P2-2 — notifications refresh reads before its generated alert exists
`NotificationsModule.tsx:24/31` starts generation and reads notifications concurrently, so a freshly
generated alert can be missed ("No alerts" shown). FIX: keep the initial read non-blocking, but after
a SUCCESSFUL generation trigger ONE follow-up notifications + bell refresh. Guard against overlapping
or unmounted refreshes (no state update after unmount, no infinite loop).

## P3 — regression coverage
Add cases proving: a Program card is non-editable/non-deletable on the board (or preserves linkage);
reconnect runs generation AFTER queued Programs replay; a notification refresh eventually shows the
item that same refresh generated; local-date behavior at UTC-midnight boundary (send a sane farm-local
date within ±1 of server current_date); rendered Program-card navigation to /programs?pass=<id> and no
effect-loop re-fire. State the new coverage-group counts.

## Proof (RUN yourself, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (state new counts).
`git status`. Do NOT commit. Per-fix: what changed + file:line. Note: Opus will browser-prove that a
program card has no Edit/Delete and taps through to the pass, and that a due card still appears exactly
once after reconnect.
