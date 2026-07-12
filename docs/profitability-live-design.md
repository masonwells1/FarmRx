# Profitability LIVE repository swap design

Status: implementation blueprint for the builder, based on the repository and the applied
migrations `0001`-`0012` as of 2026-07-11. Fields and Grain are already live; this document
brings Module 4 (Profitability) onto the real Supabase database behind the unchanged
`ProfitabilityRepository` interface (`src/data/profitability.ts`).

---

## Plain English for Mason

Right now the Profitability screen saves its budgets, cost lines, price/yield matrix, and
field allocations **only in this browser** (practice data). This change makes that screen read
and save the farm's **real** Supabase records instead — the same way Fields and Grain already do.

Nothing the farmer sees changes. Same screen, same numbers, same calculations, same privacy
rules. The only release switch is the one-line `backends.ts` flip from `profitability: 'mock'`
to `profitability: 'supabase'`, done **after** we have watched it work.

Three plain-English facts to hold onto:

1. **The practice budgets are thrown away, not copied.** Anything currently on the
   Profitability screen is test data in this browser. On the flip it is discarded. The live
   Profitability screen starts empty until real budgets are entered — but unlike Grain, the
   screen can create its own first budget ("Create first budget" button), so there is **no
   special setup chore** to seed the first row.
2. **Financials stay private, exactly like grain.** Before the app reads any budget, it asks
   the database "is this person allowed to see this farm's private financials?" If not, the
   farmer (or a Crop RX rep who has not been granted access) sees one calm sentence instead of
   numbers. This is enforced in Postgres, not just hidden in the screen.
3. **One small database helper is needed (migration 0013).** Two of the save actions — saving
   the whole price/yield matrix at once, and copying a whole budget — touch several rows across
   several tables and must be all-or-nothing. That needs a tiny, reviewed database function so a
   half-finished save can never corrupt a budget. Everything else uses ordinary saves. Details
   and the exact contract are below; the SQL itself is written and reviewed as a separate step.

---

## Scope and release boundary

Build these files behind the **unchanged** `ProfitabilityRepository` interface in
`src/data/profitability.ts`. Mirror the Grain pattern (the newest conventions):

- `ProfitabilityDataGateway.ts` — an `unknown`-row boundary that can be faked without a network.
- `SupabaseProfitabilityDataGateway.ts` — the **only** file that speaks PostgREST/RPC.
- `SupabaseProfitabilityRepository.ts` — privacy probe, strict row mapping, validation,
  farm binding, Fields cross-checks, canonical save confirmation.
- `QueuedProfitabilityRepository.ts` — durable offline writes and optimistic overlays.
- `profitabilityWriteQueue.ts` — queue types/parsers in their **own** file with its **own**
  versioned key, so a corrupt Profitability queue can never touch the proven Fields or Grain
  queues.
- `createSupabaseProfitabilityServices.ts` — composition helper, mirroring
  `createSupabaseGrainServices.ts`.
- `SupabaseProfitabilityRepository.regression.ts` — a network-free contract suite.
- `supabase/migrations/0013_profitability_live_support.sql` — two SECURITY DEFINER RPCs (spec
  below). Draft and review only; do not apply as part of this task.
- Wiring in `src/data/index.ts`; `backends.ts` remains the release gate; `syncStatus.ts` gains a
  third module.

Hard rules (identical in spirit to the Grain swap):

- Do **not** import, read, or merge the mock localStorage envelope (`farm-rx-profitability-mock:v1`)
  during live startup.
- Do **not** fall back to `MockProfitabilityRepository` after a Supabase error. A live error must
  stay an honest error.
- The **same** live Profitability repository instance must be injected into Grain
  (`services.profitabilityRepository`, used by `getBreakeven` in `GrainModule.tsx`) so the two
  modules never disagree.

---

## 1. Gateway and repository structure

### Fakeable gateway

Values stay `unknown` until the repository maps them, so the whole contract suite runs without a
network:

