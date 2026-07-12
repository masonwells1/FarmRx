# Feature D — Harvest yield tracking (design)

Fourth feature of the customer-value batch. Defers to the three handoff rules. Plain English,
18px base, 48px targets, tabular-nums, two-tap. Builds on existing Fields/crop_assignments data.

## What the farmer gets
At harvest, per field + crop, enter **actual bushels** (and harvest date). The app shows:
- **Actual yield/acre** (harvested_bushels ÷ planted_acres) vs the **expected** yield → a plain
  "+8 bu/ac over plan" / "−12 bu/ac under plan".
- **Actual revenue** at a price (actual sale price if entered, else the expected price) — feeds
  the Profitability page (which already reads crop_assignments).
- **Yield history** per field across years — the multi-year record crop insurance (APH) and FSA
  ask for every year, in one place.

## 1. Schema — migration 0022 (Sol drafts; review gate before apply)
crop_assignments ALREADY has (from 0009): `harvested_bushels`, `expected_yield_per_acre`,
`expected_price_per_bu`, `planted_acres`, `harvest_date`. So most data exists. Additions:
- Add `actual_price_per_bu numeric(12,6)` (nullable, >= 0) to crop_assignments — the realized
  price for harvest revenue, distinct from expected_price_per_bu (never overwrite expected with
  actual — house rule). Optional; UI can leave null and fall back to expected for the estimate.
- A focused, receipt-idempotent RPC `save_crop_harvest(p_farm_id uuid, p_operation_id uuid,
  p_entry jsonb)` where p_entry = {crop_assignment_id, harvested_bushels (>=0 or null to clear),
  harvest_date (nullable), actual_price_per_bu (nullable)}. SECURITY DEFINER, can_edit_farm gate,
  verifies the crop_assignment belongs to the farm, updates ONLY those harvest columns (leaves
  planting/acres/expected untouched), returns the canonical row. This gives a light quick-entry
  path + offline queue WITHOUT routing the whole field bundle through save_field_bundle. Follow
  the 0017 no-FOR-UPDATE lesson + repository_write_receipts idempotency (like 0019/0020).
  (Sol: confirm whether a plain column update under can_edit_farm is enough, and that this does
  not conflict with save_field_bundle's crop-assignment ownership of the same rows — document the
  interaction: both may write harvested_bushels; last-write-wins is acceptable, but note it.)
Access: read via existing crop_assignments RLS (members); write via the RPC (owner/manager/
worker). No new table.

## 2. Data layer + UI
- Data layer mirrors the module pattern (types, gateway, repository, queued, writeQueue,
  services, regression). getData reads fields + crop_assignments for the farm (reuse the Fields
  repository/services for the field + assignment list); the harvest write goes through
  save_crop_harvest with an offline queue (receipt-idempotent replay). syncStatus key 'harvest'.
- UI: new page `/harvest` (nav "Harvest"). Per field, list this year's crops with: planted acres,
  expected yield, an **"Enter harvest"** action (bushels + date + optional price). On save show
  actual yield/acre, delta vs expected (color: over/under), and actual revenue. A **yield-history**
  strip per field: year · crop · bu/ac (last several years) — the APH view. Role-gated (read_only
  view-only). Season = current crop_year default, with a year selector. tabular-nums everywhere.

## 3. Regression + proof
Suite: save_crop_harvest write + wrong-echo rejection, idempotent replay, clear-to-null,
farm isolation, role fail-closed, actual-vs-expected + yield/acre math (pure), never-overwrite-
expected. State group count. PROOF: Claude verifies on farm-rx — enter harvested bushels on a
North Quarter crop, see yield/acre + delta vs expected, confirm harvested_bushels + harvest_date
(+ actual_price) in Postgres and that expected columns are untouched; yield history renders;
role-gate holds.

## Scope guards (v1)
- No scale-ticket/load-by-load capture (handoff open question — out unless asked), no moisture/
  shrink adjustment, no grain-cart integration. Reminders are Feature E. Never overwrite
  expected_* with actual values.
