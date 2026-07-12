# Feature A — Weather + Spray Windows (design)

Authoritative spec for the first feature of the customer-value batch. Owner decisions
(Mason, 2026-07-12): weather feed = **Open-Meteo** (free, no API key); reminders elsewhere =
in-app + phone push only. This feature defers to the three handoff rules (simplicity, data-is-
theirs, brand-the-wrapper). Plain English, 18px base, 48px tap targets, tabular-nums, two-tap.

## What the farmer gets
1. A **field-level forecast** (current + next 12 hours + 7-day) pulled live from Open-Meteo.
2. A big plain **"Can I spray right now?" light** per field — green / yellow / red — with a
   one-line reason in farmer English ("Good window until about 2 PM, rain after" /
   "Too windy — 14 mph, gusting 22" / "Calm & clear at dawn — drift-inversion risk").
3. A **best-window-today** hint and an hour-by-hour good/caution/bad strip.
4. Optional: refine the light **against a specific product** if the Inventory catalog stores
   that product's label limits (see §5 — degrade gracefully if it doesn't).
5. Tie-in: on the existing Inventory spray-application form, a **"Use current weather"** button
   that fills wind speed / wind direction / temperature from the live reading (secondary; §7).

## 1. Field location (new) — migration 0018 (Sol drafts; review gate before apply)
Weather needs a point. Fields today store none. Add to `public.fields` (additive, nullable —
mirrors how 0009 added columns):
- `latitude numeric(9,6)` check between -90 and 90
- `longitude numeric(9,6)` check between -180 and 180
- `location_source text` check in ('gps','manual') — provenance for trust/UX
Constraint: latitude and longitude are both null or both set (a half-set point is invalid).

**How the farmer sets it (two-tap, gloves, sunlight):**
- Primary: **"Use my current location"** → browser Geolocation API (`navigator.geolocation`).
  Perfect when standing in the field. Captures lat/long, `location_source='gps'`.
- Fallback: manual lat/long entry (`location_source='manual'`) for setting it from the office.
- No map-pin picker in v1 (keeps it simple; add later if asked). No geocoding-from-county in v1.

**Write path — dedicated RPC `set_field_location(p_farm_id uuid, p_field_id uuid, p_latitude
numeric, p_longitude numeric, p_source text)`** (do NOT thread this through the big
`save_field_bundle` — a location pin must be settable without re-saving the whole field):
- SECURITY DEFINER, `set search_path = public, pg_temp`.
- Gate with the same membership predicate the field-save path uses (`can_edit_farm(p_farm_id)`);
  Sol confirms the exact predicate. read_only members and reps must NOT write. Workers SHOULD
  (they hold the phone in the field) — confirm `can_edit_farm` includes 'worker'; if it does
  not, use the correct member-write predicate so workers can drop a pin.
- Verify the field belongs to the farm; last-write-wins update; return the updated field row.
- Idempotent by nature (setting the same point twice is harmless) → **no write-receipt needed**;
  offline replay simply re-sets the same value. No `SELECT ... FOR UPDATE` (0017 lesson: a
  SECURITY DEFINER function bypasses RLS so a plain UPDATE is correct and safe here).
- Grants: revoke from public/anon/authenticated, grant execute to authenticated.

## 2. Weather service (no database — this is not the customer's private data)
Forecasts are public reference data, fetched live and cached; they do NOT go through the
Repository→Gateway→Postgres seam. New files:
- `src/data/weather.ts` — types (WeatherSample, HourlyForecast, DailyForecast, SprayVerdict…).
- `src/data/weatherService.ts` — fetch + normalize + cache. Injectable deps `{ fetch, clock,
  storage }` so it is unit-testable without network.

**Open-Meteo call** (client-side fetch; Open-Meteo is CORS-open and keyless, so no edge function
and no key to hide — keeps it $0 and simple):
```
GET https://api.open-meteo.com/v1/forecast
  ?latitude={lat}&longitude={lon}
  &current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,
           wind_direction_10m,wind_gusts_10m,cloud_cover
  &hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,
          wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover
  &daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,
         temperature_2m_min,sunrise,sunset
  &temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch
  &timezone=auto&forecast_days=7
```
**Caching:** keep the last successful payload per (lat,lon rounded to ~3 decimals) in
localStorage with a fetched-at stamp. Serve cache if < 30 min old; otherwise refetch. On fetch
failure or offline, serve the last cache with an honest "as of {time}" note and a "showing your
last forecast — reconnect for the latest" line. Never show a blank or a lie.

## 3. Spray-window logic (the heart) — pure, testable, honest
A pure function `evaluateSprayWindow(hour: WeatherSample, ctx): SprayVerdict` returns
`{ level: 'good'|'caution'|'poor', reasons: string[] }`. Product-agnostic **defaults**
(good-practice, farmer-sensible; these are guidance, not legal advice — label always wins):

