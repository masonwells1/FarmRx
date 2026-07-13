# FarmRx Foundation Data-Layer and Regression Audit

## Scope and evidence

Read-only code/docs audit of:

- All 10 `*DataGateway.ts` interfaces and Supabase implementations.
- All queued repositories and per-module queues.
- `writeQueue.ts` and `syncStatus.ts`.
- Migrations `0001` through `0030`.
- All 23 regression suites.
- No live database, network, `.env`, or secret access.

Verification:

- `npm run regression`: passed all 23 suites.
- `npm run build`: TypeScript and Vite build passed.
- No source, migration, public, package, or configuration files were modified.

## Executive verdict

No confirmed P0 issue was proven without live-service execution.

The code is generally strongly typed, farm-scoped, fail-closed on most canonical responses, and uses reliable operation receipts for Fields, Field Log, Scouting, Harvest, and Programs.

The highest risks are queued direct writes that do not have server-side replay receipts or reconciliation.

### Findings

- P1: Inventory adjustments, Grain deletes, and several Equipment writes can permanently block the FIFO queue after the server committed successfully but the response was lost.
- P1: Profitability matrix replay is a blind delete-and-reinsert operation with no operation receipt or conflict token.
- P2: Database-valid profitability cost sources (`inventory`, `equipment`) are rejected by the repository.
- P2: Numeric scale and precision are not enforced consistently before queueing or writing.
- P2: Some missing response columns are silently converted to `null`, so a dropped or renamed selected column may not fail.
- P2: Sync status can undercount pending program writes and retain stale retry actions.
- P2: Regression coverage is strong for many write echoes but weak for selected-column removal, several Grain methods, and the Mock Grain repository.
- P3: `loadAssignments` accepts an archive flag that the Supabase gateway ignores.
- P3: Aggregate sync status reports only the first blocked module’s message.

## P1 findings

### P1-01 — Committed direct writes can permanently block offline queues

Several queue entries have a generated `operationId`, but that ID is never sent to the server. The queue assumes that any non-transport error means the write failed.

Inventory adjustments use a raw insert:

- `src/data/SupabaseInventoryDataGateway.ts:32`
- `src/data/QueuedInventoryRepository.ts:17-18`
- `src/data/QueuedInventoryRepository.ts:28`
- `supabase/migrations/0010_module3_inventory.sql:218-229`

Failure scenario:

1. The adjustment insert commits.
2. The HTTP response is lost.
3. The client queues the adjustment.
4. Replay inserts the same primary key again.
5. PostgreSQL returns a duplicate-key error.
6. The queue becomes `blocked`, and later inventory writes cannot replay.

Grain deletes have the same shape:

- `src/data/SupabaseGrainDataGateway.ts:46-48`
- `src/data/QueuedGrainRepository.ts:24-30`
- `src/data/QueuedGrainRepository.ts:47`

The Grain replay reconciliation only handles `appendBinTransaction`; it does not reconcile deleted alert rules or firm offers.

Equipment meter inserts and deletes are also vulnerable:

- `src/data/SupabaseEquipmentTasksDataGateway.ts:11`
- `src/data/SupabaseEquipmentTasksDataGateway.ts:15-17`
- `src/data/QueuedEquipmentTasksRepository.ts:15`
- `src/data/QueuedEquipmentTasksRepository.ts:24`
- `supabase/migrations/0016_equipment_tasks.sql:33-42`

A successful delete followed by a lost response causes the retry to return zero rows through `.single()`, which blocks the queue.

Recommended fix:

- Add operation receipts to every queued mutation, or
- Reconcile by stable row ID after transport failure before retrying.
- Make deletes idempotent: zero affected rows should be treated as success when the requested record is already absent.
- Add regression cases that commit the fake write, throw a transport error, replay, and verify the queue clears.

### P1-02 — Profitability matrix replay can overwrite newer values

The matrix replacement path is a full destructive replacement:

- `src/data/SupabaseProfitabilityDataGateway.ts:29`
- `supabase/migrations/0013_profitability_live_support.sql:225-245`
- `src/data/QueuedProfitabilityRepository.ts:141-144`

