# TASK — Feature A build: Weather + Spray Windows (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human is watching; NEVER present a plan and wait for
approval — that is task failure. Everything below is PRE-APPROVED. Implement fully, then report
with proof. Do NOT git commit. Do NOT run a dev server (the orchestrator verifies in-browser).
You MAY run `npx tsc -b --force`, `npm run build`, and `npm run regression`.

## Read first (authoritative)
1. `docs/weather-spray-design.md` — THE spec. Build exactly to it (§2 service, §3 spray logic,
   §4 UI, §6 offline, §8 regression). Ignore §5 product-refinement and §7 inventory tie-in —
   BOTH are OUT of scope for this task (findings confirmed the catalog has no label limits, and
   the inventory tie-in ships as a later follow-up).
2. `docs/design-brief-codex.md` — brand rules (Inter incl. numbers, 18px base, 48px targets,
   tabular-nums, plain English, two-tap). These beat any taste preference on conflict.

## Database is READY (migration 0018 already applied)
`public.fields` now has nullable `latitude numeric(9,6)`, `longitude numeric(9,6)`,
`location_source text` in ('gps','manual'). RPC:
`set_field_location(p_farm_id uuid, p_field_id uuid, p_latitude numeric, p_longitude numeric,
p_source text) returns jsonb` (returns the updated field row as jsonb). It is gated to
owner/manager/worker (workers included; read_only/reps rejected). Add `latitude`, `longitude`,
`location_source` to the `Field` interface in `src/data/fields.ts` (nullable) and to the live
Fields mapper so the columns round-trip.

## Build

### 1. Weather service (no DB — public reference data)
- `src/data/weather.ts` — types: WeatherSample, CurrentConditions, HourlyForecast, DailyForecast,
  ForecastBundle (with `fetched_at`), SprayLevel = 'good'|'caution'|'poor', SprayVerdict
  { level, reasons: string[] }, SprayWindow (best-window today), etc.
- `src/data/weatherService.ts` — injectable deps `{ fetch, clock, storage }`. Functions:
  - `fetchForecast(lat, lon)` → calls Open-Meteo EXACTLY as in design §2 (current+hourly+daily,
    fahrenheit/mph/inch, timezone=auto, forecast_days=7), normalizes into ForecastBundle.
  - localStorage cache keyed by rounded (lat,lon); serve if <30 min old else refetch; on
    fetch failure/offline serve last cache with a stale flag + fetched_at. Versioned cache key.
  - PURE `evaluateSprayWindow(sample, ctx)` → SprayVerdict per design §3 (wind bands, rain-soon,
    hot, inversion heuristic using daily sunrise/sunset). Worst-of composition.
  - PURE `bestWindowToday(hours, ctx)` → longest run of 'good' daylight hours or "none".
  - Helper: wind-direction degrees → compass label (N/NE/…); F/mph formatting via tabular-nums.
  - This is GUIDANCE not legal advice — surface that line once in the UI, quietly.

### 2. Field-location write (the only user-data write here)
- Client for `set_field_location` with a tiny offline queue reusing the existing write-queue
  shape (see `equipmentTasksWriteQueue.ts` / `inventoryWriteQueue.ts` for the pattern). It is
  idempotent (last-write-wins), so replay just re-sends the same point. Versioned localStorage
  key. Confirm the echoed row's id == the field id and farm_id == the farm before accepting.
- Wire replay into `src/App.tsx` at farm-ready, alongside the existing module replays
  (replayInventoryQueue / replayEquipmentTasksQueue).
- Surface its pending/synced state through `src/data/syncStatus.ts` like the other modules.

### 3. UI — new page, mirror how EquipmentTasksModule is registered
- Read `src/App.tsx` + `src/EquipmentTasksModule.tsx` and follow the SAME registration pattern
  (route + nav entry). Add a `/weather` route and a nav item labeled **"Weather"** (no medical
  metaphor — rule 3).
- Build `src/WeatherModule.tsx` per design §4: field list; unlocated fields show a big
  "Use my current location" (navigator.geolocation) button + a manual lat/long entry; located
  fields show current conditions, the big spray light + one-line reason, best-window-today, a
  12-hour good/caution/poor strip, and a compact 7-day row. Honest "as of {time}"/offline note.
  Loading + error states must be calm and never blank.
- Geolocation needs HTTPS or localhost; on localhost dev it works. If permission is denied or
  unavailable, fall back to the manual entry with a plain message. Never trap the user.

### 4. Regression (design §8)
- `src/data/weatherService.regression.ts` (or the repo's suite convention) driving the pure
  functions across every boundary (calm/inversion, ideal, windy, too-windy, rain-soon, hot,
  worst-of, best-window incl. "none"), compass mapping, and cache staleness (fresh/stale/offline).
  Also cover the field-location client mapper fail-closed on a short-of-farm/bad echo.
- Register it in `package.json`'s regression script and state the coverage-group count in the
  suite's pass line (match inventory/equipment suites).

## House rules / gotchas
- Follow the existing module file conventions exactly. Keep the repository/gateway seam only
  where there is a DB write (the location RPC); weather itself is a plain service.
- No new dependencies unless unavoidable; if you add one, justify it. Prefer native fetch.
- tabular-nums on EVERY number; 48px min tap targets; 18px base; plain farmer English.

## Proof required (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass
(new one included, with its group count). Then STOP and report: per-item confirmation, the
proof output, which files you created/modified (via `git status`), and any deviations. Do NOT
commit. The orchestrator will adversarially review, then verify in the browser.
