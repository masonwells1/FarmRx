# Inventory LIVE repository swap design

Status: implementation blueprint for the builder, based on the repository and the applied
migrations `0001`-`0014` as of 2026-07-11. Fields, Grain, and Profitability are already live.
This design brings Inventory onto Supabase behind the existing `InventoryRepository` surface in
`src/data/inventory.ts`.

---

## Plain English for Mason

The Inventory screen currently saves practice products, receipts, count corrections, and spray
records only in this browser. The live swap makes it read and save the farm's real Supabase
records. The screen and its main workflow stay the same; `backends.ts` remains the final release
switch from `inventory: 'mock'` to `inventory: 'supabase'`.

Four facts matter most:

1. **The practice inventory is discarded, not imported.** The seeded Atrazine and anything Mason
   entered into the mock Inventory screen are browser-only test data. The live shelf starts from
   the real rows already in Supabase. The live repository must never read or merge
   `farm-rx-inventory-mock:v1`.
2. **The shelf total is never stored.** Supabase's `inventory_on_hand` view calculates receipts
   plus signed adjustments minus effective completed applications. The app reads that view
   directly, so a cancellation, void, or correction cannot leave a stale total behind.
3. **Received receipts and completed spray records stay historical.** A received receipt can only
   be cancelled with a reason. Adjustments are new signed ledger entries, never edits. Product
   label facts and the product cost are copied into each application product when the application
   is committed, so later catalog or receipt changes do not rewrite the old record.
4. **Migration 0015 is required, but this design does not write or apply it.** Saving a receipt can
   touch its header, its line(s), and a receive transition. Saving an application touches one
   record, one or more product rows, and possibly a completion transition. Two small transactional
   database functions are required so each bundle is all-or-nothing. Migration 0015 must also
   enforce the existing rule that Farm Rx never converts volume to weight or weight to volume.

Inventory is ordinary farm operational data under migration `0011`. An active member who passes
`can_access_farm` may read it and a member who passes `can_edit_farm` may write it. **There is no
financial-privacy probe for Inventory** and no dependency on the `0008` Grain/Profitability gate.

---

## Scope and release boundary

Build the live path in the same shape as the newest Profitability implementation:

- `InventoryDataGateway.ts` — fakeable boundary whose database values remain `unknown`.
- `SupabaseInventoryDataGateway.ts` — the only Inventory file that calls PostgREST or RPC.
- `SupabaseInventoryRepository.ts` — strict mapping, farm binding, Fields reconciliation,
  business validation, and canonical write confirmation.
- `QueuedInventoryRepository.ts` — isolated durable FIFO queue and pending overlays.
- `inventoryWriteQueue.ts` — exact, versioned queue parser and Inventory-only storage key.
- `createSupabaseInventoryServices.ts` — composition helper mirroring
  `createSupabaseProfitabilityServices.ts`.
- `SupabaseInventoryRepository.regression.ts` — network-free gateway/repository/queue suite.
- `src/data/index.ts` wiring; keep `src/data/backends.ts` as the only release gate.
- `src/data/syncStatus.ts` — widen `Module` to
  `'fields' | 'grain' | 'profitability' | 'inventory'`, add Inventory's initial state, retry
  action, and calls to `setModuleSyncStatus('inventory', ...)`.
- A separately reviewed `supabase/migrations/0015_inventory_live_support.sql`, with only the
  contracts specified below. Do not hide schema work in application code.

Keep the public repository methods unless a small return-type extension is needed to expose the
database RUP result. Do not add delivery-event writes, receipt deletion, adjustment editing,
application editing/voiding, or application correction methods during this swap: none exists in
the current `InventoryRepository` interface.

Hard release rules:

- No live-to-mock fallback after any load or save error.
- No import, inspection, or cleanup of `farm-rx-inventory-mock:v1` during live startup.
- Never calculate a canonical on-hand total from the base rows in the live repository.
- Never accept client-supplied `farm_id`, actor IDs, product snapshots, normalized quantities, or
  calculated costs as authoritative.
- Do not flip `backends.ts` until migration 0015 is applied and the regression and one-time live
  checks below pass.

---

## 1. Gateway and repository structure

### Fakeable gateway

The gateway returns untrusted rows. It should not import UI types merely to cast Supabase output:

