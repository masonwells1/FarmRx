1. Hardened only `src/data/SupabaseInventoryRepository.regression.ts` with 8 coverage groups:
   - Stateful canonical fake gateway for receipt, cancellation, adjustment, and application writes.
   - Receipt draft/received/edit/cancel lifecycle plus wrong-echo rejections.
   - `cancelled_by: null` mapper regression.
   - Adjustment and multi-product mixed-rate application confirmations.
   - RUP operational-token acceptance and retired-token fail-closed behavior.
   - Package conversion acceptance and volume→weight rejection.
   - Idempotent queued replay, conflicting echo blocking, and startup replay without workspace load.
   - Fully shaped queue fixtures.

2. Proof:
   ```text
   npx tsc -b --force
   Exit code: 0
   ```

   ```text
   npm run build
   ✓ built in 1.24s
   Exit code: 0
   ```

   ```text
   npm run regression
   MockFieldsRepository regressions passed.
   MockGrainRepository regressions passed.
   SupabaseFieldsRepository regressions passed.
   SupabaseGrainRepository regressions passed.
   MockProfitabilityRepository regressions passed.
   SupabaseProfitabilityRepository regressions passed.
   MockInventoryRepository regressions passed.
   SupabaseInventoryRepository regression passed (8 coverage groups)
   Exit code: 0
   ```

3. Deviation: PowerShell’s `npx` shim was broken due to a missing global npm file, so I ran the same command through `C:\Program Files\nodejs\npx.cmd`. No source files outside the approved regression file were changed.