The SQL deletes every matrix step for the budget and reinserts the queued snapshot. The queued `operationId` is not passed to the RPC.

Failure scenario:

1. A user edits price/yield steps offline.
2. Another user changes the same budget online.
3. The offline queue replays later.
4. The queued snapshot deletes and replaces the newer matrix.
5. Profitability calculations use stale assumptions.

This is not an immediate duplicate-write problem, because the same stable step IDs can usually be reinserted. It is a conflict and potential data-loss problem.

Recommended fix:

- Add operation receipts and a budget revision/version.
- Reject stale replacements with a conflict result.
- Require the client to reload and merge before replacing the matrix.

## P2 findings

### P2-01 — Repository rejects database-valid cost-source rows

The migration explicitly permits `manual`, `inventory`, and `equipment` cost lines:

- `supabase/migrations/0006_module4_profitability.sql:81-96`

The repository only accepts manual rows:

- `src/data/SupabaseProfitabilityRepository.ts:31-38`

Failure scenario:

1. A valid `inventory` or `equipment` cost line exists.
2. Profitability loads the workspace.
3. `mapCostLine` rejects the row.
4. The entire profitability workspace fails closed.

The current UI may not create these rows, but the schema and views already support them.

Recommended fix:

- Either implement mappings for all supported `source_kind` values, or
- Narrow the schema contract so unsupported source kinds cannot exist.

### P2-02 — Decimal scale is not enforced consistently

The database defines exact numeric scales:

- Fields: `numeric(10,2)` and `numeric(8,3)` in `supabase/migrations/0001_module1_fields.sql:92-95`
- Grain: price and bushel scales in `supabase/migrations/0004_module2_grain.sql:34-36,73-80`
- Profitability: `numeric(14,4)` and `numeric(14,6)` in `supabase/migrations/0006_module4_profitability.sql:80,108`
- Inventory: quantity and cost scales in `supabase/migrations/0010_module3_inventory.sql:222-227,332-340`

Client validation generally checks only finiteness or sign:

- `src/data/SupabaseFieldsRepository.ts:86-99`
- `src/data/SupabaseProfitabilityRepository.ts:17,181-183`
- `src/data/inventoryWriteQueue.ts:17-25`

Failure scenario:

- A value such as `12.34567` is accepted by the client.
- PostgreSQL rounds or rejects it according to the column scale.
- Some repository methods detect the changed echo; others do not consistently enforce or normalize it before queueing.

Recommended fix:

- Define shared decimal validators/rounders per column contract.
- Normalize before queue persistence.
- Test values exactly at scale, one digit beyond scale, and over precision.

### P2-03 — Some missing selected columns are silently masked

`actual_price_per_bu` is optionalized with `?? null`:

- `src/data/SupabaseFieldsRepository.ts:59`

The column is explicitly added by migration `0022`:

- `supabase/migrations/0022_harvest.sql:16-18`

If the response column is dropped or renamed, the mapper silently returns `null` instead of failing.

The regression only checks that existing fields are present and does not mutate or remove the selected column:

- `src/data/SupabaseFieldsRepository.regression.ts:52-54`

Programs similarly treat missing latitude/longitude as null:

- `src/data/SupabaseProgramsRepository.ts:18`
- `src/data/SupabaseProgramsDataGateway.ts:10`

Recommended fix:

- Make required schema columns fail closed.
- Reserve `undefined → null` behavior for intentionally backward-compatible columns.
- Add regression mutators that delete each selected column and assert the expected result.

### P2-04 — Sync status can undercount pending work and retain stale retry callbacks

Programs reports pending work as `0` or `1`, regardless of queue length:

- `src/data/QueuedProgramsRepository.ts:20`

The aggregate adds those values directly:

- `src/data/syncStatus.ts:11-18`

A queue with ten pending program operations can therefore appear as one pending operation.

Retry callbacks are stored globally and are not unregistered when a repository is discarded:

- `src/data/syncStatus.ts:9,26-30`
- `src/data/QueuedFieldsRepository.ts:38`
- `src/data/QueuedProgramsRepository.ts:16`
- `src/data/QueuedInventoryRepository.ts:14`

Failure scenario:

1. A farm/session repository registers a retry callback.
2. The user changes farm or session.
3. A new repository replaces or coexists with the old callback.
4. `retrySavedChanges()` invokes a stale repository context.

Recommended fix:

- Return a disposer from `setModuleSyncRetryAction`.
- Track exact queue counts for every module.
- Clear callbacks when repositories are torn down or context changes.

### P2-05 — Mock/repository regression coverage is uneven

The production manifest deliberately selects Supabase for every module:

- `src/data/index.ts:52`

Only Fields, Grain, Profitability, and Inventory have mock implementations. Equipment, Field Log, Scouting, Harvest, Programs, and Notifications have Supabase/Queued paths only.

This is not itself a production defect, but it means those modules lack a third implementation for seam comparison.

The Mock Grain regression is particularly shallow:

- `src/data/MockGrainRepository.regression.ts:11-21`
- `src/data/MockGrainRepository.regression.ts:24-28`

It tests envelope persistence and method existence, but not the behavior of the repository methods.

Recommended fix:

- Add behavior tests for Mock Grain methods.
- Add explicit documentation that six modules intentionally have no mock backend.
- Keep the Supabase/Queued seam tests as the authoritative path for those modules.

## Gateway and queued-repository seam review

| Module | Method/seam result | Replay result |
|---|---|---|
| Fields | Interface and Supabase/Queued method sets compile consistently. Bundle writes use `operationId`; `src/data/FieldsDataGateway.ts:24-27`, `src/data/SupabaseFieldsDataGateway.ts:35-41` | Strong. FIFO and receipt replay are tested. |
| Grain | Reads are farm-scoped and ordered; direct upserts map expected columns; `src/data/SupabaseGrainDataGateway.ts:16-35,37-50` | Bin append has reconciliation, but deletes do not; P1-01. |
| Inventory | Receipt/application RPCs have stable IDs and server-side bundle logic; adjustment is a raw insert; `src/data/SupabaseInventoryDataGateway.ts:23-33` | Receipt/application paths are strong; adjustment replay is vulnerable. |
| Profitability | `sort_order` is correctly translated to database `step_order`; `src/data/SupabaseProfitabilityDataGateway.ts:25-36` | Matrix replacement lacks receipt/version protection; P1-02. |
| Equipment | Upserts are stable-ID based; service-log RPC creates stable reading IDs; `src/data/SupabaseEquipmentTasksDataGateway.ts:10-14` | Meter insert and deletes can block after committed response loss. |
| Field Log | Save carries `operationId`; delete returns a canonical deletion receipt; `src/data/SupabaseFieldLogDataGateway.ts:19-27` | Strong. Replay and repeated delete are covered. |
| Scouting | Save carries `operationId`; photo cleanup and delete replay are explicitly handled; `src/data/SupabaseScoutingDataGateway.ts:7-11` | Strong, with good storage-removal handling. |
| Harvest | Save carries `operationId`; `src/data/SupabaseHarvestDataGateway.ts:8-15` | Strong. |
| Programs | All write methods carry `operationId`; `src/data/SupabaseProgramsDataGateway.ts:15-26` | Strongest seam. Migration receipts cover the RPCs. |
| Notifications | Queued operation is `markRead`, which is naturally repeatable; `src/data/QueuedNotificationsRepository.ts:13,17` | Acceptable for mark-read. Notification creation and push subscription writes are not queued. |

## Migration and type cross-reference

