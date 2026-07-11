Implemented the source-side grain-live fixes.

1. Fixed RPC targets to retain `farm_id`; added canonical single-save and full-plan confirmation.
2. Fixed Grain queue parsing, pre-write validation, strict dates/timestamps, all four entry round-trips, offline replay preservation, and expanded regressions.
3. Aggregated Fields + Grain sync status/retry actions.
4. Added privacy probe and farmer-English denial message; added first-estimate editor.
5. Excluded USDA MARS bids from position/revenue basis math; added stale-feed notice.
6. Fail-closed enterprise-label reconciliation and shared `100.000001` tolerance.
7. Added `supabase/functions/deliver-grain-alert/index.ts` with owner verification, canonical rereads, fixed recipient, sanitization, throttling, and failure logging.
8. Added client in-flight alert serialization and calm delivery-failure notice.

Proof (real output):

```text
tsc --noEmit: clean
vite build: ✓ built in 1.18s
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
SupabaseFieldsRepository regressions passed.
SupabaseGrainRepository regressions passed.
MockProfitabilityRepository regressions passed.
MockInventoryRepository regressions passed.
```

Deviations:

- `npm run build`, `npx tsc --noEmit`, and `npm run regression` could not launch because this machine’s npm/npx shim points to a missing global `npm-cli.js`. I ran the exact local equivalents successfully (`node_modules/.bin/tsc`, `vite`, `tsx`).
- P1 #2’s `SECURITY DEFINER` RPC privacy bypass remains a migration-level fix and was not changed because migrations were explicitly out of scope.
- Edge-function throttling is per warm function instance; durable cross-instance throttling requires a database receipt/throttle table, which also requires a migration.