- **Wind speed** (primary drift driver):
  - `< 3 mph` → caution, reason "very calm — temperature-inversion drift risk"
    (see inversion rule below; may escalate to poor at night).
  - `3–10 mph` → good (the ideal band).
  - `10–15 mph` → caution "getting windy — {n} mph".
  - `> 15 mph` → poor "too windy — {n} mph, gusting {gust}".
- **Rain**: precipitation in the current/next hours or high probability within the next ~4h →
  caution/poor "rain in ~{n} h — product needs a dry window". (Most labels want a rain-free
  interval; 4h is a safe generic.)
- **Temperature**: `> 85°F` → caution "hot — {n}°F, higher evaporation/volatility"
  (matters for volatile chemistries; generic caution in v1).
- **Inversion heuristic** (Open-Meteo has no inversion field, so approximate and LABEL it as an
  estimate): likely when `wind_speed < 3 mph` AND it is night or within ~2h after sunrise
  (use the daily `sunrise`/`sunset`). Inversion + calm → poor for drift-prone products,
  caution otherwise. Always phrase as "possible" — never claim certainty.

`level` for a field = worst of the "now" sample's factors. Also compute **best-window-today**:
scan today's remaining daylight hours, find the longest run of `good` hours, report
"Best window today: ~9 AM–1 PM" (or "No good window today" honestly). The hour strip colors each
hour good/caution/poor for the next 12h.

## 4. UI — new page `/weather` ("Weather & Spray"), added to nav
- **Field picker / list**: one card per field. If a field has no location → the card shows
  "Set location to see weather" with a big **"Use my current location"** button (48px) + a
  manual lat/long link. Everything else on the card is hidden until located.
- **Located field card**: current temp, wind speed + a direction arrow/compass label (N/NE…),
  gusts, humidity, rain; the big **spray light** (color block + word + one-line reason);
  **best window today**; a 12-hour good/caution/poor strip (tabular, color-coded); a compact
  7-day row (high/low + rain icon).
- **Refresh** control + an honest "as of {time}" / offline note.
- No jargon in nav (rule 3): the tab is "Weather," not a medical metaphor.
- Reuse existing card/token styles from `styles/app.css`; match the other modules.

## 5. Optional product refinement (degrade gracefully — do NOT hard-depend on it)
Read `supabase/migrations/0010_module3_inventory.sql` and the inventory types to see whether the
product catalog stores label **environmental limits** (e.g. max wind speed, temp range, rain-free
hours, drift/inversion restrictions like dicamba). 
- **If those columns exist**: add an optional "Check against a product" picker; when chosen,
  tighten the verdict to that product's limits and cite them ("dicamba label: max 10 mph, no
  inversions").
- **If they do NOT exist**: skip the picker entirely in v1 and note in the build report that a
  future migration could add per-product label limits. The default good-practice light ships
  either way. Report which case you found.

## 6. Offline / PWA
- Viewing: cache-served when offline with the "as of" note (§2). Spray light is computed from
  whatever sample we have, with a staleness caption if the cache is old.
- Setting a location: it is a single last-write-wins RPC. If offline, hold the pending pin in a
  tiny localStorage entry and replay `set_field_location` on reconnect (reuse the existing
  write-queue helper shape; it is idempotent so replay is safe). Wire the replay into `App.tsx`
  at farm-ready alongside the other module replays.

## 7. Inventory tie-in (secondary — keep it small)
On the Inventory spray-application form, add one **"Use current weather"** button that, when the
field has a location and a fresh reading is available, fills `wind_speed`, `wind_direction`,
`temperature`. Purely additive; must not change how application records save or validate. If it
risks bloating the change, ship it as a tiny follow-up after the main page is proven.

## 8. Regression bar (pure where possible; no live network in tests)
Add a suite (Vitest, repo convention) covering, at minimum:
- `evaluateSprayWindow`: each boundary — calm/inversion, ideal, windy, too-windy, rain-soon,
  hot; worst-of composition; best-window scan (incl. "no good window").
- unit handling + wind-direction → compass label.
- cache staleness: fresh cache served, stale cache refetched, offline serves stale with flag.
- `set_field_location` client mapper: fail-closed on a bad/short-of-farm echo; both-null vs
  both-set location validation.
State the coverage-group count in the suite's pass line (match the inventory/equipment suites).

## 9. Proof required (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all suites pass
(new one included). Then Claude verifies hands-on in the browser against farm-rx: set a field's
location via "use my location" (or manual for a known lat/long), see a real Open-Meteo forecast
render, see the spray light + reason, and confirm the field's lat/long landed in Postgres.

## Scope guards (v1 — do NOT build)
- No map-pin picker, no geocoding from county, no radar imagery, no historical weather archive.
- No storing forecasts in the database. No weather edge function (client fetch is enough).
- No push/email alerts here — that is Feature E, built last.
- Spray light is **guidance, not legal advice**; the UI says so once, quietly. The product label
  and applicator judgment always govern.
