# TASK — Adversarial review: Feature A (Weather + Spray Windows) (Sol, read-mostly)

CRITICAL EXECUTION RULE: headless, no human is watching; NEVER present a plan and wait — that
is task failure. Do the review fully, then report. Do NOT fix anything, do NOT git commit, do
NOT run servers. You MAY read any file and run `npx tsc -b --force` / `npm run regression`.

## What to review
Feature A was just built by Terra. Spec: `docs/weather-spray-design.md` (authoritative).
Migration already applied (0018): fields have latitude/longitude/location_source +
`set_field_location(p_farm_id, p_field_id, p_latitude, p_longitude, p_source)` RPC gated to
owner/manager/worker. Review these NEW/CHANGED files (get the exact list via `git status`):
- NEW: `src/WeatherModule.tsx`, `src/data/weather.ts`, `src/data/weatherService.ts`,
  `src/data/fieldLocation.ts`, `src/data/weatherService.regression.ts`.
- CHANGED: `src/App.tsx`, `src/FieldsModule.tsx`, `src/data/fields.ts`,
  `src/data/SupabaseFieldsRepository.ts`, `src/data/QueuedFieldsRepository.ts`,
  `src/data/MockFieldsRepository.ts`, `src/data/index.ts`, `src/data/syncStatus.ts`,
  `src/styles/app.css`, `package.json`.

## Hunt hard for (rank P1 ship-blocker / P2 / P3, with file:line + concrete failure)
1. **Spray-logic correctness** — the whole value prop. Check `evaluateSprayWindow`,
   `bestWindowToday`, `inversionLikely`, `rainSoon`, worst-of composition, compass mapping,
   day/night (sunrise/sunset) math, and time-zone handling (Open-Meteo returns LOCAL ISO
   strings without offset when timezone=auto — does `new Date(...)`/`at()` misparse them as UTC
   and shift the hour strip / best-window / inversion window? This is a likely real bug).
2. **Location write path** — `fieldLocation.ts` offline queue + `set_field_location` echo
   validation (must confirm echoed id == field id AND farm_id == farm; fail-closed otherwise);
   idempotent replay reuses the SAME point; App.tsx replay wiring at farm-ready; does a failed
   or blocked write surface honestly (not a false "saved")? Any way a worker/read_only mismatch
   with the DB gate produces a confusing UI state?
3. **Field mapper round-trip** — latitude/longitude/location_source added to the Field type and
   ALL THREE repositories (Supabase/Queued/Mock) + the live mapper; the fail-closed strict
   mapper must accept null and real numeric values and reject a half-set point.
4. **Cache/offline** — staleness boundary (30 min), offline serves last cache with stale flag,
   corrupt cache envelope handled, never a blank/lie; cache key rounding collisions.
5. **Fetch robustness** — non-ok response, network throw, malformed Open-Meteo JSON (missing
   hourly/daily arrays), empty forecast; does normalize() crash or degrade gracefully?
6. **Brand/rule compliance** — 18px base, 48px tap targets, tabular-nums on all numbers, plain
   English, no medical metaphor in nav; 375px mobile has no horizontal overflow (the hour strip
   and 7-day row must scroll inside their own container, not the page).
7. **Regression quality** — is the suite REAL (drives the pure functions + mapper across the
   boundaries in design §8) or vacuous? Name any missing critical case. Does it actually run?
8. **Did the change break the live Fields module?** — FieldsModule.tsx and the field repos were
   touched; confirm the existing field save/load path is intact (the location columns must not
   have altered save_field_bundle expectations — the RPC still doesn't know these columns, and
   they're set only via set_field_location).

## Output
Run `npx tsc -b --force` and `npm run regression` yourself and state the real result. Then a
findings list ranked P1/P2/P3, each with file:line, the concrete failure scenario, and a
suggested fix. If something is correct-and-good, say so briefly. End with a one-line verdict:
SHIP-AFTER-FIXES (list the P1s) or CLEAN.
