PRE-APPROVED TASK — do NOT ask for confirmation; EXECUTE end-to-end.

# Task: Module 4 Profitability — schema DRAFT (migrations 0006 + 0007, DO NOT APPLY)

Work in C:\FarmRx. Read FIRST: docs/farm-rx-handoff.md (Module 4 spec, Part 4), docs/crx-engines.md §3.5 (the 12 RLS rules — follow them exactly), supabase/migrations/0001-0005 (your base: farms/memberships/rep-access/entities/fields/commodities/crop_assignments/arrangements + grain tables), docs/competitor-farmprofitmanager.md (Module 4 ADOPT items), docs/GOAL.md Module 4 entry.

Draft TWO files (do not apply anything to any database):
- supabase/migrations/0006_module4_profitability.sql — tables for: input cost lines per crop budget (seed/chem/fert/fuel/repairs/labor/land/custom categories; per-acre amounts; "copy from another budget" implies budgets are first-class rows keyed by farm+crop_year+commodity+optional entity/enterprise), yield/price scenarios for the PROFITABILITY MATRIX (price steps x yield steps), breakeven outputs derivable (breakeven PRICE and breakeven YIELD both — store inputs, compute via view), arrangement-comparison support reusing fields.arrangements (equivalent-cash-rent normalization needs no new table if a view can join arrangements+budgets — decide and justify), cost/acre by field allocation. Follow existing conventions: farm_id stamps + composite FKs (id, farm_id), prevent_farm_id_change triggers, updated_at triggers, unique nulls not distinct where scoping keys are optional.
- supabase/migrations/0007_module4_rls.sql — RLS mirroring 0002/0005: active-member read, can_edit_farm write, rep read via BOTH share_with_rep AND farm_rep_access, security_invoker views, helper functions already exist — reuse, don't redefine.

Also write docs/schema-module4.md — plain-English owner explainer in the same voice as docs/schema-module2.md (what each table does, how privacy works, decisions I made and why).

Financial-data caution: budgets/costs are as private as grain — same RLS strictness. Employees must be excludable from financials later (note the hook, same as grain privacy fix planned in GOAL.md FOUNDATION BLOCK).

Validate SQL syntax mentally against Postgres 17; no ALTER of applied tables 0001-0003 (those are LIVE); 0004/0005 are drafts — if you must reference grain tables, guard with IF EXISTS or sequence a comment noting 0004 must apply first.

FINAL message = a short build report (files written, key decisions, open questions for the owner).