```ts
interface InventoryRowBundle {
  products: unknown[]
  receipts: unknown[]
  receipt_lines: unknown[]
  adjustments: unknown[]
  applications: unknown[]
  application_products: unknown[]
  on_hand: unknown[]
  rup_completeness: unknown[]
}

interface ReceiptBundleWrite {
  farmId: string
  receipt: NormalizedReceiptWrite
  lines: NormalizedReceiptLineWrite[]
}

interface ApplicationBundleWrite {
  farmId: string
  application: NormalizedApplicationWrite
  products: NormalizedApplicationProductWrite[]
}

interface InventoryDataGateway {
  loadWorkspace(farmId: string): Promise<InventoryRowBundle>
  upsertProduct(farmId: string, row: InventoryProductWrite): Promise<unknown>
  saveReceiptBundle(input: ReceiptBundleWrite): Promise<unknown>       // RPC 0015
  cancelReceipt(input: CancelReceiptWrite): Promise<unknown>
  insertAdjustment(farmId: string, row: AdjustmentWrite): Promise<unknown>
  saveApplicationBundle(input: ApplicationBundleWrite): Promise<unknown> // RPC 0015
}
```

`saveReceiptBundle` returns an object containing one canonical receipt and its canonical line
array. `saveApplicationBundle` returns one canonical application and its canonical product array.
Those objects still cross the gateway as `unknown`; the repository maps and confirms every row.

`loadWorkspace` issues farm-filtered reads for the six UI-backed base tables and the two source
views:

- `inventory_products`
- `inventory_receipts`
- `inventory_receipt_lines`
- `inventory_adjustments`
- `application_records`
- `application_products`
- `inventory_on_hand`
- `rup_application_completeness`

Use `.eq('farm_id', farmId)` on every query, including both views. Independent reads may run in
parallel, but any Supabase error or non-array response rejects the entire workspace. Never return
a partial shelf or partial compliance record.

The other two `0010` views remain important database building blocks but do not need redundant UI
queries: `effective_application_records` is already consumed by both source views, and
`application_cost_lines` is the Module 4 hook. `inventory_delivery_events` is read-only under
`0011`, but the unchanged Inventory interface has no delivery-event surface. Leave it outside this
swap rather than inventing a hidden write or unused workspace field.

There is deliberately **no privacy probe needed** and no call to
`can_read_private_financials`. Migration `0011` classifies Inventory as ordinary member work and
applies `can_access_farm` reads and `can_edit_farm` writes. The existing RLS policies and
`security_invoker` views are the authorization boundary.

### Strict, fail-closed mappers

Follow the Profitability mapper conventions: `object`, `required`, UUID validation, bounded text,
nullable helpers, finite numeric conversion, enum sets, date/time validation, and a single
timestamp parser. The timestamp parser must continue to accept PostgREST microseconds and offsets:

```text
/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
```

Thus `2026-07-11T23:35:28.807722+00:00` is valid. Postgres `numeric` values may arrive as strings;
convert them through one finite-number helper and then enforce the column's sign/range. Never
coerce missing or malformed values to zero.

Map and validate at least these invariants:

| Row | Fail-closed requirements |
|---|---|
| Product | UUID `id`/`farm_id`; known kind and unit; trimmed non-empty name; allowed signal word; nonnegative REI/PHI; all-or-none maximum-rate triple; RUP only for the schema-allowed pesticide kinds; pesticide, seed, and fertilizer fields consistent with `0010`; valid timestamps. |
| Receipt | Known source/status; required actor UUIDs; draft/received/cancelled timestamp and reason shape exactly matching `0010`; opening balance/vendor rule; valid dates and timestamps. |
| Receipt line | UUID parent/product; positive quantities and factor; nonnegative nullable cost; `quantity_in_inventory_unit` equals entered quantity times the snapshotted factor within the database rounding tolerance; conversion is same-family automatic or explicitly package-based, never volume-to-weight. |
| Adjustment | Same-farm product UUID; finite non-zero signed quantity; known reason; non-empty notes; actor UUID; valid timestamps. |
| Application | Same-farm field and crop assignment; known status; positive acres; valid weather ranges, times, correction/void audit state, actors, and timestamps. |
| Application product | Known enums; positive rate/total/normalized quantity; complete maximum-rate snapshot triple; nonnegative nullable cost; normalized total matches factor; no volume/weight conversion; all snapshot fields have valid shapes. |
| On-hand view | Same-farm product; known product kind/unit; all received/adjusted/used/on-hand quantities finite; `on_hand = received + adjusted - used` within rounding tolerance; nullable weighted known cost is nonnegative. Map `on_hand_quantity` to today's public `{ product_id, quantity }`. |
| RUP view | Same-farm application and product UUIDs; restricted-use flag is true; known dates/IDs; `missing_federal_rup_fields` and `missing_farm_rx_operational_fields` are arrays containing only the view's known tokens; `federal_rup_record_complete` equals whether the federal-missing array is empty. |

