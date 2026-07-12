# TASK — Harden the inventory regression suite (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — that is task
failure. Everything is PRE-APPROVED. Implement fully, then report with proof.

PRE-APPROVED scope: modify ONLY `C:\FarmRx\src\data\SupabaseInventoryRepository.regression.ts`.
Do NOT touch any other file. No DB ops, no git, no servers.

## Why
An adversarial review found the current suite asserts around the write contract instead of
exercising it: FakeGateway.saveReceiptBundle/cancelReceipt/insertAdjustment/saveApplicationBundle
all throw 'not used', queue entries use stub shapes, `rup_completeness` fixtures are empty.
That is exactly why two real P1 bugs slipped through. Your job: make the fake gateway echo
canonical rows and drive every write end-to-end.

## Context — two production fixes your tests must lock in
1. `operationalTokens` in `C:\FarmRx\src\data\SupabaseInventoryRepository.ts` is now EXACTLY:
   application_time, target_pest, wind_speed, wind_direction, temperature, relative_humidity,
   application_rate, rate_total_mismatch, rate_exceeds_snapshotted_label_maximum, rei_hours,
   phi_hours. (`label_rate_exceeded` no longer exists; federal tokens are NOT allowed in the
   operational array.)
2. Cancelling a received receipt: the server (a new 0015 trigger) sets `cancelled_by` to the
   acting user. Your fake gateway must emulate the server: when cancelReceipt is called it
   returns the canonical cancelled receipt row with `cancelled_by` set to a valid uuid,
   `cancelled_at`/`cancellation_reason` echoed, status 'cancelled'.

## Required new coverage (keep all existing passing checks)
Study the proven style in `C:\FarmRx\src\data\SupabaseProfitabilityRepository.regression.ts`
and the code under test in `C:\FarmRx\src\data\SupabaseInventoryRepository.ts`,
`C:\FarmRx\src\data\QueuedInventoryRepository.ts`, `C:\FarmRx\src\data\inventoryWriteQueue.ts`,
`C:\FarmRx\src\data\InventoryDataGateway.ts`. Then add, with a stateful fake gateway that
echoes exact canonical rows (correct 8/10/21/10-key shapes, microsecond+offset timestamps):
1. Receipt lifecycle end-to-end: receiveReceipt (draft and received), editReceipt on a draft,
   cancelReceipt on a received receipt succeeds against the emulated server behavior; the
   repository's confirmation passes. A fake that echoes a WRONG line quantity, wrong status,
   or wrong reason must be rejected (canonical-confirmation failure).
2. Cancel regression: a fake that returns the cancelled row with `cancelled_by: null` must be
   REJECTED by the mapper (this is the exact bug class that shipped).
3. addAdjustment end-to-end + wrong-echo rejection.
4. Multi-product saveApplication (2+ products, mixed rate bases) end-to-end + wrong-echo and
   missing-product-echo rejection.
5. RUP token mapping: workspace load with `rup_completeness` rows whose
   missing_farm_rx_operational_fields include rei_hours, phi_hours, and
   rate_exceeds_snapshotted_label_maximum must SUCCEED (this exact fixture crashed the real
   screen before the fix); a row containing an unknown token like 'label_rate_exceeded' must
   fail closed.
6. Idempotent replay: enqueue a write, replay it twice; the second replay's exact echo is
   accepted, and a conflicting echo is blocked (not retried forever).
7. Unit-conversion safety through a real write: volume→weight rejected; package factor path
   accepted with snapshotted factor.
8. Startup replay contract: exported replay function exists and drains a queued entry via the
   fake without a workspace load first.

Every fixture must satisfy the strict mappers (all keys present, valid uuids/enums/stamps) —
build one canonical fixture factory and derive variations from it.

## Proof required (run, paste real output)
- `npx tsc -b --force` (from C:\FarmRx) clean
- `npm run build` clean
- `npm run regression` — ALL suites pass (the count printed).

FINAL message: numbered list of coverage added, proof output, any deviations.
