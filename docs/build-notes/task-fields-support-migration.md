# TASK — Fields live-swap support migration DRAFT (Sol, workspace-write)

PRE-APPROVED: write ONLY the files listed under Deliverables. No database operations, no git,
no app runs. DRAFT ONLY — never applied by you.

## Mission
Draft `supabase/migrations/0009_fields_live_support.sql`: the additive migration that closes
the gap between the APPLIED Module 1 schema and the current Fields UI contract, exactly as
specified in docs/foundation-design.md section "Non-negotiable implementation gates".
This migration is designed to be applied DIRECTLY AFTER the applied 0001–0003 set
(it must NOT depend on drafts 0004–0008 in any way — grain/profitability tables do not exist).

## Read first
- docs/foundation-design.md — the authoritative spec for this migration (columns table,
  repository_write_receipts, save_field_bundle RPC contract, security requirements)
- supabase/migrations/0001*.sql, 0002*.sql, 0003*.sql — the APPLIED baseline you extend;
  reuse its exact conventions (helper functions, composite FK farm stamps, trigger patterns)
- src/data/MockFieldsRepository.ts + src/data/index.ts — the TypeScript contract the RPC
  must round-trip (FieldDraft in, canonical Field/Arrangement/CropAssignment rows out)
- src/data/MockFieldsRepository.regression.ts — behaviors the RPC must make possible
  (same-date arrangement edit in place, later-date close+insert, earlier-date reject,
  crop-assignment ID preservation, empty-array = no assignment change, affected-years-only)

## Deliverables
1. `supabase/migrations/0009_fields_live_support.sql` containing:
   - The five additive columns from the design gates table (landlord_phone,
     landlord_contact_notes on arrangements; harvested_bushels, expected_yield_per_acre,
     expected_price_per_bu on crop_assignments) with the stated types/checks.
   - `public.repository_write_receipts` per the design (composite farm FK convention,
     RLS enabled, no direct client writes).
   - `public.save_field_bundle(p_farm_id uuid, p_operation_id uuid, p_draft jsonb)
     returns jsonb` — SECURITY DEFINER, `set search_path = public, pg_temp`, binds caller
     to auth.uid(), requires the caller's edit permission via the existing helper from 0002,
     validates every parent row against p_farm_id, never trusts farm_id/user_id inside
     p_draft, performs the whole field+arrangement+crop-assignments save in ONE transaction,
     enforces the arrangement history rules and crop-assignment rules listed in the design,
     writes a receipt, and returns the SAME stored result when the same operation id is
     replayed (idempotent).
   - Explicit REVOKE from PUBLIC and anon; GRANT EXECUTE only to authenticated.
2. `docs/schema-fields-support.md` — plain-English owner explainer, same style as
   docs/schema-module4.md: what the migration adds, why the one-transaction save + receipt
   protects farmers on bad signal, and confirmation it only ADDS (no existing data touched).

## Hard constraints
- Additive only: no ALTER of existing columns, no drops, no data rewrites.
- Zero references to grain/profitability objects (0004–0008 may be applied later; this
  file must run cleanly right after 0003 on the current live schema).
- Adversarial self-check before finishing: SQL-injection surface in the RPC's jsonb
  handling, privilege escalation, cross-farm reference attacks, replay/receipt races
  (concurrent same-operation-id calls), partial-commit windows.
- FINAL chat message: short summary + any risks you could not close.
