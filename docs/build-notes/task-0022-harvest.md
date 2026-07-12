# TASK — Migration 0022: harvest yield support (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, then report. Do NOT apply to any DB (orchestrator applies after
review). No servers, no git commit.

## Context
Farm Rx (C:\FarmRx). Read `docs/harvest-design.md` §1 FIRST. 21 migrations applied (through 0021).
crop_assignments already has (0009) harvested_bushels, expected_yield_per_acre,
expected_price_per_bu, planted_acres, harvest_date. Match house style: read 0009 (crop_assignment
columns + save_field_bundle), 0019/0020 (receipt-idempotent save RPC pattern), and the 0017
no-`SELECT ... FOR UPDATE`-in-invoker-paths lesson. Reuse can_edit_farm.

## Deliverable — `supabase/migrations/0022_harvest.sql` (DRAFT, additive, safe after 0021)
1. `alter table public.crop_assignments add column actual_price_per_bu numeric(12,6)
   check (actual_price_per_bu is null or actual_price_per_bu >= 0);` — realized harvest price,
   SEPARATE from expected_price_per_bu (NEVER overwrite expected with actual — house rule).
2. RPC `save_crop_harvest(p_farm_id uuid, p_operation_id uuid, p_entry jsonb) returns jsonb` —
   SECURITY DEFINER, search_path public,pg_temp, receipt-idempotent (advisory lock +
   repository_write_receipts like 0019/0020; return prior result on replay). p_entry keys EXACTLY
   {crop_assignment_id, harvested_bushels, harvest_date, actual_price_per_bu}. Strict key/type
   validation. can_edit_farm gate. Verify the crop_assignment exists AND belongs to p_farm_id
   (join crop_assignments on farm_id). Update ONLY harvested_bushels (>=0 or null-to-clear),
   harvest_date (nullable, and if both planting_date and harvest_date are set enforce
   harvest_date >= planting_date to respect the existing crop_assignments_date_order check),
   actual_price_per_bu (nullable, >=0). Do NOT touch planting/acres/expected/commodity. Return the
   canonical crop_assignment row jsonb. NO FOR UPDATE (definer bypasses RLS; plain farm-scoped
   UPDATE). Grants: revoke public/anon/authenticated, grant execute to authenticated.
3. Header comment: what/additive-safe/0017 note/the interaction with save_field_bundle (both can
   write harvested_bushels; last-write-wins is acceptable and documented; save_crop_harvest is a
   focused quick-entry path).

## Self-review (adversarial)
Can a non-member/read_only/rep write? Can a worker on another farm update a crop_assignment (the
farm-scope join must prevent it)? Does clearing to null work? Does the date-order check interact
safely (a harvest_date before an existing planting_date must raise, not corrupt)? Receipt
idempotency race. Anything that could break applied 0001-0021 or save_field_bundle. Findings+fixes.

## Report
`git status` (only 0022 created). Paste the FULL 0022 text. Confirm you touched only
`supabase/migrations/0022_harvest.sql`. Note the save_field_bundle interaction. Deviations.
