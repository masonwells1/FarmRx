# TASK — Module 3 Inventory & Compliance schema DRAFT (Sol, workspace-write)

PRE-APPROVED: write ONLY the deliverables below. No database operations, no git, no src/**
changes, no app runs. DRAFTS ONLY — never applied by you.

## Mission
Design the Module 3 (Inventory & compliance) schema for Farm Rx as draft migrations 0010
(tables/views) + 0011 (RLS), following every proven convention from 0001–0009.

## Read first
- docs/farm-rx-handoff.md — Module 3 scope (inventory: chemical/seed/fertilizer purchases,
  on-hand amounts, usage; spray/application records; RUP compliance needs; what Part 7
  excludes)
- docs/crx-engines.md — CRX Manager's real inventory/compliance engine analysis (port the
  proven shapes; Farm Rx is the FARMER's own records, not the retailer's)
- supabase/migrations/0001–0009 — conventions: composite FK farm stamps, enums, immutable
  farm_id triggers, updated_at triggers, security_invoker views, can_access_farm /
  can_edit_farm helpers, RLS per table incl. rep two-part rule; note 0008's
  can_read_private_financials pattern (decide + justify whether inventory/spray records
  are financial-private or ordinary-member data — spray records are often the EMPLOYEE'S
  own work product, unlike grain)
- src/data/{fields,grain,profitability}.ts — TS contract style the UI will mirror
- Project gotchas in CLAUDE.md (crop assignments are rows; white/non-GMO corn distinct)

## Design requirements
- Product catalog (chemicals w/ EPA reg no + RUP flag, seed varieties, fertilizers) —
  farm-scoped with optional future link to CropRx's shelf (design the hook, no FK yet).
- Purchases/receipts into inventory; usage drawn by application records; derived on-hand
  via views (never stored totals that go stale).
- Application/spray records: field+crop assignment link, product+rate+total, date, weather
  at application (wind speed/direction, temp), applicator + license no, REI/PHI hours,
  RUP-compliant record completeness check (a view flagging records missing legally
  required data).
- Cost hooks: application records should be joinable to Module 4 budget cost lines later
  (0006 already carries source hooks) — keep IDs compatible, no hard FK to draft tables.
- Enums for units (gal, oz, lb, etc.) with plain conversion rules documented.

## Deliverables
1. supabase/migrations/0010_module3_inventory.sql — tables, enums, views, triggers.
2. supabase/migrations/0011_module3_rls.sql — RLS policies (state which run after 0003
   only vs which need 0008; keep it applicable without grain/profitability if possible).
3. docs/schema-module3.md — plain-English owner explainer, same style as schema-module4.md,
   including any open questions for the owner.

FINAL message: short summary + open questions. Adversarially self-check cross-farm refs,
privilege escalation, stale-total traps, and unit-conversion ambiguity before finishing.