```ts
interface ProfitabilityRowBundle {
  budgets: unknown[]
  cost_lines: unknown[]
  matrix_steps: unknown[]
  allocations: unknown[]
}

interface ProfitabilityDataGateway {
  loadWorkspace(farmId: string): Promise<ProfitabilityRowBundle>
  upsertBudget(farmId: string, row: CropBudget): Promise<unknown>
  upsertCostLine(farmId: string, row: BudgetCostLineWrite): Promise<unknown>
  deleteCostLine(farmId: string, id: string): Promise<unknown>            // returns deleted id
  upsertAllocation(farmId: string, row: BudgetFieldAllocationWrite): Promise<unknown>
  deleteAllocation(farmId: string, id: string): Promise<unknown>          // returns deleted id
  replaceMatrixSteps(input: ReplaceMatrixStepsInput): Promise<unknown[]>  // RPC (0013)
  copyBudget(input: CopyBudgetInput): Promise<unknown>                    // RPC (0013), returns new budget row
}
```

### Privacy probe (financials are private like grain)

`loadWorkspace` must call the probe **before** returning any row, exactly as
`SupabaseGrainDataGateway` does:

```ts
supabase.rpc('can_read_private_financials', { target_farm_id: farmId })
```

- `permission.error` → throw the error.
- `permission.data !== true` → `throw new Error('PROFITABILITY_PRIVATE_ACCESS_DENIED')`.

The repository catches that sentinel and surfaces one calm, farmer-English sentence, e.g.:

> "This farm's profitability is private. Ask the farm owner to turn on sharing with your Crop RX
> rep, or sign in as the owner."

This mirrors Grain's `GRAIN_PRIVATE_ACCESS_DENIED`. Note the read RLS policies in `0007` currently
gate on `can_access_farm`; the probe is the intended forward-looking financial gate (see the
"FOUNDATION PRIVACY HOOK" note at the bottom of `0007`) and must be called even though today's
RLS would also deny. A privacy denial is **not** a transport failure and must never be queued or
retried silently.

### Strict, fail-closed mappers

Reuse the Grain mapper toolkit verbatim (`fail`, `object`, `required`, `id`, `text`,
`nullableText`, `number`, `nullableNumber`, `integer`, and crucially **`stamp`**). The `stamp`
validator's regex already accepts the PostgREST microsecond-plus-offset shape and is the fix for
today's timestamp bug — do not narrow it:

```
/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
```

so `2026-07-11T23:35:28.807722+00:00` passes. Every mapper must reject a row that is missing a
required key, carries a non-UUID id, a non-finite number, or an out-of-range value.

**Column-name mapping (the DB and the interface disagree in three places — map explicitly):**

| Interface field (`profitability.ts`) | `crop_budgets` | `budget_cost_lines` | `profitability_matrix_steps` | `budget_field_allocations` |
|---|---|---|---|---|
| id / farm_id / scope | direct | — | — | — |
| `BudgetCostLine.name` | — | **DB column is `label`** | — | — |
| `ProfitabilityMatrixStep.sort_order` | — | — | **DB column is `step_order`** | — |
| columns the interface omits | — | `farm_id`, `source_kind`, `source_record_id`, `sort_order`, `notes` | `farm_id`, `created_at`, `updated_at` | `farm_id`, `notes` |

Read mappers must translate `label → name` and `step_order → sort_order`. Write column-pickers
must translate back (`name → label`, `sort_order → step_order`) and supply the omitted DB columns
(see "sort_order for cost lines" under section 2). The interface currently supports only manual
cost lines, so every written cost line must set `source_kind = 'manual'` and
`source_record_id = null` (the DB CHECK enforces this pairing).

### Farm binding and Fields cross-checks everywhere

`getWorkspace()` loads the four base tables (filtered `.eq('farm_id', farmId)`) **and** Fields via
the injected `FieldsRepository`, in parallel — same shape as `SupabaseGrainRepository.getData()`:

1. Assert `fields.farm.id === farmId` (`'Farm Rx could not verify the selected farm.'`).
2. Map every row through its strict mapper.
3. `privateRow`-style bind: every budget/line/step/allocation `farm_id` must equal `farmId`.
4. Every budget's `commodity_id` must exist in `fields.commodities`; a non-null
   `operating_entity_id` must exist in `fields.entities` for this farm.
5. Every cost line, matrix step, and allocation `budget_id` must reference a loaded budget of
   this farm (the composite FK is enforced in the DB; re-check in the mapper so a tampered read
   fails closed).
6. Every allocation `crop_assignment_id` must reference a loaded `fields.crop_assignments` row of
   this farm.
7. Enforce the mock's structural invariants so live can never present a worse state than practice:
   unique budget ids; unique cost-line ids; unique `(budget_id, crop_assignment_id)` allocations;
   matrix values strictly positive and distinct per `(budget, axis)`.
8. Order deterministically (budgets by year/commodity/scope/name/id; cost lines by
   `budget_id, sort_order`; matrix steps by `budget_id, axis, step_order`; allocations by
   `budget_id, crop_assignment_id`) so overlays and tests are stable.

Return `{ budgets, cost_lines, matrix_steps, allocations, fields }`.

---

## 2. Write path per repository method

Two operations cross multiple rows/tables and must be atomic → **RPC (0013)**. Everything else is
a single-row PostgREST upsert/delete with grain-style canonical confirmation.

| Method | Tables touched | Mechanism | Canonical confirmation |
|---|---|---|---|
| `saveBudget(budget)` | `crop_budgets` (1 row) | PostgREST upsert `onConflict:'id'` | returned `id === sent.id`, `farm_id === farmId`, full scope matches |
| `saveCostLine(line)` | `budget_cost_lines` (1 row) | PostgREST upsert `onConflict:'id'` (+ derived `sort_order`) | returned `id`, `farm_id`, `budget_id`, `name(label)`, `amount_per_acre` match |
| `deleteCostLine(id)` | `budget_cost_lines` (1 row) | PostgREST delete `.eq('id').eq('farm_id')` returning id | deleted id echoed, or absence confirmed on re-read |
| `saveAllocation(alloc)` | `budget_field_allocations` (1 row) | PostgREST upsert `onConflict:'id'` | returned `id`, `farm_id`, `budget_id`, `crop_assignment_id`, `allocated_acres` match |
| `deleteAllocation(id)` | `budget_field_allocations` (1 row) | PostgREST delete returning id | deleted id echoed |
| `replaceMatrixSteps(budgetId, steps)` | `profitability_matrix_steps` (N rows, delete+insert) | **RPC `replace_profitability_matrix_steps`** | returned set of `(id, axis, step_order, value)` equals the sent desired state |
| `createBudget(budget)` | `crop_budgets` (1) + `profitability_matrix_steps` (N default) | **composed:** budget upsert **then** matrix RPC (both idempotent) | budget confirmed as `saveBudget`; matrix confirmed as `replaceMatrixSteps` |
| `copyBudget(sourceId, copy)` | `crop_budgets` (1) + `budget_cost_lines` (N) + `profitability_matrix_steps` (N) | **RPC `copy_crop_budget`** | returned budget `id === copy.id`, `copied_from_budget_id === sourceId`, farm/scope match |

### Why these two are RPCs and the rest are not

- **`replaceMatrixSteps` must be atomic.** It is a desired-state replacement (delete steps not in
  the new list, upsert the rest) across two unique constraints — `(budget_id, axis, step_order)`
  **and** `(budget_id, axis, value)`. Done as separate PostgREST statements, an insert failure
  after the delete would leave the budget with **no matrix** (corrupt), and a pre-delete insert
  would collide on `value`. This is the exact shape `0012`'s `replace_marketing_plan_targets`
  solved for grain. → RPC.
- **`copyBudget` is explicitly transactional.** A partial copy (budget with only some of its cost
  lines/steps) is corrupt. One transaction guarantees all-or-nothing. → RPC.