| Migration group | Result |
|---|---|
| `0001`, `0009`, `0018`, `0022` Fields/location/harvest | Column names and public mappings align. `actual_price_per_bu` is present and correctly scaled, but the mapper can mask its absence. |
| `0004`, `0012`, `0027`, `0028`, `0029` Grain | Public fields, nullable values, ordering, alert rules, firm offers, and bin transaction fields align. Direct delete replay remains unsafe. |
| `0006`, `0013`, `0030` Profitability | RP fields and `sort_order`/`step_order` translation align: `supabase/migrations/0030_budget_insurance.sql:10-24`, `src/data/SupabaseProfitabilityDataGateway.ts:7`, `src/data/SupabaseProfitabilityRepository.ts:26-28`. Source-kind support and matrix conflict behavior do not align. |
| `0010`, `0011`, `0015` Inventory | Public types intentionally project away audit and operational columns. Receipt/application bundle logic is structurally strong. Adjustment replay is not protected. |
| `0016`, `0017`, `0025` Equipment/tasks | Row names and nullable fields align. Stable service-log reading IDs are preserved, but direct meter/deletion replay lacks reconciliation. |
| `0019` Field Log | Save receipt path aligns with the repository’s operation ID. |
| `0020`, `0021` Scouting | Save receipt, photo paths, coordinate normalization, and storage cleanup align. |
| `0023` Notifications | Public notification fields and nullable body/link semantics align. Mark-read behavior is repeatable. |
| `0024`, `0026` Programs/cost views | Repository selections and view mappers align, including assignment cost and crop rollups. All program writes use operation receipts. |
| `0002`, `0003`, `0005`, `0007`, `0008`, `0011`, `0014`, `0017`, `0018`, `0021`, `0025` | Supporting RLS, hardening, privacy, flex, task-linkage, and bucket-limit migrations introduce no additional TypeScript column mismatch found in this audit. |

Intentional database-to-domain projections were verified in Inventory:

- `inventory_products.notes` and `crop_rx_product_id` exist in `supabase/migrations/0010_module3_inventory.sql:108-110` but are intentionally omitted by `InventoryProduct` and `productColumns`.
- Receipt, application, and application-product audit/snapshot columns are likewise omitted from public domain types.

These omissions are acceptable only if they remain deliberate. They need contract tests if future UI behavior depends on them.

## 23-suite regression quality matrix