Reject duplicates by row ID. Also reject duplicate receipt-line IDs, application-product IDs, and
duplicate application product/lot identities using null-safe comparison. A bad server row is an
honest load failure, not a row to omit.

### Farm binding and relational reconciliation

`SupabaseInventoryRepository` receives:

```ts
{
  gateway: InventoryDataGateway
  fieldsRepository: FieldsRepository
  getFarmId: () => Promise<string>
  createId: () => string
  clock: () => string
}
```

On every load, obtain `farmId`, load the Inventory bundle and injected live Fields workspace, and
require `fields.farm.id === farmId`. Every private row and every view row must carry that exact
farm. Verify every child reference against the mapped parent sets. Verify every application's
`field_id` exists, and that its `crop_assignment_id` belongs to that exact field and farm. Verify
applied acres do not exceed the assignment's planted acres.

On every write, obtain the current `farmId` again immediately before the gateway call. Overwrite or
ignore caller `farm_id`; never allow the caller to choose another farm. The concrete gateway sends
only writable business columns plus stable client UUIDs. Database-generated/audit columns are
server-bound or are fixed once in the normalized queue entry.

After a gateway write, strictly map the returned canonical row or bundle. Confirm exact `id` and
`farm_id`, exact parent/scope IDs, expected status, and the normalized business values relevant to
that operation. For arrays, compare the complete sorted identity/value set, not merely the row
count. A mismatch is a blocked canonical-confirmation failure. The queue head remains intact.

---

## 2. Write path for every current repository method

| Current method | Live persistence path | Idempotency and confirmation |
|---|---|---|
| `saveProduct(product)` | Validate product-kind rules and Fields references, bind the selected farm, then `upsert` one `inventory_products` row by stable client UUID. Do not send actor/timestamp fields. Preserve `created_at`; let `set_updated_at` set `updated_at`. Before allowing an inventory-unit edit, check loaded ledger history; the `0010` trigger remains the authoritative backstop. | Replaying the same UUID converges on the same product. Map the returned row and require exact ID, farm, kind, inventory unit, seed scope, active flag, and normalized regulatory fields before success. |
| `receiveReceipt(input)` with `status: 'draft'` | Normalize the current single UI line into a complete receipt bundle with stable receipt and line UUIDs, then call `save_inventory_receipt_bundle`. The RPC creates the header as draft and inserts its line(s) in one transaction. | Stable receipt/line UUIDs plus desired-state RPC semantics make replay safe. Confirm the returned draft and exact complete line set. |
| `receiveReceipt(input)` with `status: 'received'` | Call the same RPC. It creates a draft, inserts line(s), and only then transitions the header to received inside one transaction. | An identical retry returns the already-received identical bundle. A reused receipt ID with different immutable values rejects. |
| `editReceipt(receiptId, patch)` | Before enqueueing, merge the sparse patch with the current draft and line into one complete normalized bundle. Never persist a sparse patch. The RPC replaces only that draft's desired line set and may leave it draft or transition it to received. | FIFO plus complete desired state makes retries deterministic. Only a draft can change. Exact returned header status and complete line set are required. |
| `cancelReceipt(receiptId, reason)` | Conditional one-row update on `inventory_receipts` scoped by farm, ID, and `status = 'received'`; set `status = 'cancelled'`, the trimmed reason, one fixed queued cancellation timestamp, and `cancelled_by = auth.uid()`. Do not change any other receipt field. If no row is returned, read that same farm/ID once: an already-cancelled row with the exact reason and actor is an idempotent success; anything else rejects. | This handles an unknown commit without weakening received immutability. Confirm exact ID/farm/status/reason/actor; retain the head on mismatch. |
| `addAdjustment(input)` | Insert one immutable `inventory_adjustments` row with its stable UUID, selected farm, normalized signed quantity, reason, notes, fixed adjusted timestamp, and `created_by = auth.uid()`. Never upsert-update or delete an adjustment. | On `23505`/duplicate ID, read the same farm/ID and accept only an exact canonical match; otherwise block. A correction is a new opposite/signed entry with a new UUID. |
| `saveApplication(input)` | Normalize one application and all product inputs, then call `save_inventory_application_bundle`. The RPC inserts the application as draft, inserts all products, snapshots canonical product and cost facts, and, when requested, transitions the parent to completed in one transaction. | Stable application/product UUIDs and exact-bundle replay semantics make an unknown commit safe. Confirm exact application ID/farm/field/assignment/status and the complete product ID/product/rate/total set. |

