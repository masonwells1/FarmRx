# TASK — Feature B build: Rain gauge + field log (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — that is task
failure. PRE-APPROVED. Implement fully, then report with proof. Do NOT git commit. Do NOT run a
dev server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

## Read first
`docs/rain-fieldlog-design.md` (authoritative) and `docs/design-brief-codex.md` (brand rules:
Inter incl. numbers, 18px base, 48px targets, tabular-nums, plain English, two-tap). Mirror the
EXISTING module pattern — study `src/data/SupabaseInventoryRepository.ts`,
`InventoryDataGateway.ts`, `QueuedInventoryRepository.ts`, `inventoryWriteQueue.ts`,
`createSupabaseInventoryServices.ts`, and `src/data/fieldLocation.ts` (the freshly-built weather
location client — copy its queue-locking/echo-validation shape).

## Database is READY (migration 0019 applied)
Table `public.field_log_entries` (id, farm_id, field_id, entry_type 'rainfall'|'note',
observed_on date, rainfall_in numeric(6,2), note text, created_by, created_at, updated_at).
RPCs:
- `save_field_log_entry(p_farm_id uuid, p_operation_id uuid, p_entry jsonb) returns jsonb` —
  receipt-idempotent; p_entry keys EXACTLY {id?, field_id, entry_type, observed_on, rainfall_in,
  note}; returns the canonical row. rainfall row: rainfall_in required, note optional; note row:
  rainfall_in null, note required non-empty; observed_on <= today+1.
- `delete_field_log_entry(p_farm_id uuid, p_entry_id uuid) returns jsonb` → {id, deleted:true},
  idempotent.
Writes gated to owner/manager/worker; read_only + reps read-only.

## Build
### 1. Data layer (mirror inventory/equipment)
`src/data/fieldLog.ts` (types: FieldLogEntry, FieldLogEntryDraft, FieldLogData),
`FieldLogDataGateway.ts`, `SupabaseFieldLogDataGateway.ts`, `SupabaseFieldLogRepository.ts`,
`QueuedFieldLogRepository.ts`, `fieldLogWriteQueue.ts`, `createSupabaseFieldLogServices.ts`,
`SupabaseFieldLogRepository.regression.ts`. getData loads the farm's entries (optionally by
field). Two write kinds in the queue: `saveEntry` and `deleteEntry`. Offline queue: versioned
localStorage key, FIFO, canonical-echo validation (echoed row id/farm_id/field_id must match;
delete echo {id, deleted:true}), blocked-vs-transport, idempotent replay reusing the SAME
operation_id (mint once before enqueue). Wire replay into `App.tsx` at farm-ready AFTER the
Fields replay (a log entry references a field that may itself be a queued create — order matters,
same lesson as the weather location replay). Surface via `syncStatus.ts` (module key 'fieldLog').

### 2. Growing-degree-days (extend the weather service; reuse Feature A)
In `src/data/weatherService.ts` add `fetchDailyHistory(lat, lon, startISODate, endISODate)`
hitting Open-Meteo ARCHIVE (`https://archive-api.open-meteo.com/v1/archive?...daily=
temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`), cached per
(lat,lon,range), same validation discipline as the forecast fetch (non-empty aligned arrays,
best-effort cache, offline→stale). Add PURE `growingDegreeDays(daily, base=50)` =
Σ max(0, (Tmax+Tmin)/2 − base), rounded. The archive API can lag ~5 days for "today" — end the
range at min(today, latest available) and degrade gracefully if empty.

### 3. UI — new page `/field-log` (nav "Field Log"), mirror EquipmentTasksModule registration
`src/FieldLogModule.tsx`. Load fields (reuse the Fields repository/services for the field list,
each field's location from 0018, and crop_assignments for the earliest current-year
planting_date) + field-log entries. Per-field card:
- Big **"Add rain"** and **"Add note"** actions (48px). Rain form: date (default today) +
  inches. Note form: date + text.
- **Season rainfall total** (calendar year to date, "2026 season", tabular-nums).
- **GDD line**: if the field has a location AND a current-year planting_date, show "GDD since
  planting: 1,240"; else a one-line prompt ("Add a location and planting date to see growing
  degree days"). Honest offline/stale caption.
- **Timeline**: reverse-chronological entries (date · "0.80 in" or note text) with Edit/Delete
  for members who can edit; read_only sees the log but NO add/edit/delete (role-gate via the
  viewer role like equipment — thread `workspace.viewer.role`).
Calm loading/error/empty states; never blank; no medical metaphor in nav.

### 4. Regression (`SupabaseFieldLogRepository.regression.ts` + GDD in weatherService suite)
Stateful canonical fake gateway driving EVERY write + wrong-echo rejection, idempotent replay
(same op id on second replay), farm isolation, entry-type/field consistency, delete idempotency,
viewer-role fail-closed, season-total math. PURE `growingDegreeDays` cases (below/above base,
negative clamp, empty). Register in `package.json` regression script; state the coverage-group
count in each suite's pass line.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with
the new field-log suite + enlarged weather suite (state group counts). FINAL: per-item
confirmation, proof output, `git status`, deviations. Do NOT commit — orchestrator reviews +
browser-verifies.