- **`createBudget`** writes a budget plus its auto-generated default matrix (5 price + 5 yield
  steps derived from the expected price/yield, exactly as the mock does today). It is composed of
  a plain budget upsert followed by the matrix RPC. Both writes are idempotent, so a mid-way
  transport failure replays safely (see idempotency, section 3); the only transient state is a
  budget whose matrix arrives a moment later, which the optimistic overlay already hides and the
  UI tolerates. A dedicated third RPC is **not** required. Extract the default-matrix value
  generation into a shared pure helper used by **both** the mock and the live repo so defaults
  cannot drift.
- **`saveBudget`, `saveCostLine`, `saveAllocation`, and the deletes** are single-table, single-row
  operations — the direct analogs of grain's `upsertContract`/`upsertCashBid`. Plain PostgREST,
  with the DB triggers and constraints as the fail-closed backstop:
  - `crop_budgets` has `crop_budgets_prevent_allocated_scope_change` — changing crop_year/
    commodity/entity on an allocated budget raises; surface a calm "Remove field allocations
    before changing this budget's crop, year, or entity."
  - `budget_field_allocations` has `validate_budget_field_allocation` (crop_year & commodity must
    match the assignment, entity-scoped budgets may only allocate their entity's fields, allocated
    acres ≤ planted acres) plus `unique (budget_id, crop_assignment_id)`. Pre-check these in the
    repo for a friendly message; let the trigger be the backstop.

### `sort_order` for cost lines

`budget_cost_lines` has `unique (budget_id, sort_order)` and the interface carries no `sort_order`.
The live repo assigns it: on **insert**, `sort_order = (max sort_order among that budget's lines in
the current workspace) + 1`; on **update**, keep the row's existing `sort_order`. The value is
minted once at enqueue time from the overlaid workspace, so replay re-upserts the same row by id.
Under a single device the FIFO queue makes this collision-free; a genuine cross-device race trips
the DB unique constraint, which fails closed and blocks the queue honestly (see section 3). This
keeps the write a plain upsert and needs no RPC.

### Deep-copy semantics for `copyBudget` (no shared references)

The **client** builds the full copy from the loaded workspace: deep-clone every source cost line
and matrix step (`structuredClone`), mint a **new UUID** for the new budget, every new cost line,
and every new matrix step, re-parent each child's `budget_id` to the new budget id, and set the new
budget's `copied_from_budget_id = sourceId`. It passes the fully-formed budget + cost-line array +
matrix-step array to the `copy_crop_budget` RPC, which validates ownership and inserts them in one
transaction. Because all new ids are minted client-side **once** (at enqueue), the whole copy is
idempotent on replay. No object is shared between source and copy; a later edit to the source can
never mutate the copy.

---

## 3. Offline write-queue integration

New file `profitabilityWriteQueue.ts`, structurally identical to `grainWriteQueue.ts`.

- **Own versioned key:**
  `farm-rx-profitability-write-queue:v1:${projectRef}:${userId}:${farmId}`.
- **Envelope:** `{ version: 1, entries: ProfitabilityQueueEntryV1[] }`.
- **Entry kinds** (each with `version:1`, `module:'profitability'`, `kind`, `operationId`,
  `userId`, `farmId`, `enqueuedAt`, plus payload): `createBudget` (row + priceSteps + yieldSteps),
  `saveBudget` (row), `saveCostLine` (row), `deleteCostLine` (id), `replaceMatrixSteps`
  (budgetId + steps), `saveAllocation` (row), `deleteAllocation` (id), `copyBudget`
  (sourceBudgetId + budget + costLines + matrixSteps).
- **Strict validators per kind**, mirroring `grainWriteQueue.ts`: `exact`-key checks, UUID checks
  on every id, `finite` numbers, `stamp` on `enqueuedAt`. A corrupt or unparseable envelope throws
  the calm sentinel `'Saved changes on this device need attention. Nothing was deleted.'`