The current interface does not expose editing/voiding an application, correcting an application,
deleting a draft, or changing delivery events. Do not infer these operations from missing rows and
do not add them during the backend swap. When those UI workflows are designed later, completed
applications must use the existing void/correction model rather than editing history.

### Snapshot and conversion rules on writes

The repository validates inputs for calm, immediate feedback, but migration 0015 and the existing
triggers enforce the same rules inside Postgres:

- Same unit or same physical family uses the exact `inventory_conversion_factor`; caller package
  factors are ignored in that case.
- An explicit factor is allowed only when the entered/total side or inventory side is a package or
  count unit: `each`, `bag`, `case`, `tote`, `seed_unit`, or `bulk_unit`.
- Volume-to-weight and weight-to-volume are always rejected, even if the caller supplies a factor.
  Farm Rx never guesses density.
- Store the accepted factor on the receipt/application-product row and calculate the normalized
  quantity in Postgres to eight decimal places.
- The application RPC does not trust client snapshot columns. The existing snapshot trigger copies
  regulatory/catalog facts from the canonical product in the transaction.
- The application RPC sets `unit_cost_per_inventory_unit_snapshot` from the latest received,
  non-cancelled receipt line for that product with a non-null cost, ordered by `received_at DESC`,
  then line `created_at DESC`, then line `id DESC`; if none exists, store `NULL`. Once committed,
  that snapshot never changes. This preserves the mock's latest-known-cost behavior without
  trusting an offline client price.
- For per-acre rates whose rate unit can be converted to the total unit, validate total quantity is
  within the same 1% tolerance used by the mock. Do not invent a conversion for other rate bases.
  A snapshotted label maximum remains a compliance flag from the view, not an automatic rewrite.

An offline click is still pending work. Canonical regulatory and cost snapshots are taken when the
transaction actually commits during replay, then the returned bundle replaces the optimistic
pending copy.

---

## 3. Migration `0015_inventory_live_support.sql` — required exact contract

Migration 0015 is required. This document specifies it; it does not create or apply the SQL.

### Common security and transaction requirements

Both RPCs must be PL/pgSQL `SECURITY INVOKER` functions with
`SET search_path = public, pg_temp`. Revoke execute from `public` and `anon`; grant execute only to
`authenticated`. Explicitly reject `auth.uid() IS NULL` and require
`public.can_edit_farm(p_farm_id)`. Existing `0011` RLS remains active for every table access.

Each RPC must take a transaction-scoped advisory lock derived from `p_farm_id` plus the bundle's
stable parent UUID. Validate all JSON before changing rows where practical. Any validation or DML
failure rolls back the entire function. Return canonical rows in deterministic child-ID order.

No operation-receipts table is needed. Stable row UUIDs, an advisory lock, and exact desired-state
comparison make identical replay converge safely. Queue `operationId` remains only the local FIFO
head identity.

### RPC 1: save a receipt bundle

Exact signature and return shape:

```text
public.save_inventory_receipt_bundle(
  p_farm_id uuid,
  p_receipt jsonb,
  p_lines jsonb
) returns jsonb

{
  "receipt": <canonical inventory_receipts row>,
  "lines": [<canonical inventory_receipt_lines rows ordered by id>]
}
```

Accepted `p_receipt` keys are exact: `id`, `source`, `status`, `vendor_name`, `purchase_date`,
`received_at`, `invoice_number`, and `notes`. Status may be only `draft` or `received`; cancellation
is not part of this RPC. Accepted line keys are exact: `id`, `product_id`, `entered_quantity`,
`entered_unit`, `inventory_units_per_entered_unit`, `unit_cost_per_inventory_unit`, `lot_number`,
`expiration_date`, `external_delivery_line_id`, and `notes`. The current UI sends one line, but the
RPC correctly supports one or more lines so the database contract matches `0010`.

