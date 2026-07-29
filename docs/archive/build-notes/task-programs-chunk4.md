# TASK — BUILD Chunk 4: Programs due passes → tasks + reminders (Terra)

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, RUN checks yourself, report with real output. Do NOT git commit.
Do NOT run a dev server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

## Spec + contracts
- `docs/programs-design.md` §5 (tasks & reminders wiring) + §9 Chunk 4.
- RPC `generate_due_program_items(p_farm_id, p_operation_id, p_local_date)` (applied + DB-proven):
  for active-assignment Planned passes with due_on where due_on - reminder_lead_days <= p_local_date,
  it inserts ONE farm_tasks card (source='program', program_assigned_pass_id, program_cycle_key
  `due:<pass>:<due_on>`, title = program+pass+field) and ONE deduped owner notification
  (dedupe `program:<pass>:due:<due_on>`, link `/programs?pass=<pass>`). `on conflict do nothing`,
  best-effort, never rolls back. It is receipt-idempotent (fresh operation_id each call; SAME id on
  replay). Reschedule already syncs the open task; Apply/Skip/Cancel already close the matching open
  program card server-side (Chunk 1/3).
- Existing surfaces: the Tasks board (`src/*Tasks*`/`TasksModule`) renders farm_tasks; Notifications
  (Feature E, `NotificationsModule`, bell) renders notifications. Reuse them — do NOT build a second
  task or notification system.

## Build (wiring only — no new tables)
- Call `generate_due_program_items` BEST-EFFORT (catch+swallow; never block a render or a Programs
  write) at: app farm-ready (App.tsx, after Fields replay), on Programs "Season progress" load, and on
  Notifications refresh. Use a fresh operation_id per call via the same queue/id pattern; a failure
  must NEVER break the page or a program save.
- Ensure the Tasks board correctly RENDERS program-sourced cards (source='program'): show the card
  with its title + due date + field chip; tapping it navigates to `/programs?pass=<assigned_pass_id>`
  (or the Programs Season-progress view). If the board already renders generic farm_tasks, just ensure
  the 'program' source + link render sensibly (no crash, plain-English label — NOT a medical metaphor).
- Confirm Apply/Skip on a pass (Chunk 3 flows) closes the matching open program card (server already
  does this — verify the board reflects it after refresh) and that manually closing the board card does
  NOT change the pass status (the tracker stays the source of truth; show "Task closed; pass still
  planned" only if trivially available, else leave the honest existing behavior).
- Do NOT wire the weather spray-light or application-record creation (Chunk 5).

## Rules
- Idempotent + non-spammy: repeated generate calls (new operation_id) produce NO duplicate card or
  notification for the same due cycle (the DB unique keys + on-conflict guarantee it — prove it).
- Reschedule to a new date updates the ONE open card (already server-side) — verify no duplicate.
- Brand/mobile: 18px/48px/tabular-nums/plain English/no medical metaphor/375px no overflow/status words.
- Extend regression with the generate-due wiring behavior you can unit-test at the repository layer
  (idempotent replay, best-effort swallow, dedupe) — state the new count.

## Proof (RUN yourself, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (state new count).
`git status`. Do NOT commit. Report files changed, exact check output, coverage count, deviations,
and the top 3 things for the reviewer to check. Note: Opus will browser-prove that a due pass creates
exactly one board card + one notification (idempotent across repeated calls) and that Apply closes it.