- **FIFO + guarded persistence:** `append`, `removeConfirmedHead(operationId)` (rejects if the head
  does not match), and the read-back verification (`persist` re-parses what it wrote) — copied from
  `GrainWriteQueue`.

**Idempotency mechanism per write.** Every entry carries a unique `operationId`, and every write is
made idempotent so a replayed head cannot duplicate or corrupt:

- budget / cost-line / allocation upserts → `onConflict:'id'`; re-running writes the same row.
- deletes → delete by id; a replay is a no-op and confirmation treats "already gone" as success.
- `replace_profitability_matrix_steps` → desired-state; re-running yields the same set.
- `copy_crop_budget` → all new ids minted client-side at enqueue and stored in the entry, so replay
  upserts the identical budget + children (never a second copy).

**`QueuedProfitabilityRepository`** mirrors `QueuedGrainRepository`:

- Holds the last good `ProfitabilityWorkspace`; `overlay(workspace, entries)` applies pending
  entries (replace budget/line/allocation by id; replace a budget's matrix steps wholesale; apply
  deletes; apply a copy by adding the cloned budget + children) onto a `structuredClone`.
- `getWorkspace()`: replay current queue → fetch live → return overlaid live. On error, if a cached
  workspace exists and the error is a transport failure, return the overlaid cache; if there is no
  cache but pending entries and we are offline, throw the calm offline message; otherwise rethrow.
- Per-write `save()`: if the queue is non-empty or offline, enqueue and mark `pending`; else try the
  live write, and on a **transport** failure enqueue instead. After each write, kick `replayCurrent`.
- **blocked-vs-transport classification:** reuse `isTransportFailure` from
  `QueuedFieldsRepository` (Grain already imports it). Transport failure → keep the entry, mark
  `pending`. Any non-transport failure at the queue head (validation, RLS/permission denial,
  canonical-confirmation mismatch, privacy revocation) → mark `blocked` with the calm message and
  stop draining, so nothing is lost and nothing is silently retried forever.
- **Aggregated `syncStatus` gets a third module.** In `syncStatus.ts` widen
  `type Module = 'fields' | 'grain'` to `'fields' | 'grain' | 'profitability'` and add
  `profitability: { kind: 'synced', pending: 0 }` to the initial `states` record. `aggregate()`
  already sums across all modules, so the shared indicator automatically reflects Profitability.
  The queue calls `setModuleSyncStatus('profitability', …)` and registers
  `setModuleSyncRetryAction('profitability', () => this.replayCurrent())`.

---

## 4. Mock → live: practice data is discarded

The current Profitability entries live in `localStorage` under `farm-rx-profitability-mock:v1`.
They are **practice/test data and are discarded on the flip — never copied into Supabase.** Live
startup must not read, import, or merge that envelope. The live Profitability screen begins empty
until real budgets are entered.

Note the mock's seed ids (e.g. `10000000-…` and `${budgetId}-price-0`) are **not** all valid UUIDs,
which is a second, independent reason the practice data cannot be migrated — the live mappers
require UUID primary keys. Every id the live UI creates already uses `crypto.randomUUID()`
(`ProfitabilityModule.tsx`), so real rows are well-formed.

Unlike the Grain swap, **no first-row provisioning chore is needed**: the empty-state
"Create first budget" button calls `createBudget`, which the live repo fully supports. Do not seed
any fake budgets, costs, matrix steps, or allocations into production.

---

## 5. Derived values: one source of truth for v1

**All derived values stay derived on the client.** For v1 the live repository reads **only the four
base tables** and computes every derived number with the existing
`src/data/profitabilityCalculations.ts` — the exact functions the UI uses today:

- matrix cells / breakeven-cell outlining → `matrixCells`, `breakevenCellKeys`,
  `matrixProfitPerAcre`;
- per-acre totals, expected profit, breakeven price/yield → `totalCostPerAcre`, `budgetAnalysis`;
- bushels-to-cover → computed client-side from cost ÷ expected price;
- `getBreakeven(scope, fields)` → cost ÷ expected yield, from base rows already in the workspace
  (no view, no extra query);