The function must:

1. Require valid UUIDs, a non-empty line array, unique line IDs, valid enums/dates/text lengths,
   positive quantities/factors, and nonnegative nullable costs. Bind every row to `p_farm_id`.
2. Require every product to exist in that farm. Enforce opening-balance/vendor rules and all
   receipt status/timestamp invariants from `0010`. Bind `created_by` to `auth.uid()`.
3. Recompute each factor and normalized quantity in Postgres. Ignore a supplied factor for known
   same-family conversions; require it only for package/count conversion; reject volume/weight and
   all other physically ambiguous conversions.
4. For a new ID, insert the receipt as `draft`, insert all lines, then transition it to `received`
   only when the requested status is received. Never insert a received header directly because
   the history trigger correctly forbids it.
5. For an existing draft in the same farm, update only draft-editable header values, upsert the
   submitted line IDs, delete omitted lines from that draft, and optionally transition to received.
   It must never move a line from another receipt or farm.
6. For an existing received receipt, treat an identical requested `received` bundle as replay
   success and return it without updating history. Reject any immutable header or line mismatch.
   Reject cancelled receipts and reject a request to turn received back into draft.
7. Return the final canonical header and complete canonical line set. The repository removes a
   queue head only after strict mapping and exact ID/farm/status/content confirmation.

### RPC 2: save an application bundle

Exact signature and return shape:

```text
public.save_inventory_application_bundle(
  p_farm_id uuid,
  p_application jsonb,
  p_products jsonb
) returns jsonb

{
  "application": <canonical application_records row>,
  "products": [<canonical application_products rows ordered by id>]
}
```

Accepted `p_application` keys are exact: `id`, `field_id`, `crop_assignment_id`, `status`,
`application_date`, `start_time`, `end_time`, `applied_acres`, `target_pest`,
`applicator_user_id`, `applicator_name_snapshot`, `applicator_license_number_snapshot`,
`applicator_license_state_snapshot`, `wind_speed_mph`, `wind_direction`, `temperature_f`,
`relative_humidity_pct`, `corrects_application_id`, `correction_reason`, `completed_at`, and
`notes`. For this interface, status may be only `draft` or `completed`, and correction fields are
`NULL`.

Accepted product keys are exact: `id`, `product_id`, `rate`, `rate_unit`, `rate_basis`,
`total_quantity`, `total_unit`, `inventory_units_per_total_unit`, `lot_number_snapshot`, and
`notes`. Client payloads must not include product/regulatory snapshot fields,
`quantity_in_inventory_unit`, or cost snapshot fields.

The function must:

1. Require a valid parent UUID, a non-empty product array, unique product-row IDs, and no duplicate
   product/lot identity using null-safe lot comparison. Validate every enum, numeric range,
   date/time, weather field, and text length from `0010`.
2. Bind the application and all children to `p_farm_id`; bind `created_by` to `auth.uid()`. Require
   the field and crop assignment to belong to the farm, the assignment to belong to that field,
   applied acres not to exceed planted acres, and a non-null applicator user to be an active farm
   member.
3. Require every product to belong to the farm. Apply the conversion/package rules above and the
   mock's 1% rate-times-acres check where conversion is physically defined.
4. Insert the parent as `draft`, insert every child while the parent is draft, let the `0010`
   trigger copy all canonical product/regulatory snapshots, and set each cost snapshot from the
   latest qualifying received receipt line in the same transaction.
5. If requested status is `completed`, transition the parent only after all product rows exist.
   Never insert a completed parent directly.
6. If the parent UUID already exists, accept only an exact idempotent replay: same farm, same
   requested status, same parent business values, and the same complete product ID/product/rate/
   total/lot set. Return the canonical existing bundle without updating snapshots. Any mismatch,
   a voided row, or an attempt to repurpose an ID rejects. The current repository has no
   application-edit method, so this RPC must not silently become one.
7. Return the canonical application and complete canonical product set. The client confirms exact
   parent/scope and child set before removing the FIFO head.

### Database-level conversion hardening in 0015

