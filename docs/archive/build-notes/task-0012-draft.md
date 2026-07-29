# TASK — Draft migration 0012 grain live support (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — that is a task
failure. Everything here is PRE-APPROVED. Write the deliverable, then report.

PRE-APPROVED scope: write ONLY supabase/migrations/0012_grain_live_support.sql and a short
plain-English section appended to docs/grain-live-design.md if needed. No other files, no
database operations, no git.

## Mission
Write `supabase/migrations/0012_grain_live_support.sql` exactly as specified by
docs/grain-live-design.md section "Draft migration 0012" (read it first): the atomic,
idempotent marketing-plan replacement RPC. Requirements:
- Applies cleanly right after the applied 0011 on the real farm-rx schema (0001–0011 are
  ALL applied — read 0004/0005 for the real grain table/column names and RLS helpers).
- SECURITY DEFINER, set search_path = public, pg_temp; binds caller to auth.uid(); requires
  the appropriate edit permission via existing helpers; validates every row against the
  target farm; never trusts farm_id/user_id inside the payload.
- Replaces the marketing-plan rows for one scope (farm + crop year + commodity + entity
  scope as the design defines) in ONE transaction as a complete desired state; idempotent
  under replay (same payload → same end state, no duplicates); advisory lock against
  concurrent replacement of the same scope.
- Explicit REVOKE from public/anon; GRANT EXECUTE only to authenticated.
- Follow every proven convention from 0009's save_field_bundle (the closest sibling).
- Adversarial self-check: cross-farm refs, privilege escalation, partial-commit windows,
  replay races.

FINAL message: short summary + the exact RPC signature.
