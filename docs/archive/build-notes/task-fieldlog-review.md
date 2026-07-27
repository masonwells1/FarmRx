# TASK — Adversarial review: Feature B (rain gauge + field log) (Sol, read-mostly)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure. Review
fully, then report. Do NOT fix, do NOT commit, do NOT run servers. You MAY read any file and run
`npx tsc -b --force` / `npm run regression`.

## Scope
Feature B just built by Terra on applied migration 0019 (table `field_log_entries`; RPCs
`save_field_log_entry(farm, op_id, entry jsonb)` receipt-idempotent, `delete_field_log_entry(farm,
entry_id)` idempotent; writes gated owner/manager/worker). Spec: `docs/rain-fieldlog-design.md`.
Review NEW: `src/FieldLogModule.tsx`, `src/data/fieldLog.ts`, `FieldLogDataGateway.ts`,
`SupabaseFieldLogDataGateway.ts`, `SupabaseFieldLogRepository.ts`, `QueuedFieldLogRepository.ts`,
`fieldLogWriteQueue.ts`, `createSupabaseFieldLogServices.ts`,
`SupabaseFieldLogRepository.regression.ts`. CHANGED: `src/App.tsx`, `src/data/index.ts`,
`backends.ts`, `syncStatus.ts`, `styles/app.css`, `package.json`, AND
`src/data/weather.ts` + `weatherService.ts` + `weatherService.regression.ts` (GDD extension).

## Hunt hard (rank P1/P2/P3, file:line + concrete failure)
1. **GDD correctness** — `growingDegreeDays` = Σ max(0,(Tmax+Tmin)/2 − base) with base 50;
   verify the negative clamp is PER-DAY (not on the sum), rounding, empty/short input. Planting-
   date selection = earliest CURRENT-YEAR planting_date for the field; what if multiple crops /
   double-crop / no planting date / planting date in the future? Archive API lag (~5 days for
   "today") — does the range end sanely and degrade to a prompt, not a crash or wrong number?
2. **Did the GDD changes BREAK Feature A?** — weatherService.ts/weather.ts were modified; confirm
   the forecast fetch, cache, and `evaluateSprayWindow` path are unchanged in behavior (the
   Feature A P1 fixes for own-hour rain / empty-forecast / cache validation must still hold).
3. **Field-log write queue** — echo validation (saved row id/farm_id/field_id match; delete echo
   {id, deleted:true}); idempotent replay reuses the SAME operation_id (a fake returning a
   different id on replay must fail a test); delete idempotency; blocked-vs-transport; corrupt
   envelope fail-closed. In `App.tsx`, field-log replay MUST run AFTER the Fields replay (a log
   entry references a field that may itself be a queued create) — confirm ordering.
4. **Entry-type/field consistency** — rainfall row (amount required, note optional) vs note row
   (no amount, note required) enforced client-side to match the DB CHECK; mapper fail-closed on
   a bad/short-of-farm echo; observed_on future bound.
5. **Season total** — calendar-year-to-date sum of rainfall only (not notes); correct across
   entries; tabular-nums.
6. **Role gating** — read_only sees the log but NO add/edit/delete; worker CAN add/edit/delete
   (matches can_edit_farm). Confirm the viewer role is threaded correctly (not the farm creator).
7. **Brand/rules** — 18px base, 48px targets, tabular-nums on numbers, plain English, no medical
   metaphor in nav; 375px no page overflow (timeline/forms wrap, don't force horizontal scroll).
8. **Regression realness** — does the field-log suite drive every write + wrong-echo + idempotent
   replay + delete idempotency + farm isolation + role fail-closed + season math, and the GDD
   cases? Name any missing critical boundary. Confirm it actually runs.

## Output
Run `npx tsc -b --force` and `npm run regression` yourself; state real results. Findings ranked
P1/P2/P3 with file:line + failure scenario + suggested fix. One-line verdict: SHIP-AFTER-FIXES
(list P1s) or CLEAN.