Replace/harden `normalize_receipt_line_quantity()` and `snapshot_application_product()` so direct
table writes cannot bypass the physical rules. `snapshot_application_product()` must continue to
overwrite all regulatory/catalog snapshots from the canonical product and must also overwrite
`unit_cost_per_inventory_unit_snapshot` from the same latest qualifying received receipt-line
query specified above; a direct caller may not choose historical cost. When
`inventory_conversion_factor` returns `NULL`, the trigger must:

- reject volume-to-weight or weight-to-volume;
- require at least one side to be a package/count unit;
- require a positive explicit factor; and
- continue snapshotting the factor and server-calculated normalized quantity.

This trigger hardening is required even though the repository and RPC validate first. RLS decides
who may write; it does not prove that a requested conversion is physically meaningful.

---

## 4. Source-of-truth reads: on-hand and RUP completeness

### On-hand

Read `public.inventory_on_hand` directly and map `on_hand_quantity` to the existing public
`OnHandRow.quantity`. Do not call `deriveOnHand` in the live repository and do not port that mock
calculation into a second live calculator.

The view is the better source because it already:

- includes only `received` receipts, so cancelled and draft receipts contribute zero;
- sums immutable signed adjustments;
- subtracts only effective completed applications;
- handles completed corrections without counting both old and new records;
- reports received, adjusted, used, and final quantities with database numeric precision; and
- derives a known receipt cost without storing a mutable total on the product.

Client recomputation would have to duplicate SQL status/correction/null rules and could drift as
the schema evolves. The `security_invoker = true` view is already correct and unblocked, and it
inherits the caller's `0011` RLS. This differs from the earlier Profitability work: no workaround
or client replacement is needed.

For an offline queue, retain the last confirmed view rows. Pending receipt, cancellation,
adjustment, or application entries may overlay forms/history with a visible pending state, but
must not be presented as canonical shelf or compliance results. Refresh both views after replay
confirmation. If a future UI wants a forecast, expose it separately as “pending”; never overwrite
the view-backed on-hand value with a client calculation.

### RUP completeness

Read `public.rup_application_completeness` directly. Add a typed mapped result to the Inventory
workspace (for example `rup_completeness`) and make the compliance screen use it for effective
completed restricted-use product rows. Join it to mapped applications/products by the two IDs;
do not recalculate federal missing fields in `InventoryModule.tsx`.

The view is authoritative because it uses the snapshotted historical facts, excludes drafts,
voids, and superseded corrections through `effective_application_records`, and separates federal
minimum fields from Farm Rx operational/label flags. A non-RUP completed application legitimately
has no RUP-view row. Missing view rows for a mapped effective RUP application are a fail-closed
data error, not “complete.” As with on-hand, the view is `security_invoker` and inherits `0011`.

---

## 5. Offline queue integration

Use an Inventory-only key:

```text
farm-rx-inventory-write-queue:v1:<projectRef>:<userId>:<farmId>
```

Never reuse the Fields, Grain, Profitability, or mock storage keys. Define an exact-key,
versioned discriminated union:

- `saveProduct` — complete normalized writable product with stable product UUID.
- `saveReceiptBundle` — complete normalized receipt plus complete line set; used by both
  `receiveReceipt` and `editReceipt`.
- `cancelReceipt` — stable receipt UUID, trimmed reason, and one fixed cancellation timestamp.
- `addAdjustment` — complete immutable adjustment with stable UUID.
- `saveApplicationBundle` — complete normalized application input plus complete product input set.

Every entry also carries exact common fields: `version: 1`, `module: 'inventory'`, `kind`, local
`operationId`, `userId`, `farmId`, and `enqueuedAt`. Parsers must reject unknown versions, missing
or extra keys, malformed UUIDs, invalid enums/numbers/dates/timestamps, unsafe conversion shapes,
or invalid nested rows. Parse before persistence, write/read-verify exact bytes, and preserve
corrupt existing bytes rather than overwriting them.

Mirror `QueuedProfitabilityRepository` for process serialization, `navigator.locks` with lease
fallback, context-specific keys, online replay, retry action, and status. Classify offline,
timeouts, connection loss, and unknown-commit transport failures as retryable/pending. Classify
auth/RLS, validation, constraint, canonical mismatch, corrupt queue, and context mismatch as
blocked. Never classify a 401/403 or Postgres permission/validation error as transport.

