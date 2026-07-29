# TASK — Feature D build: Harvest yield tracking (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, then report with proof. Do NOT git commit. Do NOT run a dev
server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

## Read first
`docs/harvest-design.md` (authoritative) + `docs/design-brief-codex.md`. Mirror the field-log
module pattern (`src/data/fieldLog.ts`, `SupabaseFieldLogRepository.ts`, queue, services,
regression) and reuse the Fields repository/services for the field + crop-assignment list.

## Database is READY (migration 0022 applied)
crop_assignments now also has `actual_price_per_bu numeric(12,6)`. RPC:
`save_crop_harvest(p_farm_id uuid, p_operation_id uuid, p_entry jsonb) returns jsonb` —
receipt-idempotent. p_entry MUST have EXACTLY these 4 keys every call (send null for blanks):
`{crop_assignment_id, harvested_bushels, harvest_date, actual_price_per_bu}`. It updates ONLY
those harvest columns (never planting/acres/expected/commodity), enforces harvested_bushels>=0,
actual_price_per_bu>=0, harvest_date>=planting_date, and returns the canonical crop_assignment
row. Writes gated owner/manager/worker. Existing crop_assignments already carry harvested_bushels,
expected_yield_per_acre, expected_price_per_bu, planted_acres, planting_date, harvest_date.

## Build
### 1. Data layer (mirror field-log)
`src/data/harvest.ts` (types incl. a HarvestDraft with all 4 RPC keys), `HarvestDataGateway.ts`,
`SupabaseHarvestDataGateway.ts`, `SupabaseHarvestRepository.ts`, `QueuedHarvestRepository.ts`,
`harvestWriteQueue.ts`, `createSupabaseHarvestServices.ts`,
`SupabaseHarvestRepository.regression.ts`. getData reads the farm's fields + crop_assignments
(reuse Fields services). One write kind `saveHarvest` → save_crop_harvest; ALWAYS send all 4
keys (null for empties). Offline queue like field-log (versioned key, FIFO, canonical-echo
validation — echoed row id/farm_id match + harvested_bushels/harvest_date/actual_price_per_bu
equal what was sent with 6dp/2dp normalization as needed; idempotent replay SAME operation_id;
blocked-vs-transport). Wire replay into App.tsx at farm-ready AFTER Fields replay. syncStatus
key 'harvest'. NEVER write expected_* — they are read-only here.

### 2. UI — new page `/harvest` (nav "Harvest"), mirror module registration
Per field, a card listing the CURRENT crop_year's crop assignments (year selector to see prior
years). Each crop row: commodity name, planted acres, expected yield/ac (if set). An **"Enter
harvest"** action opens a small form: harvested bushels, harvest date (default today, min =
planting_date if known), optional actual price/bu. On save show:
- **Actual yield/ac** = harvested_bushels / planted_acres (tabular-nums).
- **Delta vs expected** = actual − expected yield/ac, colored (green over / red under), plain
  words ("+8 bu/ac over plan" / "12 bu/ac under plan" / "no expected yield set" if expected null).
- **Actual revenue** = harvested_bushels × (actual_price_per_bu ?? expected_price_per_bu ?? —);
  label whether it used actual or expected price; blank honestly if neither.
- A **yield-history** strip per field: prior years' year · commodity · bu/ac (APH view), from the
  crop_assignments that have harvested_bushels. Role-gated: read_only view-only (no Enter harvest).
Calm loading/empty/error; never blank; no medical metaphor in nav; 18px/48px/tabular-nums; 375px
no page overflow.

### 3. Regression (`SupabaseHarvestRepository.regression.ts`)
Fake gateway drive: saveHarvest write + wrong-echo rejection; idempotent replay (SAME op id;
different echoed id fails); clear-to-null; farm isolation; role fail-closed; the 4-key contract
(a draft missing a key or with an extra key must be rejected before send / by the fake);
PURE yield/ac + delta-vs-expected + revenue math (over/under/none, null expected, actual-vs-
expected price fallback, never-overwrite-expected). State the coverage-group count. Register in
package.json.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with
the new harvest suite (state its group count). FINAL: per-item confirmation, proof output,
`git status`, deviations. Do NOT commit — orchestrator reviews + browser-verifies.
