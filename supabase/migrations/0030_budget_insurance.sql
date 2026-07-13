-- DRAFT ONLY — review before applying.
-- PostgreSQL 17 / Supabase. Do not apply without the human review gate.
-- Depends on 0006 (crop_budgets), 0007 (profitability RLS), and 0008
-- (can_read_private_financials). The existing crop_budgets RLS is unchanged.

-- Revenue Protection inputs are optional. A budget without all four values
-- remains a valid non-insurance budget; application math decides when the
-- calculator has enough inputs to show an insurance result.
alter table public.crop_budgets
  add column rp_coverage_pct numeric(5, 2),
  add column rp_aph_yield numeric(12, 4),
  add column rp_projected_price numeric(12, 6),
  add column rp_premium_per_acre numeric(14, 4),
  add constraint crop_budgets_rp_coverage_pct_range check (
    rp_coverage_pct is null or rp_coverage_pct between 50 and 95
  ),
  add constraint crop_budgets_rp_aph_yield_positive check (
    rp_aph_yield is null or rp_aph_yield > 0
  ),
  add constraint crop_budgets_rp_projected_price_positive check (
    rp_projected_price is null or rp_projected_price > 0
  ),
  add constraint crop_budgets_rp_premium_per_acre_nonnegative check (
    rp_premium_per_acre is null or rp_premium_per_acre >= 0
  );
