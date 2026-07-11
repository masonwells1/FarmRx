# TASK — Grain LIVE repository swap design (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait for approval —
that is a task failure. Everything here is PRE-APPROVED. Write the deliverables, then report.

PRE-APPROVED scope: write ONLY docs/grain-live-design.md. No src changes, no migrations,
no database operations, no git.

## Context (verified 2026-07-11 evening — trust this)
- ALL migrations 0001–0011 are APPLIED to the farm-rx database (grain tables exist:
  production_estimates, grain_contracts, marketing_plan_targets, storage_bins, basis
  history, usda report dates — read 0004/0005 for exact names/shapes).
- Fields is already LIVE end-to-end: SupabaseFieldsRepository + FieldsDataGateway +
  QueuedFieldsRepository (offline write-queue) + save_field_bundle RPC — study these as
  the proven pattern (src/data/SupabaseFields*.ts, QueuedFieldsRepository.ts, writeQueue.ts).
- Grain UI runs on MockGrainRepository (src/data/MockGrainRepository.ts) implementing
  GrainRepository (src/data/grain.ts) with an injected FieldsRepository; backends.ts
  gates the swap ('grain: mock' → 'supabase' must be the release flip).
- 0008 employee privacy is applied: grain reads are owner/manager/granted-member only.

## Mission
Write docs/grain-live-design.md — the implementation blueprint for Terra to build
SupabaseGrainRepository (+ gateway + queue integration) behind the unchanged GrainRepository
interface. Cover:
1. **Gateway + repository structure** mirroring the Fields pattern (fakeable gateway,
   strict row mappers fail-closed on unknown enums/non-finite numbers, farm binding).
2. **Write path per repository method** (production estimates, contracts, targets/plan
   grid, bins, settings): which are single-row upserts vs multi-row bundles; whether a
   transactional RPC (like save_field_bundle) is needed anywhere or plain PostgREST
   writes suffice per method — justify each; specify a draft migration 0012 ONLY if a
   transactional save or missing column is genuinely required (list its exact contents;
   do not write the SQL file).
3. **Offline queue**: extend the proven write-queue to grain writes (separate key,
   same FIFO/receipt-or-idempotency rules — state what idempotency mechanism each write
   uses without a receipts RPC, e.g. client-generated IDs + upsert semantics).
4. **Mock→live data migration**: the owner's practice grain entries in localStorage are
   TEST data — design says discard on swap (state this plainly) unless trivially portable.
5. **USDA MARS basis feed** (handoff 2.6 + docs/futures-feed-research.md): which endpoint,
   polling cadence, storage (basis history table from 0004), and how it stays display-only
   vs feeding basis defaults; error/offline behavior.
6. **Alerts** (handoff 2.6, owner-only email v1): what fires them (target hit vs report
   date), where evaluation runs (client-side v1 vs edge function later) — recommend the
   smallest honest v1.
7. **Regression plan**: network-free contract suite checks list (like the 15-check Fields
   suite) + one-time live manual checks.
8. **Plain English for Mason** section at top: what changes, what stays, what test data
   disappears.

FINAL message: 5-line summary + whether migration 0012 is needed.
