# TASK — ADVERSARIAL REVIEW (read-only): Programs Chunk 4 tasks+reminders wiring (Sol)

CRITICAL EXECUTION RULE: headless, no human. Review fully, then report. Do NOT fix/build/run a
server/commit. You MAY read any file and run `npx tsc -b --force` / `npm run regression` (repo-local
if the shim is missing; report if blocked).

## Scope
Chunk 4 wires Programs due passes into the EXISTING Tasks board + Notifications via
`generate_due_program_items` (applied + proven). Review: `src/data/programDueItems.ts`,
`programDueItems.regression.ts`, and diffs in `App.tsx`, `ProgramsModule.tsx`, `EquipmentTasksModule.tsx`,
`NotificationsModule.tsx`, `data/equipmentTasks.ts`, `data/SupabaseEquipmentTasksRepository.ts`,
`data/index.ts`, `styles/app.css`. Spec: `docs/programs-design.md` §5 + §9-Chunk4.

## Hunt hard (rank P1/P2/P3, file:line + concrete failure + fix)
1. **Best-effort, never blocking** — generate_due is called at farm-ready + Season-progress load +
   Notifications refresh; a failure (offline, RPC error) must be caught+swallowed and NEVER break a
   render or block a Programs write/save. Confirm no await of generate gates a critical path.
2. **Idempotent / non-spam** — repeated generate calls (fresh operation_id) create NO duplicate card
   or notification for the same due cycle. Confirm the client relies on the DB unique keys / receipt
   idempotency and does not itself insert duplicates or call in a render loop (useEffect deps correct,
   no infinite re-fire).
3. **local date** — p_local_date is the farm's local day within 1 of server current_date; confirm the
   client sends a sane local date (not a raw UTC that could be a day off) and does not violate the RPC
   bound.
4. **Tasks board rendering of source='program'** — the board renders program cards without crashing;
   plain-English label (NOT a medical metaphor); tap → `/programs?pass=<id>` or Season-progress; the
   program card coexists with manual/service_interval cards; no assumption that breaks other sources.
5. **Closure semantics** — Apply/Skip/Cancel close the matching open program card server-side; the
   board reflects Done after refresh; manually closing a board card does NOT flip the pass status
   (tracker stays source of truth). Confirm no client code fakes the reverse.
6. **Reschedule** — moving a due date updates the ONE open card (server-side) and does not spawn a
   duplicate; confirm the client refetch shows the single moved card.
7. **Regression realness** — programDueItems groups actually prove idempotent replay, best-effort
   swallow, and dedupe; the tasks regression proves a program card reloads Done while keeping its pass
   link. Name any missing critical case.
8. **Scope** — NO weather spray-light and NO application-record creation leaked in (those are Chunk 5).

## Output
Run tsc + regression; state real results (or why blocked). Findings ranked P1/P2/P3 with file:line +
failure + fix. One-line verdict: SHIP-AFTER-FIXES (list P1s) or CLEAN.