Replay strictly FIFO. Remove only the current head and only after the repository maps and confirms
the canonical response's exact ID, farm/scope, status, and relevant desired values. If the head is
ambiguous or blocked, later entries do not run.

Ordering is a correctness rule for receipts:

- A queued product creation must complete before a receipt/application that references it.
- A receipt draft save must complete before its later receive edit.
- A receive must complete before a later cancellation. A cancellation must never jump ahead and
  be attempted against a draft.
- Do not coalesce receipt status transitions; their audit order matters.
- An application after a receipt must remain behind it so the server's committed cost snapshot sees
  the intended latest received cost.

Overlay queued product, draft-history, and form rows on the last good workspace in FIFO order so
the user can see pending work, but keep canonical `on_hand` and `rup_completeness` view-backed as
described above. With no cached live workspace, do not manufacture the mock seed; show the honest
“connect to load your farm” state.

Idempotency by entry:

| Queue kind | Server idempotency |
|---|---|
| `saveProduct` | Same UUID upsert plus exact canonical confirmation. |
| `saveReceiptBundle` | Same parent/line UUIDs and transactional desired-state/replay comparison. |
| `cancelReceipt` | Conditional transition, then exact already-cancelled reconciliation after an unknown commit. |
| `addAdjustment` | Immutable insert; duplicate UUID accepted only after exact same-farm row comparison. |
| `saveApplicationBundle` | Same parent/child UUIDs and exact immutable bundle replay comparison. |

---

## 6. Mock-to-live handling

The mock envelope at `farm-rx-inventory-mock:v1` is practice data. **Discard it on the flip.** Do
not import it, ask to import it, convert its deterministic seed IDs, or use it to fill an empty
live shelf. In particular, the seeded opening Atrazine receipt must never become real stock.

The old localStorage key may remain untouched temporarily for rollback, but no live code path may
read it. Deleting it is a separate local-data cleanup decision and is outside this swap.

---

## 7. Regression plan

Create `SupabaseInventoryRepository.regression.ts` in the style of the Profitability suite, using a
fake gateway and memory storage. At minimum prove this numbered checklist:

1. Strict mapping accepts Postgres numeric strings and microsecond-plus-offset timestamps.
2. Every loaded array is deterministically ordered and the complete workspace is returned.
3. Any gateway error or non-array response rejects the whole load; no mock or partial fallback.
4. Missing keys, malformed UUIDs/dates/timestamps, non-finite numbers, and unknown enums fail
   closed for every row/view mapper.
5. Cross-farm rows, orphan children, mismatched field/crop assignments, and duplicate IDs fail
   closed.
6. Product read rules reject invalid pesticide/seed/fertilizer combinations and incomplete maximum
   rate triples.
7. Receipt/application status and audit-field combinations match `0010`; immutable-history-shaped
   corruption rejects.
8. Same-family conversions accept exact factors; package conversions preserve the explicit factor;
   volume/weight and non-package ambiguous conversions reject on reads and writes.
9. Normalized quantities must equal quantity times factor within eight-decimal tolerance.
10. `saveProduct` farm-binds and canonical confirmation rejects wrong ID, farm, unit, or scope.
11. Changing a product unit with ledger history rejects, while a history-free unit edit succeeds.
12. Draft receipt creation sends one complete bundle and confirms the full returned line set.
13. Direct received creation is represented as one RPC bundle; no client sequence of partial calls
    is exposed.
14. Draft edit queues a complete desired bundle, not a sparse patch; draft-to-received is valid.
15. Received/cancelled receipt edits reject; cancellation requires a reason and changes no immutable
    fields.
16. Replaying an already-committed identical receipt bundle succeeds; same ID with different
    immutable values blocks and retains the queue head.
17. Adjustment zero quantity/blank notes reject; valid positive and negative rows insert; duplicate
    ID succeeds only for an exact immutable match.
18. Application validation checks field/assignment/farm, planted acres, weather ranges, at least one
    product, and rate/total rules.
19. A multi-product application is sent and confirmed as one complete bundle; a missing, extra,
    wrong-parent, or mutated returned product blocks.
20. Regulatory snapshot fields and latest qualifying cost come from the canonical returned bundle,
    not caller-supplied values; later product/cost fixture changes do not mutate saved snapshots.
21. `inventory_on_hand` mapper uses `on_hand_quantity`, checks its arithmetic, and never calls the
    mock `deriveOnHand` path.
