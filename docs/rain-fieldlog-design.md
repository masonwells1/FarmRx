# Feature B — Rain gauge + field log (design)

Second feature of the customer-value batch. Defers to the three handoff rules (simplicity,
data-is-theirs private, brand-the-wrapper). Plain English, 18px base, 48px targets,
tabular-nums, two-tap. Builds ON Feature A (field location + weather service already exist).

## What the farmer gets
1. **Rain gauge** — tap a field, enter today's rainfall (inches), see the running **season
   total** and a simple timeline of recent entries. The thing a farmer opens after every storm.
2. **Field log** — the same timeline also holds short dated notes ("planted N field", "first
   cutting") so the rainfall history reads like a field diary. One entry type, an optional
   category.
3. **Growing-degree-days (GDD)** — per field, accumulated from the crop's planting date using
   free Open-Meteo **historical** daily highs/lows for that field's location (base 50°F for
   corn/soybeans). Shows "GDD since planting: 1,240." Hidden with a gentle prompt if the field
   has no location or no planting date yet. Reuses Feature A's location + weather service.

## 1. Schema — migration 0019 (Sol drafts; review gate before apply)
New table `public.field_log_entries` (private per-farm member data, like inventory — workers
keep their own workflow; NOT gated by the grain/financial privacy of 0008):
- `id uuid pk default gen_random_uuid()`
- `farm_id uuid not null` (fk farms, cascade)
- `field_id uuid not null` — fk `(field_id, farm_id) references fields(id, farm_id)` (same-farm)
- `entry_type text not null check in ('rainfall','note')`
- `observed_on date not null` (the day it applies to; check not absurdly future — allow today
  in the field's sense; keep a sane bound like <= current_date + 1)
- `rainfall_in numeric(6,2) check (rainfall_in is null or (rainfall_in >= 0 and rainfall_in
  <= 100))` — required when entry_type='rainfall', must be null when 'note'
- `note text check (length <= 500)` — optional for rainfall, required (non-empty) for 'note'
- `created_by uuid not null` (provenance stamp, plain uuid like repository_write_receipts —
  never an FK that blocks membership removal)
- `created_at`, `updated_at` timestamptz + set_updated_at trigger + prevent_farm_id_change trigger
- CHECK enforcing the type/field consistency (rainfall row has rainfall_in and null-or-note;
  note row has null rainfall_in and non-empty note).
- Indexes: `(farm_id, field_id, observed_on)` for the timeline; `(farm_id)`.
RLS (0019 or a paired file, match the module pattern): SELECT for any active member of the farm
(and rep when shared, like other member data — mirror inventory's policy exactly); INSERT/
UPDATE/DELETE for members who `can_edit_farm` (owner/manager/worker; read_only + reps read-only).
Follow the 0017 lesson: no `SELECT ... FOR UPDATE` in SECURITY INVOKER paths.

Save path: a `save_field_log_entry(p_farm_id, p_operation_id, p_entry jsonb)` SECURITY DEFINER
RPC with the write-receipt idempotency pattern (reuse `repository_write_receipts` like
save_field_bundle) so the offline queue can replay safely. Return the canonical row. Also a
delete path (soft or hard — hard delete is fine for a log entry; guard by can_edit_farm +
same-farm) — decide and note it; if hard delete, it needs its own idempotency consideration
(deleting an already-deleted id returns success).

## 2. Data layer (module pattern — mirror inventory/equipment exactly)
- `src/data/fieldLog.ts` (types), `FieldLogDataGateway.ts`, `SupabaseFieldLogDataGateway.ts`,
  `SupabaseFieldLogRepository.ts`, `QueuedFieldLogRepository.ts`, `fieldLogWriteQueue.ts`,
  `createSupabaseFieldLogServices.ts`, `SupabaseFieldLogRepository.regression.ts`.
- Offline write queue (versioned localStorage key, FIFO, canonical-echo validation,
  blocked-vs-transport) exactly like the equipment/inventory queues; wire replay into App.tsx
  at farm-ready; surface via syncStatus.ts. Idempotent replay via the operation_id receipt.

## 3. GDD (client-side, reuses Feature A weather service)
- Extend `weatherService.ts` with `fetchDailyHistory(lat, lon, startDate, endDate)` hitting
  Open-Meteo's **archive** endpoint (`https://archive-api.open-meteo.com/v1/archive` — free, no
  key; `daily=temperature_2m_max,temperature_2m_min`, fahrenheit, timezone=auto). Cache per
  (lat,lon,range). PURE `growingDegreeDays(daily, base=50)` = sum of max(0,(Tmax+Tmin)/2 - base).
- Accumulate from the field's earliest current-year `crop_assignment.planting_date` to today.
  If no location or no planting date → hide GDD with a one-line prompt. Honest offline/stale note.

## 4. UI
- New page `/field-log` (nav "Field Log"), OR fold into the Weather page as a second section —
  RECOMMENDED: a dedicated `/field-log` page for clarity, mirroring how modules register
  (read App.tsx + EquipmentTasksModule for the pattern). Per-field card: big "Add rain" and
  "Add note" (48px), the season rainfall total (tabular-nums), GDD line (if available), and a
  reverse-chronological timeline (date · 0.80 in / note text) with edit/delete for members who
  can edit. Read-only members see the log but no add/edit/delete controls (role-gated like
  equipment — thread viewer role).
- Season definition: calendar year to date (Jan 1–today) for v1; note this in the UI ("2026
  season").

## 5. Regression bar
- Repository suite driving every write kind + wrong-echo rejection, idempotent replay, farm
  isolation, entry-type/field consistency (rainfall vs note), delete idempotency, viewer-role
  fail-closed. PURE `growingDegreeDays` across cases (below/above base, negative clamp, empty).
  State the coverage-group count in the pass line.

## 6. Proof
tsc -b --force clean · build clean · regression all suites pass. Then Claude verifies hands-on
on farm-rx: log rainfall on a located field, see season total update + row in Postgres; add a
note; (if planting date present) see a GDD number; delete an entry; role-gating holds.

## Scope guards (v1)
- No radar/rain estimation from weather (farmer enters the gauge reading — it is THEIRS and
  accurate). GDD uses real historical temps, clearly labeled. No multi-year season config, no
  soil-moisture model, no evapotranspiration. Reminders are Feature E.
