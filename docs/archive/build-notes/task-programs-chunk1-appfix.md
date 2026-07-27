# TASK — FIX (Sol, complex/cross-module): mark_program_pass_applied vs inventory invariants

CRITICAL EXECUTION RULE: headless, no human. PRE-APPROVED. Decide + implement fully, edit the file,
report. Do NOT apply SQL, connect to a DB, deploy, or commit. Edit the DRAFT
`C:\FarmRx\supabase\migrations\0024_programs.sql` in place. You MAY read any file.

## The runtime conflict (found by applying 0024 to TEST and calling the RPC for real)
`mark_program_pass_applied` (p_create_application_record=true) inserts an `application_records` row
with `status='completed'` and NO `application_products`. The EXISTING inventory trigger
`public.protect_application_history()` (migration 0010, lines 719+) forbids this two ways:
1. INSERT must be `status='draft'` → error "an application record must be created as a draft".
2. A draft may become `completed` ONLY if it has >=1 `application_products` row (line 772) → error
   "an application needs at least one product before completion".
Programs products are FREE-TYPE and deliberately create NO `application_products` (no inventory
posting). So a Program-created COMPLETED, product-less application record is IMPOSSIBLE under the
current inventory contract. Your own design flagged this (P1-7 + the Chunk-5 "prove zero-product
renders safely or fall back to link-only" note).

## Decision needed (this is a real design call — pick the best, justify, note the alternative)
Reconcile the "Applied → application_records" seam with the inventory invariants for V1, WITHOUT
weakening `protect_application_history` and WITHOUT posting/faking inventory. Two viable options:

**Option A (my recommendation): the create path creates the record as `draft` and leaves it draft.**
- Insert the application_records header as `status='draft'` (allowed; product-less draft is legal and
  is NOT posted to on-hand). Do not transition it to completed. Link it via
  `assigned_program_passes.application_record_id`. The pass still becomes `applied` in the Programs
  domain with its own actual free-type product snapshots (the honest record of what was applied).
- Result view `program_application_products` keeps `inventory_matched=false`; the linked record shows
  as an un-posted draft ("not matched to inventory — on-hand unchanged"). Honest, no invariant broken.

**Option B: drop server-side record creation for V1 (link-existing only).**
- `mark_program_pass_applied` marks the pass `applied` and, if `p_application_record_id` is provided,
  links an EXISTING record for the same farm+crop; it never inserts a new application_records row.
  "Create a real record" becomes a later UI action that opens the Inventory create form (design's
  stated fallback). Simpler, but loses the one-tap "record it" convenience.

Pick A unless you see a correctness reason B is safer. Whichever you choose:
- Marking the pass `applied` must NEVER be blocked by the application-record step — a farmer can mark
  applied with NO record at all (p_application_record_id null), capturing only the actual free-type
  products. Confirm that path works.
- When LINKING an existing record, keep the farm+crop match check. Decide whether a linked existing
  record may be draft or must be completed; state the rule (lean: any non-voided record for that
  farm+crop).
- Keep exact write scope, receipt-idempotency, advisory locks, no FOR UPDATE. Do NOT alter the
  inventory module or its trigger.

## Also
- Scan the OTHER new RPCs for any similar cross-module write that would trip an EXISTING trigger
  (application_records, application_products, inventory ledgers, farm_tasks completion trigger). Only
  `mark_program_pass_applied` touches application_records, but confirm skip/unassign/reschedule/
  refresh only touch program tables + farm_tasks and won't surprise an existing trigger.
- Update `programs-design.md` (the Applied→application_records section + P1-7) to record the chosen V1
  behavior. Update `programs-chunk1-proof-plan.md` mark-applied cases to match (create→draft or
  link-only), and ensure a case proves on-hand is unchanged and the pass can be applied with no record.

## Report
State A or B and why, the exact changed lines in `mark_program_pass_applied`, and confirm the "apply
with no record" and "link existing" paths. Note that Opus will apply the corrected function to TEST
as `CREATE OR REPLACE` and re-run the behavioral proof. Do NOT apply, deploy, or commit.