- arrangement comparison / equivalent cash rent → `equivalentCashRentForScenario` and
  `equivalentCashRentForField`, which are **already shared between Fields and Profitability** so
  lease math cannot drift between screens.

**The `0006` calculation views are intentionally NOT queried in v1** (`crop_budget_analysis`,
`crop_budget_cost_totals`, `budget_cost_line_analysis`, `profitability_matrix_cells`,
`arrangement_comparisons`, `field_profitability`). Justification:

1. The UI already computes all of these; using the client keeps a **single source of truth** and
   avoids two implementations drifting.
2. **The flex-formula shapes do not match.** Fields owns the `arrangements` table and stores
   `flex_bonus_formula` as `{type, trigger, bonus_rate}` (`src/data/fields.ts`). The `0006`
   `arrangement_comparisons` view requires `{basis, trigger, rate_pct, cap_per_acre?}` and **fails
   closed** on the stored shape (`flex_formula_valid = false`, equivalent cash rent → `null`) for
   every flex lease. So `arrangement_comparisons` and its dependent `field_profitability` cannot
   return correct flex answers against real Fields data. Reading them would silently blank out flex
   arrangements.

**How v1 handles the flex question without guessing:** store arrangements exactly as Fields writes
them (Fields owns them — this swap changes nothing there), and compute the arrangement comparison
**client-side** with the existing `{type, trigger, bonus_rate}` formula, exactly as the mock does
today. Treat the `0006` views as **present but unused** until the owner decides which formula shape
matches real leases. When that decision lands, either (a) fix the view's flex branch to read
`{type, trigger, bonus_rate}`, or (b) migrate Fields' stored formula to `{basis, trigger, rate_pct,
cap_per_acre}` and then switch the repository to the server views — a deliberate, separate change,
not part of this swap.

This means v1 behavior on the live database is **identical** to the practice screen, which is the
whole point: the flip changes where the data lives, not what the farmer sees.

---

## 6. Migration 0013 — exact contract (draft & review only; do not apply here)

`supabase/migrations/0013_profitability_live_support.sql` contains **two** SECURITY DEFINER
functions, written to the same standard as `0012_grain_live_support.sql` (explicit `auth.uid()`
check; explicit `can_edit_farm(p_farm_id)` **and** `can_read_private_financials(p_farm_id)` checks;
`set search_path = public, pg_temp`; trusted arguments are the only farm/scope stamps; client
timestamps rejected; `revoke all … from public, anon, authenticated` then `grant execute … to
authenticated`; a commented, not-run companion reviewer psql script).

### 6a. `replace_profitability_matrix_steps`

```
replace_profitability_matrix_steps(
  p_farm_id   uuid,
  p_budget_id uuid,
  p_steps     jsonb            -- array of { id, budget_id, axis, value, sort_order }
) returns setof public.profitability_matrix_steps
```

Contract:
- Reject null `p_farm_id`; require `auth.uid()`; require both `can_edit_farm` and
  `can_read_private_financials`, else `raise` a permission error.
- `p_budget_id` must exist in `crop_budgets` for `p_farm_id` (else "budget does not belong to this
  farm").
- `p_steps` must be a JSON array. Take one `pg_advisory_xact_lock` keyed on
  `hashtextextended(p_budget_id::text, 0)` so concurrent matrix saves for the same budget serialize.
- For each element: require object; reject `created_at`/`updated_at` keys; require `id` (uuid),
  `budget_id` = `p_budget_id`, `axis in ('price','yield')`, `value` numeric `> 0`, `sort_order`
  integer `>= 0`. Enforce, in-function, per axis: at least 2 steps, `step_order` unique and
  sequential, and `value` unique (matches the table's two unique constraints and gives a friendly
  error before the constraint fires). A submitted id that already exists must belong to this same
  `(farm_id, budget_id)` — reject cross-budget/cross-farm id reuse (the `0012` "already belongs to
  another scope" guard, adapted).
- Upsert every submitted id (`step_order → step_order`, `value`, `axis`; `created_at` preserved,
  trigger supplies `updated_at`), verify the written count equals the submitted count (closes the
  insert race), then `delete` steps of this budget whose id is not in the submitted set.
- `return query` the budget's steps ordered by `axis, step_order`.

Used directly by `replaceMatrixSteps` and internally by the composed `createBudget`.

### 6b. `copy_crop_budget`

```
copy_crop_budget(
  p_farm_id      uuid,
  p_source_id    uuid,
  p_budget       jsonb,     -- the new budget row, incl. new id, scope, copied_from_budget_id = p_source_id
  p_cost_lines   jsonb,     -- array of new cost-line rows, each budget_id = new budget id
  p_matrix_steps jsonb      -- array of new matrix-step rows, each budget_id = new budget id
) returns public.crop_budgets
```

Contract:
- Same auth/permission preamble as 6a.
- `p_source_id` must be an existing `crop_budgets` row for `p_farm_id` (else "choose a budget from
  this farm to copy").
- Validate `p_budget`: object; no client `created_at`/`updated_at`; `id` (uuid) not equal to
  `p_source_id`; `farm_id` = `p_farm_id`; `crop_year`, `commodity_id` (must exist in
  `commodities`), optional `operating_entity_id` (must belong to `p_farm_id`), optional
  `enterprise_label` trimmed 1..160; `name` trimmed 1..160; `expected_yield_per_acre > 0`;
  `expected_price_per_bushel > 0`; `copied_from_budget_id` = `p_source_id`. (The
  `crop_budgets_scope_name_unique` NULLS-NOT-DISTINCT constraint is the backstop for a duplicate
  scope+name — surface it as a calm "A budget with that name already exists for this crop and
  year.")
- Validate every `p_cost_lines` element: `budget_id` = new id; `category` in the enum; `label`
  1..160; `amount_per_acre >= 0`; `source_kind = 'manual'`; `source_record_id` null; `sort_order`
  unique per budget. Validate every `p_matrix_steps` element as in 6a.
- Insert the budget, then the cost lines, then the matrix steps, **in one transaction**. Use
  `on conflict (id) do nothing`/idempotent upserts so a replay of the same client-minted ids is a
  no-op rather than a duplicate or error.
- `return` the new budget row.

Both functions end with the `0012`-style `revoke`/`grant` block and a commented companion reviewer
test (deny a financial-denied worker; prove atomic all-or-nothing on a bad element; prove idempotent
replay; prove cross-farm/cross-budget id reuse is rejected).

**Everything else needs no new SQL** — the four tables, RLS, triggers, and the `can_edit_farm` /
`can_read_private_financials` helpers already exist and are applied.

---

## 7. Wiring and the release gate

In `src/data/index.ts`:

- Build the live stack: `new SupabaseProfitabilityRepository({ gateway:
  new SupabaseProfitabilityDataGateway(), fieldsRepository, getFarmId: currentFarmId, createId:
  () => crypto.randomUUID(), clock: () => new Date().toISOString() })`, wrapped by
  `QueuedProfitabilityRepository` (same `getContext`/`projectRef`/`storage`/`isOffline` as Fields
  and Grain), via a `createSupabaseProfitabilityServices` helper.
- Export it under the **same name** `profitabilityRepository`, and keep passing that instance into
  `createSupabaseGrainServices({ …, profitabilityRepository })` so Grain's `getBreakeven` uses the
  live repo. Add `replayProfitabilityQueue` alongside `replayFieldsQueue`/`replayGrainQueue`, and
  call it wherever the others are called once the farm resolves.
- Update the startup guard on line 42 to allow `profitability === 'supabase'`.

In `src/data/backends.ts`, the **single release switch**: `profitability: 'mock'` →
`profitability: 'supabase'` (and widen the type comment as needed). Flip **only after** the
manual live checks below pass.

---

## 8. Regression plan

### Network-free contract suite (`SupabaseProfitabilityRepository.regression.ts`, grain-style)

Drive a fake `ProfitabilityDataGateway`; assert on repository behavior:

- **Canonical-confirmation rejections:** gateway returns a saved row with a wrong `id`, wrong
  `farm_id`, wrong `budget_id`, or (for copy) wrong `copied_from_budget_id` → repo throws the
  "could not confirm … saved" error, not a silent success.
- **Strict mapper, fail-closed:** missing required key, non-UUID id, non-finite/negative number,
  and a malformed timestamp all reject; **a microsecond-plus-offset timestamp
  (`…807722+00:00`) is accepted**; `label ↔ name` and `step_order ↔ sort_order` round-trip
  correctly.
- **Farm isolation:** a row with a foreign `farm_id`, a `commodity_id`/`operating_entity_id` not in
  Fields, or an allocation `crop_assignment_id` not in Fields → rejected.
- **Deep-copy integrity:** `copyBudget` mints new ids for the budget and **every** cost line and
  matrix step, re-parents all children to the new `budget_id`, sets `copied_from_budget_id`, and
  shares **no** object reference with the source (mutating a source line does not change the copy).
- **Matrix desired-state + idempotency:** omitted steps are deleted; duplicate `value`s per axis and
  fewer than 2 steps per axis are rejected before hitting the DB; replaying the same
  `replaceMatrixSteps` yields the same set.
- **sort_order assignment:** inserting cost lines assigns `max+1`; a forced duplicate `sort_order`
  fails closed.
- **Queue round-trips:** enqueue → replay → `removeConfirmedHead` in FIFO order; a corrupt envelope
  throws the calm blocked message; guarded `persist` re-parse catches a bad write; a transport
  failure keeps the entry and marks `pending`; a non-transport failure at the head marks `blocked`;
  a head whose `userId`/`farmId` differs from context marks `blocked`; the optimistic overlay
  reflects each pending kind (including copy and delete).
- **Privacy:** probe returns `false` → repo surfaces the calm "financials are private" denial and
  loads nothing; a write whose replay hits an RLS/permission denial marks `blocked`.

### One-time live manual checks (real Supabase, owner signed in, after the flip is staged)

"Done" = watched each of these work in the browser:

1. **Create first budget** on an empty screen → budget appears with a populated price/yield matrix;
   refresh persists it.
2. **Cost lines** — add, edit, delete → total $/acre and bushels-to-cover update; row order stays
   stable across refresh.
3. **Matrix** — edit price/yield steps → matrix recomputes and the breakeven cells outline;
   entering fewer than two steps or duplicate values shows a calm error, not a raw DB error.
4. **Field allocation** — allocate a field → saves; try to allocate more acres than planted → calm
   "cannot be more than planted acres"; allocate a mismatched crop/year → calm rejection (DB
   trigger surfaced kindly).
5. **Copy a budget** → new budget with identical cost lines and matrix; edit the copy and confirm
   the source is unchanged, and vice-versa.
6. **Cross-module** — open Grain's marketing-target editor and confirm the "% over breakeven"
   computed price still works (it calls the live `getBreakeven`).
7. **Offline** — go offline, make several edits (including a copy), come back online → the queue
   drains and the shared sync indicator goes `pending → syncing → synced`; nothing is lost.
8. **Privacy** — sign in as a Crop RX rep **without** the financial share granted → one calm
   private-financials sentence, no numbers; the owner turns on sharing → data appears.
9. **Farm isolation** — confirm only this farm's budgets load (no other farm's rows ever appear).

Only after 1–9 pass does `backends.ts` flip to `profitability: 'supabase'`, and only then is the
change "done."

---

## Open decisions parked for the owner (do not block the build)

- **Which flex-lease formula shape is real** (`{type, trigger, bonus_rate}` vs
  `{basis, trigger, rate_pct, cap_per_acre}`). v1 uses the client formula and leaves the `0006`
  views unused; the answer decides whether we later fix the view or migrate Fields' stored formula
  and move derived math server-side. Until then, v1 is correct and matches today's screen exactly.
