## Findings

### P1

- [weatherService.ts:62](C:/FarmRx/src/data/weatherService.ts:62), [FieldLogModule.tsx:37](C:/FarmRx/src/FieldLogModule.tsx:37) — GDD can display a materially understated number as “since planting.” The request ends on today despite the archive’s roughly five-day lag, and any non-empty partial response is accepted without confirming it starts at planting or covers every expected day. A one-day response can therefore become the season GDD. Suggested fix: cap the archive end at the latest safely available date, validate continuous coverage from planting through that date, and show the prompt instead of a number when coverage is incomplete.

### P2

- [fieldLogWriteQueue.ts:10](C:/FarmRx/src/data/fieldLogWriteQueue.ts:10) — corrupt queue envelopes do not fail closed semantically. I directly proved the parser accepts a rainfall entry with `rainfall_in:null`, an empty note, and `observed_on:"2099-01-01"`. Replay then sends it and becomes permanently blocked at the server. Suggested fix: reuse strict draft validation in queue parsing, including real-date/future bounds, type consistency, numeric limits, and note length/content.

- [QueuedFieldLogRepository.ts:23](C:/FarmRx/src/data/QueuedFieldLogRepository.ts:23), [QueuedFieldLogRepository.ts:26](C:/FarmRx/src/data/QueuedFieldLogRepository.ts:26) — offline `saveEntry()` returns `undefined` while claiming `Promise<FieldLogEntry>`. The UI closes the form and reloads live data, so the supposedly saved entry disappears until synchronization. Suggested fix: return and render an explicit local pending entry, or change the contract/UI so offline acceptance is represented honestly.

- [SupabaseFieldLogRepository.ts:34](C:/FarmRx/src/data/SupabaseFieldLogRepository.ts:34), [FieldLogModule.tsx:31](C:/FarmRx/src/FieldLogModule.tsx:31) — client validation does not match the database future-date check. The form has no `max`, and the repository only checks the date’s shape, so far-future dates reach the server or offline queue. Rainfall notes over 500 characters and blank rainfall notes are also not rejected at the repository boundary. Suggested fix: centralize DB-equivalent validation and set the input’s allowed maximum.

- [app.css:201](C:/FarmRx/src/styles/app.css:201), [app.css:208](C:/FarmRx/src/styles/app.css:208) — 375px overflow is not guarded. Field-log forms remain two-column on mobile, timeline text has no `min-width:0`/word breaking, and a 500-character unbroken note can force the row/page wider than the viewport. Suggested fix: stack the form and timeline row in the mobile media query and add `min-width:0; overflow-wrap:anywhere`.

- [SupabaseFieldLogRepository.regression.ts:39](C:/FarmRx/src/data/SupabaseFieldLogRepository.regression.ts:39) — regression coverage does not meet the stated bar. It verifies operation IDs are reused but never makes replay return a different row ID and proves rejection; malformed-queue coverage tests only invalid JSON; season math contains no note row; and wrong save farm/ID/type/value echoes are not independently exercised. GDD coverage omits partial history, archive lag/range capping, fractional rounding, future planting, and corrupt history cache. Suggested fix: add those adversarial fakes and boundary cases.

### P3

- [app.css:194](C:/FarmRx/src/styles/app.css:194), [app.css:198](C:/FarmRx/src/styles/app.css:198) — the season label and GDD explanatory/prompt text are 16px, violating the feature’s 18px base rule. Suggested fix: raise them to 18px.

## Confirmed clean behavior

- GDD math clamps each day before summing, rounds the final total, and returns zero for empty input.
- Earliest current-year planting date is selected, including multiple/double-crop assignments; missing planting/location degrades to a prompt.
- Feature A forecast, cache, and spray-evaluation implementation changes are additive only. Own-hour rain, empty forecast, and cache-validation regressions still pass.
- Field-log replay runs after awaited Fields replay in [App.tsx:101](C:/FarmRx/src/App.tsx:101).
- Canonical save/delete echoes validate farm, field, entry ID, and `{id, deleted:true}`; delete is server-idempotent.
- Season total filters rainfall-only, current calendar year through today; numeric rendering uses tabular figures globally.
- The actual viewer membership role is used. `read_only` has no controls; `worker` can add, edit, and delete.
- Navigation uses plain “Field Log,” with no medical metaphor.

## Verification

- Exact `npx tsc -b --force`: could not start because the machine’s global npm/npx shim references missing `C:\Users\mason\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`.
- Equivalent repo-local TypeScript command: passed clean.
- Exact `npm run regression`: same broken npm launcher.
- Equivalent execution of every regression script listed in `package.json`: all passed, including Field Log’s 6 groups and Weather’s 7 groups.

**Verdict: SHIP-AFTER-FIXES (P1: prevent incomplete archive history from being displayed as GDD since planting).**