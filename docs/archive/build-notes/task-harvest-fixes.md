# TASK — Feature D review fixes (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Fix EVERY item below, then report with proof. Do NOT git commit. Do NOT run a dev
server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.
Files in scope: `src/data/SupabaseHarvestRepository.ts`, `src/data/QueuedHarvestRepository.ts`,
`src/App.tsx`, `src/data/SupabaseHarvestRepository.regression.ts`, `src/styles/app.css`, and a
small shared decimal helper if you add one. Do NOT edit migration 0022 (the receipt-replay
re-validation item is intentionally accepted as the shared idempotency pattern — leave it).

## P2-1 — SQL-rounded values can be FALSELY rejected (real farmer-facing bug)
`SupabaseHarvestRepository.ts` echo comparison uses `Math.round(value * 10**places)`, which is
wrong under binary floating point: a valid `1.005` bushel save is stored by PostgreSQL
`numeric(16,2)` as `1.01`, but `Math.round(1.005*100)` = 100 (→1.00), so the canonical echo is
rejected (reviewer reproduced ROUNDING_PROBE_REJECTED). FIX: compare using
PostgreSQL-consistent decimal rounding (half-up on the decimal string, e.g. round via
`Number(value.toFixed(places))` or a decimal-string helper), for harvested_bushels (2 dp) AND
actual_price_per_bu (6 dp). Round the OUTGOING draft values the same way before send so the echo
matches. Add regression: canonical `1.005 → 1.01` (bushels) and a 6-dp price rounding boundary
are ACCEPTED, and a genuinely different value is still rejected.

## P2-3 — reconnect replay can race the Fields replay
`QueuedHarvestRepository` installs its own `online` listener; on reconnect it can replay a
harvest for a crop_assignment that a still-pending Fields create hasn't inserted yet, get the DB
"crop assignment does not belong to this farm" rejection, classify it as BLOCKED, and require a
manual retry even after Fields later succeeds. The startup ordered call in App.tsx does not
control the reconnect listeners. FIX: make Harvest's reconnect replay await the Fields replay
first — match however the other modules avoid this (check fieldLog/scouting/App.tsx); if they
share the flaw, at minimum ensure Harvest awaits Fields on BOTH startup and reconnect (e.g.
Harvest's online handler triggers/join the Fields replay before its own, or a central coordinator
runs Fields → then the dependent modules). A transient "field not created yet" must remain
PENDING/retryable, never latch to BLOCKED.

## P3-1 — regression fake is not SQL-faithful (hides P2-1)
`SupabaseHarvestRepository.regression.ts` fake echoes values unchanged (e.g. `1280.125` instead
of PostgreSQL's `1280.13`). FIX: make the fake gateway apply the DB scales (2 dp bushels, 6 dp
price) to what it echoes, so the rounding path is actually exercised. Add the missing cases:
SQL rounding boundaries, transport-vs-blocked queue handling, malformed envelope JSON / extra
top-level keys, zero/non-finite planted acres (yield/ac must not divide-by-zero or show NaN —
show honest dash), and unknown viewer role fail-closed. Update the coverage-group count.

## P3-2 — 16px text below the 18px baseline
`app.css` (~L209 result labels, ~L225 history text): raise to 18px. Verify nothing else in the
harvest CSS is under 18px.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with the
enlarged harvest suite (state its new group count). FINAL: per-fix confirmation, proof output,
`git status`, deviations. Do NOT commit.
