Review complete. No files changed.

Verification:

- `npx tsc -b --force` — PASS, exit 0.
- `npm run regression` — PASS, exit 0; all suites ran, including “Weather service regressions passed (4 coverage groups).”
- The npm commands initially hit a restricted global launcher path; forcing the readable system npm prefix allowed the exact commands to run successfully.

## P1 — Ship blockers

1. [weatherService.ts](C:/FarmRx/src/data/weatherService.ts:50) — A forecast hour ignores its own rain probability.

   `rain !== sample` excludes the sample being evaluated. Focused execution with 90% rain probability, zero precipitation, and 6 mph wind returned:

   `{"level":"good","reasons":["wind is in the 3–10 mph range"]}`

   Therefore the hour strip and `bestWindowToday` can recommend spraying during a 90%-rain hour.

   Suggested fix: evaluate the sample’s own precipitation probability, while avoiding only duplicate reasons—not the condition itself. Add an own-hour rain regression.

2. [weatherService.ts](C:/FarmRx/src/data/weatherService.ts:23), [WeatherModule.tsx](C:/FarmRx/src/WeatherModule.tsx:32) — Empty forecast arrays are accepted as valid safety data.

   `normalize()` rejects missing arrays but accepts `hourly.time=[]` and `daily.time=[]`. Focused execution confirmed both empty arrays were returned successfully. Consequences:

   - Current conditions can say “Good” without any future-rain evidence.
   - Missing sunrise/sunset makes `daylight()` accept every hour; focused execution produced `Best window today: ~10 PM–12 AM`.
   - The response is cached as a successful forecast.

   Suggested fix: require nonempty, aligned hourly/daily arrays and a usable daily sunrise/sunset entry before computing spray guidance. Fail into stale cache or an honest unavailable state.

3. [fieldLocation.ts](C:/FarmRx/src/data/fieldLocation.ts:24), [fieldLocation.ts](C:/FarmRx/src/data/fieldLocation.ts:25), [fieldLocation.ts](C:/FarmRx/src/data/fieldLocation.ts:28) — Replay can erase a newly queued location.

   Concrete race: replay reads queued point A and waits on the network; the farmer queues point B; after A returns, replay persists `current.entries.slice(1)` from its stale snapshot, deleting B. The UI already told the farmer B was saved on-device, but it will never replay.

   Suggested fix: serialize all queue mutations with the existing keyed/cross-tab locking pattern, then re-read storage and remove only the successfully sent operation.

## P2

4. [weatherService.ts](C:/FarmRx/src/data/weatherService.ts:17), [weatherService.ts](C:/FarmRx/src/data/weatherService.ts:31) — Cache validation is only envelope-deep.

   A fresh cache containing `bundle:{}` was accepted as `{stale:false}` in focused execution. `ForecastView` will then dereference `bundle.current.time` and crash the Weather page.

   Suggested fix: run cached bundles through the same strict structural validation as network data. Treat invalid cache as absent.

5. [weatherService.ts](C:/FarmRx/src/data/weatherService.ts:29), [weatherService.ts](C:/FarmRx/src/data/weatherService.ts:33) — Cache-storage failure can discard a successful live forecast.

   `getItem` can fail before the fetch, while `setItem` failure is caught as though the network request failed. With no previous cache, storage-disabled/private environments show no forecast despite receiving valid live weather.

   Suggested fix: make weather caching best-effort; return successfully normalized live data even when localStorage cannot read or write.

6. [App.tsx](C:/FarmRx/src/App.tsx:98) — Field and location replays run concurrently.

   A field created offline can have its location RPC replay before the field creation reaches Postgres. The RPC then reports “field does not belong,” leaving the location blocked until a manual retry.

   Suggested fix: await the Fields replay before replaying field-location entries.

7. [SupabaseFieldsRepository.ts](C:/FarmRx/src/data/SupabaseFieldsRepository.ts:55) — The strict field mapper accepts an impossible provenance shape.

   `{latitude:null, longitude:null, location_source:'gps'}` passes mapping even though a source requires coordinates. The mapper also has no new regression coverage for null, numeric/string numeric, half-set, or source/coordinate mismatch shapes.

   Suggested fix: enforce `location_source === null` when coordinates are null, and add mapper boundary tests.

8. [WeatherModule.tsx](C:/FarmRx/src/WeatherModule.tsx:22), [fieldLocation.ts](C:/FarmRx/src/data/fieldLocation.ts:28) — Offline read-only users receive an overconfident sync promise.

   A read-only member can queue a location offline and see “It will sync when you reconnect.” The database correctly rejects it later because `can_edit_farm` excludes read-only users.

   Suggested fix: suppress the write UI when role information is available, or say “saved pending permission/sync” and clearly replace that message when replay is blocked.

9. [weatherService.regression.ts](C:/FarmRx/src/data/weatherService.regression.ts:13) — The suite is real but misses the critical failure boundaries.

   It executes genuine pure functions and cache/location clients, but omits:

   - Rain probability on the evaluated hour.
   - Empty/misaligned forecasts and missing daylight data.
   - Corrupt cache bodies and storage failures.
   - Offsetless Open-Meteo timestamps.
   - Field-ID echo mismatch.
   - Offline replay/idempotency and concurrent enqueue.
   - Live Field mapper location shapes.

   Those omissions allowed all three P1s to pass regression.

## P3

10. [WeatherModule.tsx](C:/FarmRx/src/WeatherModule.tsx:25) — A field-load failure also displays “No active fields yet.”

    `pageError` is shown while the empty-state condition still uses only `!fields.length`, falsely implying the farm has no fields.

    Suggested fix: show the empty state only when loading succeeded.

11. [app.css](C:/FarmRx/src/styles/app.css:362) — Hour-strip text is explicitly 17px, below the required 18px baseline.

    Suggested fix: use 18px for both hour and verdict labels.

## Correct and good

- [fieldLocation.ts](C:/FarmRx/src/data/fieldLocation.ts:19) correctly fails closed unless both echoed `id` and `farm_id` match, and validates numeric bounds/source.
- Replay reuses the stored coordinates; repeated RPC writes are naturally idempotent.
- `can_edit_farm` includes owner, manager, and worker while excluding read-only and reps.
- Supabase, queued, and mock Field paths carry/preserve location columns. `save_field_bundle` still does not write them, so editing field basics preserves the dedicated location.
- Worst-level composition, wind boundaries, compass mapping, 30-minute cache boundary, stale fallback, 48px controls, tabular numbers, internal strip scrolling, and plain “Weather” navigation are otherwise sound.
- The feared universal UTC shift is not occurring: offsetless ISO strings are parsed as device-local wall time, not UTC. However, tests incorrectly use offset-bearing timestamps and the service discards Open-Meteo’s timezone metadata; the API documents that `timezone=auto` returns local-time timestamps, so real offsetless/DST coverage should be added. [Open-Meteo forecast documentation](https://open-meteo.com/en/docs)

SHIP-AFTER-FIXES (P1: own-hour rain is ignored; empty forecasts can produce unsafe guidance; location replay can delete a queued pin).