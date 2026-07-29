# TASK — Feature A review fixes (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human is watching; NEVER present a plan and wait — that
is task failure. Everything is PRE-APPROVED. Implement ALL fixes, then report with proof.
Do NOT git commit. Do NOT run a dev server. You MAY run `npx tsc -b --force`,
`npm run build`, `npm run regression`.

An adversarial review of the just-built Weather + Spray feature found the defects below. Fix
EVERY one. Files in scope: `src/data/weatherService.ts`, `src/WeatherModule.tsx`,
`src/data/fieldLocation.ts`, `src/App.tsx`, `src/data/SupabaseFieldsRepository.ts`,
`src/data/weatherService.regression.ts`, `src/styles/app.css`. Read `docs/weather-spray-design.md`
for intent. Mirror the existing queue-locking pattern in `src/data/equipmentTasksWriteQueue.ts`.

## P1 — must fix (regression passed over all three; add tests that FAIL without the fix)

### P1-1 — the evaluated hour's OWN rain probability is ignored (unsafe "Good")
`evaluateSprayWindow` only flags actual falling rain (`precipitation_in > 0`) and rain in
LOOK-AHEAD hours (`rainSoon` explicitly skips the sample itself via `rain !== sample`). So an
hour with 0 accumulation but e.g. 90% `precipitation_probability` is rated "good" — the hour
strip and `bestWindowToday` can recommend spraying into a near-certain-rain hour.
FIX: evaluate the sample's OWN `precipitation_probability` — e.g. ≥70% → poor, ≥50% → caution,
with a plain reason ("{n}% chance of rain this hour — product needs a dry window"). Keep the
look-ahead for FUTURE hours. Do NOT emit duplicate reasons for the same condition. Add a
regression case: a sample with precipitation_in=0 and probability 90 must NOT be 'good'.

### P1-2 — empty/incomplete forecast arrays accepted as valid safety data
`normalize()` rejects MISSING arrays but accepts `hourly.time=[]` / `daily.time=[]` / missing
sunrise/sunset. Result: "Good" with no future-rain evidence; `daylight()` with no sunrise/sunset
returns true for every hour so `bestWindowToday` returns nonsense like "~10 PM–12 AM"; and this
junk is cached as a successful forecast.
FIX: a forecast is only usable if it has a non-empty `current`, a non-empty hourly series
(time + the fields spray logic reads), a non-empty daily series, AND at least today's usable
`sunrise`/`sunset`. If not, treat the fetch as failed: fall back to a valid stale cache if one
exists, else surface the honest "forecast unavailable — reconnect" card state (never compute a
spray verdict from incomplete data, never cache it as success). Add regression: empty hourly,
empty daily, and missing sunrise/sunset each fail into unavailable/stale, not a verdict.

### P1-3 — location replay can DELETE a newly-queued pin (data loss)
In `fieldLocation.ts` `replay()`, after `await send(entry)` it persists
`current.entries.slice(1)` from a STALE in-memory snapshot. If the farmer queues a new pin for
the same field during the await, `enqueue` rewrites storage to `[B]`; replay then slices its
stale `[A]` to `[]` and persists, deleting B — though the UI already said B was "saved on this
device". 
FIX: serialize all queue mutations (enqueue + replay) with the SAME keyed/cross-tab lock the
equipment queue uses. After a successful `send`, RE-READ storage and remove ONLY the operation
whose `operationId` was just sent (not `slice(1)`); leave any newer entry intact. Add a
regression that enqueues B during A's in-flight send and asserts B survives and replays.

## P2 — fix now

### P2-4 — cache validation is envelope-deep only
A cached envelope with `bundle:{}` is served as `{stale:false}`, then `ForecastView`
dereferences `bundle.current.time` and crashes the page. FIX: run cached bundles through the
SAME strict structural validation as network data (reuse the P1-2 validator). Invalid cache =
treated as absent. Regression: corrupt/partial cached bundle is ignored, not served.

### P2-5 — cache-storage failure discards a good live forecast
`getItem` throwing (private mode / storage disabled) happens before the fetch; `setItem`
throwing is caught as if the NETWORK failed. With no prior cache the farmer sees no forecast
despite valid live weather. FIX: make caching best-effort — never let a storage read/write
error suppress successfully-normalized live data. Regression: storage that throws on get/set
still returns live forecast.

### P2-6 — field-creation and location replays run concurrently
In `App.tsx`, the Fields replay and the field-location replay fire together; a field created
offline can have its location RPC replay before the field row reaches Postgres → RPC raises
"field does not belong", blocking the pin until manual retry. FIX: await the Fields replay
before starting the field-location replay.

### P2-7 — field mapper accepts impossible provenance
`SupabaseFieldsRepository` strict mapper accepts `{latitude:null, longitude:null,
location_source:'gps'}`. FIX: enforce `location_source === null` when coordinates are null (and
both-set when a source is present). Add mapper boundary tests: null point, numeric and
string-numeric coords, half-set point (reject), source/coordinate mismatch (reject).

### P2-8 — offline read-only user gets an overconfident "will sync" promise
A read_only member can queue a location offline and see "It will sync when you reconnect," but
`can_edit_farm` will reject it on replay. FIX: when the viewer's role is known and cannot edit,
do not show the location write controls (hide "Use my current location" / "Enter latitude and
longitude"); if role is unavailable, use honest wording and clearly replace the message when a
replay is blocked. (Thread the viewer role like the equipment module's `workspace.viewer.role`
if a role is already available at this layer; if not, at minimum fix the message honesty.)

### P2-9 — regression suite misses the failure boundaries
Add the missing cases so the suite would have caught P1-1/2/3: own-hour rain probability;
empty/misaligned forecasts and missing daylight; corrupt cache body and storage failure;
OFFSETLESS Open-Meteo timestamps (use `2026-07-12T14:00` style local strings, NOT offset/Z
timestamps — the current tests wrongly use offset-bearing times) incl. a DST-adjacent day;
field-ID echo mismatch; offline replay idempotency + concurrent enqueue; live Field mapper
location shapes. Update the pass line's coverage-group count.

## P3 — quick

### P3-10 — field-load FAILURE also shows "No active fields yet"
`WeatherModule` shows the empty state on `!fields.length` even when `pageError` is set. FIX:
show the empty state only when the load SUCCEEDED with zero fields; on load error show only the
error.

### P3-11 — hour-strip text is 17px (below the 18px baseline)
`app.css` `.hour-strip span`/`b` are 17px. FIX: 18px for both hour and verdict labels. Verify
nothing else in the weather CSS is under 18px.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with
the enlarged weather suite (state its new group count). FINAL message: per-fix confirmation
(P1-1…P3-11), the proof output, `git status`, and any deviations. Do NOT commit — the
orchestrator re-verifies in the browser then commits.
