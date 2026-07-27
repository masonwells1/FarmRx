# TASK — Fix 0012 per review (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — task failure.
PRE-APPROVED. Edit ONLY supabase/migrations/0012_grain_live_support.sql. No DB ops, no git,
no src/**.

Fix these findings from docs/review-grain-live.md (full text there):

1. **Finding 2 (P1)**: the SECURITY DEFINER RPC lets can_edit_farm users (workers) receive
   marketing-plan rows even when 0008's can_read_private_financials denies them grain reads.
   Require BOTH can_edit_farm(p_farm_id) AND can_read_private_financials(p_farm_id) before
   any read or write. Document the rule in a comment.
2. **Finding 1 (P1), contract side**: the agreed contract is that each JSON target row
   INCLUDES farm_id and the function validates it equals p_farm_id (raise on mismatch —
   never trust it as the tenant stamp). Make sure 0012 cleanly accepts complete normalized
   rows (id, farm_id, scope columns, target_month, target_pct_of_production, target_price,
   breakeven_relative_pct, deadline, notes) while ignoring/rejecting client timestamps.
3. **Finding 14 (P2), SQL side**: percentage-total tolerance must be exactly 100.000001
   (match the repository); convert the comment-only acceptance cases into a short
   executable DO-block self-test at the end of the migration that raises on failure
   (running entirely inside the migration transaction against temp data is NOT possible
   with RLS-bound helpers — if a true self-test cannot run at migration time, instead
   write the test cases as a clearly labeled companion section with exact SQL a reviewer
   can run, and say so in your final message).

FINAL message: what changed, the final RPC authorization rule, and the exact tolerance.
