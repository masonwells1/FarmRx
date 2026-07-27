## Findings

### P2

- [SupabaseHarvestRepository.ts:12](C:\FarmRx\src\data\SupabaseHarvestRepository.ts:12) — SQL-rounded values can be falsely rejected. `Math.round(value * scale)` is vulnerable to binary floating-point behavior. A valid `1.005` bushel save becomes `1.01` in PostgreSQL’s `numeric(16,2)`, but the mapper rejects that canonical echo. I reproduced `ROUNDING_PROBE_REJECTED`. Fix: normalize using decimal-string logic consistent with PostgreSQL, and test canonical `1.005 → 1.01` plus six-decimal price rounding.

- [0022_harvest.sql:64](C:\FarmRx\supabase\migrations\0022_harvest.sql:64) — receipt replay bypasses the four-key RPC validation at line 77. Reusing a completed operation ID with a missing/extra-key payload returns the old receipt instead of throwing, contrary to the exact contract. Fix: validate the entry’s shape before returning a receipt, and ideally bind receipts to the original request payload.

- [QueuedHarvestRepository.ts:17](C:\FarmRx\src\data\QueuedHarvestRepository.ts:17) — reconnect replay can race Fields replay. Fields and Harvest install independent `online` listeners; Harvest can try a queued crop assignment before Fields creates it, classify the database rejection as blocked, and require a manual retry even after Fields succeeds. The ordered startup call in [App.tsx:107](C:\FarmRx\src\App.tsx:107) does not control these listeners. Fix: coordinate reconnect replay centrally and await Fields before Harvest.

### P3

- [SupabaseHarvestRepository.regression.ts:14](C:\FarmRx\src\data\SupabaseHarvestRepository.regression.ts:14) — the advertised SQL-faithful rounding test is not real: the fake gateway echoes `1280.125` unchanged even though PostgreSQL stores `1280.13`. Missing critical cases include SQL rounding boundaries, transport-versus-blocked queue handling, malformed envelope JSON/top-level keys, zero/non-finite acres, and unknown roles. Fix: make fake echoes apply the database scales and add those assertions.

- [app.css:209](C:\FarmRx\src\styles\app.css:209) and [app.css:225](C:\FarmRx\src\styles\app.css:225) — Harvest contains explicit 16px result labels and history text, violating the Feature D 18px minimum. Fix: raise these declarations to 18px.

## Confirmed clean

The RPC writes only `harvested_bushels`, `harvest_date`, and `actual_price_per_bu`. Fields saves preserve expected yield/price, planting data, acres, and actual price. Four-key construction, clear-to-null, role gating, yield/revenue formulas, price-source labeling, farm echo validation, and startup Fields-before-Harvest ordering are otherwise present.

Verification:

- Literal `npx tsc -b --force`: blocked by the broken global npm shim—missing `C:\Users\mason\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`.
- Literal `npm run regression`: same wrapper failure.
- Repo-local `tsc -b --force`: passed.
- Repo-local complete regression equivalent: passed, including `SupabaseHarvestRepository regression passed (7 coverage groups)`.

**Verdict: SHIP-AFTER-FIXES — P1 blockers: none; fix the three P2 failures before shipping.**