| Suite | Coverage | Distinct sentinel / dropped-column behavior | Assessment |
|---|---|---|---|
| `binLedger.regression.ts` | On-hand math, commodity isolation, moisture, queue envelope | N/A; pure/domain behavior | Good |
| `costOfCarry.regression.ts` | Storage, interest, trucking, verdict selection | Hand-computed distinct values | Good |
| `firmOffers.regression.ts` | Offer filtering and fill cases | Distinct status/expiry fixtures | Good |
| `insuranceMath.regression.ts` | RP calculations and null baseline | Distinct numerical inputs | Good |
| `marketingAlerts.regression.ts` | Price, marketed percentage, deadline alerts | Distinct rule fixtures | Good |
| `planningTools.regression.ts` | Planning and budget calculations | N/A; pure behavior | Good |
| `MockFieldsRepository.regression.ts` | Storage ownership, roundtrip, history, failures | Distinct phone/contact/grain bytes; no live selected-column sentinel; `src/data/MockFieldsRepository.regression.ts:32-51` | Good for Mock storage |
| `MockGrainRepository.regression.ts` | Envelope migration and method presence | No method behavior or selected-column checks; `src/data/MockGrainRepository.regression.ts:24-28` | Weak |
| `SupabaseFieldsRepository.regression.ts` | Mapping, canonical save, farm binding, queue FIFO | No response mutator; missing `actual_price_per_bu` would be masked; `src/data/SupabaseFieldsRepository.regression.ts:52-61` | Moderate gap |
| `SupabaseGrainRepository.regression.ts` | Production, contract, plan, bid canonical echoes and replay | Distinct mutators for only selected methods; no equivalent coverage for every alert/bin/offer/settings method; `src/data/SupabaseGrainRepository.regression.ts:35-42,121-133` | Moderate |
| `MockProfitabilityRepository.regression.ts` | Mock persistence, calculations, allocations, flex | N/A for live selected columns | Good for Mock behavior |
| `SupabaseProfitabilityRepository.regression.ts` | Canonical echoes, missing budget key, matrix length, copy | Strong mutators and one missing-key test; `src/data/SupabaseProfitabilityRepository.regression.ts:95-129` | Strong, but no precision/conflict test |
| `MockInventoryRepository.regression.ts` | Ledger, conversion, cancellation, farm isolation, corruption | Distinct sentinel quantities and corruption shapes | Good for Mock behavior |
| `SupabaseInventoryRepository.regression.ts` | Receipt/application/adjustment canonical echoes, RUP completeness | Strong wrong-value and row-count mutations; no generic dropped-column test; `src/data/SupabaseInventoryRepository.regression.ts:103-115` | Strong write coverage |
| `SupabaseEquipmentTasksRepository.regression.ts` | Equipment, meter, interval, service, task, queue | Strong service/task replay tests; no meter-insert or delete-after-commit-loss test; `src/data/SupabaseEquipmentTasksRepository.regression.ts:83-87` | Misses P1-01 scenario |
| `SupabaseFieldLogRepository.regression.ts` | Canonical save/delete, role/farm checks, FIFO replay | Distinct canonical mutators and repeated delete; `src/data/SupabaseFieldLogRepository.regression.ts:33-55` | Strong |
| `SupabaseHarvestRepository.regression.ts` | Harvest validation, canonical echo, operation replay | Distinct harvest values and canonical response | Good |
| `SupabaseScoutingRepository.regression.ts` | SQL-faithful normalization, photo handling, queue replay | Distinct canonical note/photo values | Strong |
| `SupabaseProgramsRepository.regression.ts` | All major program RPCs, canonical responses, receipts, malformed responses | Best sentinel/receipt coverage; malformed canonical echo test at `src/data/SupabaseProgramsRepository.regression.ts:104` | Strongest |
| `programsChunk5.regression.ts` | Program assignment/application helpers | N/A; pure behavior | Good |
| `programDueItems.regression.ts` | Due-item generation and gateway behavior | Distinct fake gateway cases | Good |
| `SupabaseNotificationsRepository.regression.ts` | Recipient/farm isolation, mark-read, queue, dedupe, malformed data | Good behavior cases; no dropped selected-column mutation | Good with mapping gap |
| `weatherService.regression.ts` | Payload normalization, forecast, spray-window decisions, failures | Distinct HTTP payloads and malformed cases | Good |

## Verified-good seams and tests

- TypeScript build confirms the existing Gateway, Supabase repository, Mock repository, and Queued repository method sets are compatible.
- Fields use an atomic RPC and operation receipt path: `src/data/SupabaseFieldsDataGateway.ts:35-41`.
- Field Log, Scouting, Harvest, and Programs save operations carry operation IDs through the gateway.
- Programs migrations use advisory locks and `repository_write_receipts`: `supabase/migrations/0024_programs.sql:941-997`.
- Grain bin append replay reconciles the exact persisted row before clearing the queue: `src/data/QueuedGrainRepository.ts:24-30`.
- Inventory receipt/application bundles use stable IDs and server-side transaction logic: `supabase/migrations/0015_inventory_live_support.sql:474-527`.
- Queue keys include project, user, and farm identity: `src/data/inventoryWriteQueue.ts:37`, `src/data/equipmentTasksWriteQueue.ts:19`.
- Queue parsers reject malformed JSON, wrong versions, invalid IDs, and invalid timestamps: `src/data/inventoryWriteQueue.ts:19-35`, `src/data/equipmentTasksWriteQueue.ts:16-18`.
- Farm isolation and role checks are consistently enforced in repository mappers and regression fixtures.
- All 23 regression suites pass, but the passing result does not cover the direct-write response-loss scenarios identified above.

## Recommended remediation order

1. Add idempotent reconciliation or server receipts for Inventory adjustments, Grain deletes, and Equipment meter/deletion writes.
2. Add revision/conflict protection to Profitability matrix replacement.
3. Add dropped-column and numeric-scale contract tests.
4. Fix pending-count accuracy and retry callback lifecycle.
5. Resolve or explicitly narrow the profitability `source_kind` contract.
6. Expand Mock Grain and selected-column regression coverage.