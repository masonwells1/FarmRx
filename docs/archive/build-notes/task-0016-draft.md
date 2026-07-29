# TASK — Draft 0016_equipment_tasks.sql (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — that is task
failure. Everything is PRE-APPROVED. Implement fully, then report.

PRE-APPROVED scope: create ONLY C:\FarmRx\supabase\migrations\0016_equipment_tasks.sql
(header comment "DRAFT ONLY — review before applying"). Do NOT touch any other file.
NO database operations, NO git.

## Mission
Implement the schema section of C:\FarmRx\docs\equipment-tasks-design.md (AUTHORITATIVE —
read it fully first): tables equipment, equipment_meter_readings,
equipment_service_intervals, equipment_service_log, farm_tasks; views
equipment_service_due and farm_member_names (both security_invoker); RPCs
generate_due_service_tasks(p_farm_id) and save_service_log_entry(...) (both SECURITY
INVOKER, single-transaction, exact-echo jsonb returns, advisory lock on farm_id like
0015's RPCs); RLS + grants; triggers.

Study the applied house style FIRST (read these files):
- C:\FarmRx\supabase\migrations\0010_module3_inventory.sql (table style, protect-history
  triggers, set_updated_at + prevent_farm_id_change reuse, check constraints)
- C:\FarmRx\supabase\migrations\0011_module3_rls.sql (RLS policy style for ordinary
  member data: is_active_farm_member / can_edit_farm / can_manage_farm helpers — use the
  helpers that EXIST in 0002; verify their names by reading
  C:\FarmRx\supabase\migrations\0002_module1_rls.sql)
- C:\FarmRx\supabase\migrations\0015_inventory_live_support.sql (RPC style: advisory
  locks, validation raise exceptions with farmer-readable messages, revoke from
  public/anon + grant execute to authenticated, exact-echo jsonb_build_object returns)

## Non-negotiable rules (every one has bitten this project)
1. Any CASE expression inside an IF/WHERE condition MUST be parenthesized:
   `if (case ... end) is distinct from x` — unparenthesized fails the parser at apply.
2. Server owns completion stamps: BEFORE trigger on farm_tasks stamps completed_by :=
   auth.uid() / completed_at := now() on transition INTO 'done' and clears both leaving
   'done' (the 0015 cancelled_by bug class — the client never supplies these).
3. Write policies per design: equipment + intervals owner/manager; readings + service
   log + tasks any active member; deletes owner/manager; readings + service log have NO
   update policy (append-only); assigned_to must be an active member of the same farm
   (trigger check).
4. Partial unique index for auto-task idempotency exactly as designed; RPC uses ON
   CONFLICT DO NOTHING and returns created count.
5. Views: security_invoker = true, and they must not leak other farms (underlying RLS
   applies — state this in comments). farm_member_names derives display_name WITHOUT
   selecting from auth.users in a way anon could exploit: security definer helper or
   view over auth.users is FORBIDDEN; instead use a SECURITY INVOKER view over
   farm_memberships joined to a small SECURITY DEFINER function get_member_display_name
   (uuid) returns text that reads auth.users email local-part, revoked from public/anon,
   granted to authenticated, stable, set search_path — and the view only exposes rows
   for farms where is_active_farm_member(farm_id). Comment the reasoning.
6. All functions: set search_path; revoke all from public, anon; grant execute to
   authenticated. All tables: enable RLS, revoke from anon.
7. No SELECT * in RPC echoes; build explicit jsonb objects (stable contracts for the
   client mappers).
8. End the file with a commented-out reviewer-test section (fixtures unconfigured
   placeholders, clearly marked DO NOT RUN) listing the manual checks a reviewer should
   run — same convention as 0015.

Static self-checks before reporting: balanced $$ blocks; every create policy names a
table that exists in this file or earlier migrations; grep your own file for
'case' inside if-conditions and confirm parentheses; php-style smoke impossible — just
read it back top to bottom once.

FINAL message: numbered summary (objects created), the static self-check results, any
deviations from the design with one-line reasons.
