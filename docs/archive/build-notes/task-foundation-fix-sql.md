# TASK — Fix 0009 per review findings (Sol, workspace-write)

PRE-APPROVED: edit ONLY supabase/migrations/0009_fields_live_support.sql and
docs/schema-fields-support.md. No database operations, no git, no src/** changes.
Draft remains DRAFT ONLY.

## Fix these findings from docs/review-foundation.md
1. **Finding 3 (P1)** — save_field_bundle accepts stale crop-assignment IDs as new inserts.
   Change the draft contract: each crop assignment in p_draft carries `"is_new": true|false`.
   is_new=false → the ID MUST resolve to this field+farm or raise. is_new=true → the ID must
   NOT already exist anywhere or raise. No fall-through insert for unresolved existing IDs.
2. **Finding 13 (P2)** — repository_write_receipts membership FK `on delete restrict` blocks
   member removal forever. Redesign actor provenance so receipts never block membership
   lifecycle (e.g. drop the composite membership FK, keep farm FK cascade, keep user_id as a
   plain uuid stamp — justify your choice in a comment; do not weaken the same-farm guarantee
   for RESULT data, which is farm-keyed regardless).
3. **Finding 4 (P1), server side** — add an idempotent first-farm bootstrap RPC to 0009:
   `public.bootstrap_first_farm(p_farm_name text, p_entity_name text, p_entity_type text)
   returns jsonb` — SECURITY DEFINER, set search_path = public, pg_temp; requires auth.uid();
   takes pg_advisory_xact_lock keyed on the caller's uid; if the caller already has ANY
   membership (any status), return the existing farm+first entity as jsonb WITHOUT creating
   anything (idempotent); otherwise create farm (created_by = auth.uid(), share_with_rep
   false; the 0002 trigger creates the owner membership) AND the first entity in the same
   transaction; return jsonb {farm, entity}. Validate/trim names non-empty; validate entity
   type against the real enum. REVOKE from public/anon, GRANT EXECUTE to authenticated.
   The client (fixed in parallel by another agent) will call ONLY this RPC for bootstrap —
   document the exact contract in docs/schema-fields-support.md.

## Constraints
- 0009 must still run cleanly right after applied 0003 with zero references to 0004–0008 objects.
- Additive only; keep all existing security properties (locks, receipts idempotency, grants).
- Update docs/schema-fields-support.md (plain English) for all three changes.
- FINAL message: short summary of the three fixes + exact RPC contracts.
