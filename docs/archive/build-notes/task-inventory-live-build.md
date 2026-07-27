# TASK — Inventory LIVE swap implementation (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — task failure.
Everything PRE-APPROVED. Implement fully, then report with proof.

PRE-APPROVED scope: modify src/** and package.json. Do NOT touch supabase/migrations/**
(another agent drafts 0015 in parallel — code against the RPC contracts in the design; your
fake gateway makes regressions runnable without the SQL). No DB ops, no git, no servers.

## Mission
Implement **docs/inventory-live-design.md** (authoritative — read fully). Build the live
Inventory stack behind the UNCHANGED InventoryRepository interface, mirroring the NEWEST
proven pattern (the profitability set: SupabaseProfitabilityRepository/Gateway/queue/
services + its regression style).

Key points:
1. Gateway + SupabaseInventoryRepository: strict fail-closed mappers (microsecond+offset
   timestamps — copy the proven stamp()), farm binding everywhere; NO privacy probe
   (ordinary member data per 0011).
2. Reads: on-hand + RUP completeness come from the 0010 security_invoker views per the
   design (views are authoritative).
3. Writes per the design's classification: plain upserts w/ exact canonical confirmation
   vs the 0015 bundle RPCs (receipt bundle, application bundle) — code to the documented
   contracts. Preserve mock behaviors: received-receipt immutability (cancel-with-reason
   only), append-only adjustments, snapshots at save, unit-conversion rules (package
   factors snapshotted, volume↔weight rejected).
4. Offline queue: own versioned key, FIFO, per-write idempotency; widen syncStatus Module
   type to 'inventory' (synced only when ALL four module queues empty; retry retries all).
5. backends.ts flip inventory → 'supabase'; composition factory; practice localStorage
   data discarded by design; update the backends-manifest regression assertion.
6. Regression suite SupabaseInventoryRepository.regression.ts (profitability style):
   canonical-confirmation rejections via mutating fake for EVERY write kind incl. delete/
   cancel echoes, blocked-vs-transport, farm isolation, queue round-trips for all entry
   kinds, corrupt envelope, derived on-hand comes from view rows (fake supplies view rows),
   snapshot immutability, conversion rejection. Wire into npm run regression; all existing
   suites stay green.

Proof required (run, paste real output): `npx tsc -b --force` clean · `npm run build`
clean · `npm run regression` all 8 suites pass.
FINAL message: numbered summary (file list), proof output, deviations if any.
