Implemented Equipment & Tasks live build with no DB operations or migration changes.

1. Files added

   - `src/data/equipmentTasks.ts`
   - `src/data/EquipmentTasksDataGateway.ts`
   - `src/data/SupabaseEquipmentTasksDataGateway.ts`
   - `src/data/SupabaseEquipmentTasksRepository.ts`
   - `src/data/equipmentTasksWriteQueue.ts`
   - `src/data/QueuedEquipmentTasksRepository.ts`
   - `src/data/createSupabaseEquipmentTasksServices.ts`
   - `src/data/SupabaseEquipmentTasksRepository.regression.ts`
   - `src/EquipmentTasksModule.tsx`

2. Files updated

   - `src/App.tsx` — real `/equipment` and `/tasks` routes; startup queue replay.
   - `src/data/index.ts`, `backends.ts`, `syncStatus.ts` — live module wiring and sync state.
   - `src/styles/app.css` — responsive equipment cards, detail/forms, KPI board, overdue escalation.
   - `package.json` — new regression suite wired into `regression`.

3. Coverage

   - Strict fail-closed row mappers, farm binding, service-due/member view mapping, server-owned completion stamps.
   - Live gateway calls due-task RPC before workspace reads.
   - FIFO offline queue covers all five write kinds plus the three confirmed-gone delete kinds.
   - Equipment cards, detail/service logging, reminders, machine-linked task creation, task KPIs, board actions, overdue colors, and navigation chips.
   - New regression confirms queue round-trip/FIFO replay for every operation, corrupt-envelope rejection, and Supabase manifest selection.

4. Proof

   Local equivalents passed:

   ```text
   tsc -b --force: Exit code 0
   vite build: ✓ built in 1.24s
   MockFieldsRepository regressions passed.
   MockGrainRepository regressions passed.
   SupabaseFieldsRepository regressions passed.
   SupabaseGrainRepository regressions passed.
   MockProfitabilityRepository regressions passed.
   SupabaseProfitabilityRepository regressions passed.
   MockInventoryRepository regressions passed.
   SupabaseInventoryRepository regression passed (8 coverage groups)
   SupabaseEquipmentTasksRepository regression passed (queue and wiring coverage)
   ```

5. Deviations

   The exact `npx tsc -b --force`, `npm run build`, and `npm run regression` commands could not run because this workstation’s global `npm`/`npx` shims reference a missing global npm installation (`...npm-cli.js` / `...npx-cli.js`). I did not modify the machine outside approved scope; the repository-local `tsc`, `vite`, and all nine `tsx` regression suites passed instead.