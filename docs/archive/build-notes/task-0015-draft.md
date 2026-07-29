# TASK — Draft migration 0015 inventory live support (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — task failure.
Everything PRE-APPROVED. Write the deliverable, then report.

PRE-APPROVED scope: write ONLY supabase/migrations/0015_inventory_live_support.sql.
DRAFT ONLY — never applied by you. No other files, no DB ops, no git.

## Mission
Write 0015 exactly as specified by **docs/inventory-live-design.md** (its migration-0015
section is authoritative: the atomic receipt-bundle and application-bundle RPCs plus any
database-enforced conversion/cost-snapshot safeguards it lists).

## Standards (match the applied siblings — read them)
- 0012/0013/0014 conventions: SECURITY DEFINER, set search_path = public, pg_temp,
  auth.uid() required, authorization helpers per the design (inventory is ordinary member
  data → can_edit_farm; NO can_read_private_financials gate unless the design says
  otherwise), advisory xact locks, validate-all-then-write, idempotent replay, client
  timestamps rejected, REVOKE public/anon + GRANT authenticated, companion reviewer-test
  section honestly labeled as not-run.
- Must apply cleanly right after applied 0014 against the real 0010/0011 tables (read them
  for exact names/constraints/triggers).

## CRITICAL SYNTAX RULES (each cost us a failed round today)
1. PL/pgSQL parses an IF condition only to the first top-level `then` — any CASE inside an
   IF condition MUST be parenthesized `(case ... end)`. Prefer avoiding CASE entirely.
2. Check every conditional before finishing.

## Adversarial self-check
Cross-farm refs, privilege escalation, partial-commit windows, replay/receipt races,
received-receipt immutability preserved (no RPC path that mutates a received receipt except
audited cancel), unit-conversion safeguards can't be bypassed, snapshots immutable.

FINAL message: short summary + exact function signatures.
