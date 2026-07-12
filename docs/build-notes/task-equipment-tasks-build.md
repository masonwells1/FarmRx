# TASK — Equipment & Tasks live build (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — that is task
failure. Everything is PRE-APPROVED. Implement fully, then report with proof.

PRE-APPROVED scope: modify src/** and package.json ONLY. Do NOT touch
supabase/migrations/** (another agent drafts 0016 in parallel — code to the contracts in
the design doc; your fake gateway makes regressions runnable without the SQL). No DB ops,
no git, no servers.

## Mission
Implement C:\FarmRx\docs\equipment-tasks-design.md (AUTHORITATIVE — read fully first):
the EquipmentTasks live data layer + the Equipment page + the Tasks board page,
replacing the current /equipment and /tasks empty-state stubs.

Mirror the NEWEST proven pattern exactly — read these before writing a line:
- C:\FarmRx\src\data\SupabaseInventoryRepository.ts, SupabaseInventoryDataGateway.ts,
  QueuedInventoryRepository.ts, inventoryWriteQueue.ts,
  createSupabaseInventoryServices.ts (live stack shape, strict fail-closed mappers,
  the proven microsecond+offset stamp regex, farm binding, canonical confirmation)
- C:\FarmRx\src\data\SupabaseInventoryRepository.regression.ts (the hardened suite
  style: stateful canonical fake gateway driving EVERY write end-to-end — this is the
  bar; the design doc lists the required coverage)
- C:\FarmRx\src\data\syncStatus.ts, backends.ts, index.ts, App.tsx (wiring; add module
  'equipment_tasks', flip manifest to 'supabase', add replayEquipmentTasksQueue() at
  farm-ready next to the other four — forgetting this was a review finding last module)
- C:\FarmRx\src\InventoryModule.tsx + src/index.css (page structure, form/card/tab
  idioms, farmerError usage, 18px/48px/tabular-nums rules)

Key contracts (from the design doc — code to these):
- getWorkspace loads equipment, meter readings, intervals, service log, service-due view
  rows, member-name view rows, tasks + fields via the existing fieldsRepository; calls
  generate_due_service_tasks RPC first, then reads.
- Writes: saveEquipment, addMeterReading, saveInterval, saveTask (+ status moves; the
  SERVER stamps completed_by/completed_at — the client sends status only and the mapper
  REJECTS done-rows missing completion stamps), save_service_log_entry RPC (composite
  echo {log, reading|null, interval|null}), owner/manager deletes with confirmed-gone
  echoes. All queued through the module's own versioned key, FIFO, idempotent replay,
  blocked-vs-transport classification — copy the inventory queue mechanics.
- UI per the design doc's UI spec section verbatim (machine cards w/ meter + service-due
  + warranty chips + cost-to-date; board w/ KPI tiles, 3 stacked columns, overdue
  escalation amber <3d / red >=3d / critical >=7d sorted overdue-first, Start/Done/
  Reopen buttons, linked chips navigating to /fields detail or /equipment).

Proof required (run from C:\FarmRx, paste real output): `npx tsc -b --force` clean ·
`npm run build` clean · `npm run regression` ALL suites pass (new suite wired in).
FINAL message: numbered file list, coverage summary, proof output, deviations.
