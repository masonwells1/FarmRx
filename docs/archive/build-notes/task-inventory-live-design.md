# TASK — Inventory LIVE repository swap design (Sol, workspace-write)

CRITICAL EXECUTION RULE: You are headless with NO human available. Never present a plan and
wait for approval — that is a task failure. Everything here is PRE-APPROVED. Write the
deliverable, then report.

PRE-APPROVED scope: write ONLY docs/inventory-live-design.md. No src changes, no migrations,
no database operations, no git.

## Context (verified — trust this)
- ALL migrations 0001–0014 are APPLIED to the farm-rx database. Inventory tables exist per
  0010 (products, receipts + receipt lines, inventory adjustments, application records +
  application products, delivery events, and the 4 security_invoker views incl. derived
  on-hand and RUP completeness) with RLS per 0011 (ordinary-member operational data —
  can_access_farm reads, can_edit_farm writes, NO 0008 financial gate). Read 0010/0011 for
  exact shapes.
- Fields, Grain, AND Profitability are live. The NEWEST conventions to mirror are the
  profitability set: src/data/SupabaseProfitabilityRepository.ts + gateway + queue +
  createSupabaseProfitabilityServices.ts + its regression suite (strict mappers accepting
  microsecond+offset timestamps, canonical confirmation with exact id/scope match before
  queue-head removal, blocked-vs-transport classification, per-module syncStatus — widen
  the Module type to add 'inventory').
- Inventory UI runs on src/data/inventory.ts (MockInventoryRepository) implementing
  InventoryRepository with injected FieldsRepository; backends.ts gates the flip.
- The mock's proven behaviors that MUST survive: on-hand ALWAYS derived (never stored),
  received receipts immutable (cancel-with-reason only), append-only adjustments,
  regulatory/cost snapshots copied at save, unit conversions only where physically
  unambiguous (package factors snapshotted; volume↔weight rejected).

## Blueprint must cover
1. Gateway + repository structure; strict fail-closed mappers; farm binding; NO privacy
   probe needed (inventory = ordinary member data per 0011 — state this).
2. Write path per repository method: product create/edit, receipt draft/receive/cancel,
   adjustments, application records (multi-row: record + N products — likely needs a
   transactional RPC like save_field_bundle; decide and specify migration 0015's EXACT
   contract if required: which writes, signatures, validation, idempotency; do not write
   the SQL).
3. On-hand and RUP-completeness reads: use the 0010 security_invoker views directly
   (they are the source of truth — unlike profitability the views here are already
   correct and unblocked; justify using them vs client-side recompute).
4. Offline queue integration: own key, FIFO, idempotency per write; where receive/cancel
   ordering matters offline.
5. Mock→live: practice inventory data discarded on flip (state plainly).
6. Regression plan (profitability-suite style checklist) + one-time live manual checks.
7. "Plain English for Mason" section at top.

FINAL message: 5-line summary + whether migration 0015 is needed and exactly what for.