22. RUP view rows map known missing-field tokens, match effective RUP applications, and reject a
    missing/contradictory completeness row.
23. All five queue entry kinds round-trip through exact parsing; extra keys, corrupt bytes, and an
    unknown version fail closed without replacing valid bytes.
24. Inventory's queue key differs from Fields, Grain, Profitability, and mock keys and is isolated
    by project/user/farm.
25. Pending entries overlay only their own context and replay FIFO. Draft -> receive -> cancel order
    and product -> receipt/application dependency order are preserved.
26. Canonical-confirmation failure retains the exact queue head and sets Inventory sync status to
    blocked.
27. A permission-shaped 401/403/Postgres RLS error is blocked; a transport/unknown-commit error is
    pending and retryable.
28. An identical retry of each write kind is idempotent and creates no duplicate ledger row.
29. Per-module sync aggregation includes Inventory without overwriting Fields, Grain, or
    Profitability state.
30. Release composition selects the live Inventory repository only when
    `moduleBackends.inventory === 'supabase'`; a live failure never instantiates the mock.

Migration 0015 needs SQL-level tests in addition to the TypeScript suite: unauthorized/unedittable
farm, malformed JSON and extra keys, cross-farm parents/products, advisory-lock serialization,
rollback after a forced bad child, exact replay, conflicting reused IDs, omitted draft receipt-line
replacement, draft-to-received ordering, completed-application ordering, canonical snapshots,
package conversion, and volume/weight rejection through both RPC and direct-table trigger paths.

### One-time live manual checks before the backend flip

Use a dedicated approved test farm/member and real authenticated app session. Do not use fake rows
on a production farm whose inventory matters.

1. Confirm an ordinary active member can read Inventory and an editor can write it without the
   financial privacy probe. Confirm a read-only member cannot write and an unrelated user sees no
   rows.
2. Create one product, refresh, and confirm the canonical row survives. Edit allowed catalog data;
   after ledger history exists, verify inventory-unit change is rejected.
3. Save a draft receipt, refresh, edit it, receive it, and verify the on-hand view changes exactly
   once. Confirm received lines cannot be edited.
4. Cancel that received receipt with a reason and verify on-hand reverses through the view while the
   audit row remains. Retry the same cancellation and confirm no duplicate/change.
5. Receive one same-family conversion and one explicit package conversion. Attempt volume-to-weight
   through the UI and a narrow authenticated direct-table/RPC test; both must reject.
6. Add positive and negative adjustments and verify the signed view delta. Confirm no update/delete
   UI or authenticated path is granted.
7. Save a multi-product completed application. Verify one parent plus all children appear together,
   on-hand subtracts once, and regulatory/cost snapshots remain unchanged after later catalog edits.
8. Save incomplete and complete RUP records and compare the UI to
   `rup_application_completeness`. Verify drafts, voids, and superseded corrections are not treated
   as effective records.
9. Go offline and queue product -> receipt draft -> receive -> cancel plus an application. Restore
   connectivity; verify FIFO replay, per-module pending/syncing/synced status, exact queue cleanup,
   and refreshed view totals. Repeat with a forced 403 and a transport failure to prove blocked vs
   pending classification.
10. Reload and open a second tab during replay to verify no duplicate receipts, adjustments, or
    applications and no cross-tab queue race.
11. Confirm the live empty state contains no mock Atrazine/opening balance and that a Supabase load
    failure displays an honest error rather than practice inventory.

Because ledger history is intentionally immutable, plan test cleanup before performing these
checks. Prefer a dedicated disposable test farm. On any retained farm, use the supported audit
transitions (cancel, void, or compensating adjustment), never direct deletion of received/completed
history.

---

## Builder completion gate

The swap is ready for review only when all of the following are true:

- Migration 0015 has been separately reviewed, tested, applied, and verified live.
- The live repository, gateway, queue, composition helper, sync module, and regression suite exist.
- Typecheck, lint, full tests, build, Inventory regression, and migration validation pass.
- The Inventory page has been rendered and the receipt/application/manual checks have exercised the
  real path.
- The one-time live role/RLS, view, offline, cross-tab, and no-mock-fallback checks pass.
- Only then is `src/data/backends.ts` changed from `inventory: 'mock'` to
  `inventory: 'supabase'` in the release change.
