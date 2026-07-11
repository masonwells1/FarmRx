# Grain LIVE repository swap design

Status: implementation blueprint for Terra, based on the repository and applied migrations `0001`-`0011` as of 2026-07-11.

## Plain English for Mason

The Grain screen will stop saving its records only in this browser and will read and save the farm's real Supabase grain records instead. The screen, calculations, privacy rules, and `GrainRepository` interface stay the same; the release switch is still the single `backends.ts` change from `grain: 'mock'` to `grain: 'supabase'` after verification.

The current Grain entries in `farm-rx-local-data` are practice/test data. **They will be discarded, not copied into the live database.** Fields data is already live and remains authoritative. Grain may initially be empty where no real production estimates, contracts, plan targets, bins, inventory, or bids have been entered in Supabase.

One important release check is required: the current empty Grain screen can tell Mason to add a crop assignment, but it cannot create the first production-estimate row. Before the flip, either provision Mason's first real production estimates through an approved setup path or add a small empty-state editor that calls the already-existing `saveProductionEstimate` method. Do not seed fake bushels, APH, contracts, targets, bins, or bids into production.

## Scope and release boundary

Build these adapters behind the unchanged interface in `src/data/grain.ts`:

- `GrainDataGateway.ts`: an unknown-row boundary that can be faked without a network.
- `SupabaseGrainDataGateway.ts`: the only file that speaks PostgREST/RPC.
- `SupabaseGrainRepository.ts`: validation, normalization, strict row mapping, farm binding, and Fields reconciliation.
- `QueuedGrainRepository.ts`: durable offline writes and optimistic overlays.
- Grain queue types/parsers, preferably in a separate `grainWriteQueue.ts` so a corrupt Grain queue cannot affect the proven Fields queue.
- A network-free `SupabaseGrainRepository.regression.ts` contract suite.
- Composition in `src/data/index.ts`, with `backends.ts` remaining the release gate.

Do not import, merge, or inspect the mock Grain localStorage envelope during live startup. Do not fall back to `MockGrainRepository` after a Supabase error. A live error must remain an honest error.

## Gateway and repository structure

### Fakeable gateway

Use an interface whose values remain `unknown` until the repository maps them:

```ts
interface GrainRowBundle {
  production_estimates: unknown[]
  grain_contracts: unknown[]
  marketing_plan_targets: unknown[]
  insurance_units: unknown[]
  grain_bins: unknown[]
  bin_inventory: unknown[]
  cash_bids: unknown[]
  usda_report_dates: unknown[]
}

interface ReplaceMarketingPlanInput {
  farmId: string
  scope: PositionScope
  targets: MarketingPlanTarget[]
}

interface GrainDataGateway {
  loadWorkspace(farmId: string): Promise<GrainRowBundle>
  upsertProductionEstimate(farmId: string, row: ProductionEstimate): Promise<unknown>
  upsertContract(farmId: string, row: GrainContract): Promise<unknown>
  replaceMarketingPlan(input: ReplaceMarketingPlanInput): Promise<unknown[]>
  upsertCashBid(farmId: string, row: CashBid): Promise<unknown>
}
```

The concrete gateway must query every private table with `.eq('farm_id', farmId)`. `usda_report_dates` is the one global table and has no farm filter. Run independent reads in parallel, but reject the entire workspace if any result errors or is not an array; never return a partial Grain position. Ordering should be deterministic (`crop_year`, commodity/scope, target month, delivery date, bin name, bid date, report date) so tests and optimistic overlays are stable.

`SupabaseGrainRepository` receives `{ gateway, fieldsRepository, getFarmId, createId, clock }`. It calls the injected live `FieldsRepository`, never loads Fields itself and never writes the Fields or old combined localStorage slice.

### Strict, fail-closed mappers

Create one mapper for every `GrainData` row. Follow the Fields adapter rules:

- Reject non-objects, missing required properties, wrong nullability, invalid dates/timestamps, and malformed IDs.
- Convert Postgres numeric strings to JavaScript numbers only through one helper and reject `NaN`, `Infinity`, and `-Infinity` for every numeric field. Check integer fields such as `crop_year` after conversion.
- Accept only known enum values: `projected | actual`, `cash_spot | forward_cash | basis | hta`, and `on_farm | commercial`. An unknown database enum is a load failure, not a value to pass to the UI.
- Preserve nullable numbers as `null`; never turn a missing or malformed number into zero.
- After mapping, require every private row's `farm_id` to equal the selected farm. Also verify commodity IDs exist in injected Fields, operating entities belong to the farm when present, inventory references a loaded bin, and each bin belongs to the farm.
- Validate contract price/type requirements, delivery ordering, production actual/projected requirements, bin capacity/commitment relationships, marketing target month/scope/percentage, and report-date shape on reads as well as writes. Bad stored data must fail visibly instead of contaminating position math.

Keep the current reconciliation behavior: calculate returned `planted_acres` from live crop assignments for the exact scope, then calculate returned `expected_bushels = planted_acres * aph_yield`. The server row remains canonical for APH, actual bushels, and `drives_math`. Saving a production estimate must recompute and persist the same derived acreage/bushels; do not trust those two client-supplied values.

### Farm binding

For every write, obtain `farmId` from `getFarmId()` immediately before the gateway call. Ignore/overwrite a caller-supplied `farm_id`, and reject a row whose scope refers to an operating entity or commodity outside the loaded farm. Map and verify the returned canonical row before resolving. Existing RLS remains defense in depth: applied `0008` restricts Grain reads, while the existing `can_edit_farm` write policies decide who may change rows.

For plain upserts, send only writable business columns plus the stable client UUID and server-bound `farm_id`; do not accept caller values for `created_at` or `updated_at`. Require PostgREST `.select('*').single()` and map that canonical response before confirming the queue head.

## Write path by current repository method

| `GrainRepository` method/surface | Persistence shape | Idempotency and transaction decision |
|---|---|---|
| `saveProductionEstimate` | One `production_estimates` upsert by client-generated `id`; bind farm and recompute `planted_acres`/`expected_bushels` from Fields. | Plain PostgREST is atomic for one row. Replay uses the same UUID and `upsert(..., { onConflict: 'id' })`, so an unknown commit is safe to repeat. The database's scope-unique constraint still rejects a second ID for the same scope. |
| `saveContract` | One `grain_contracts` upsert by `id` after `validateGrainContract` plus strict normalization. | Plain PostgREST suffices. Replaying the same UUID updates the same contract rather than duplicating bushels. |
| `saveMarketingPlanTarget` | Normalize the edited target, merge it into the currently loaded rows for that exact scope, validate the full percentage total, then send the **whole scoped plan bundle** to `replace_marketing_plan_targets`. | Use the same transactional RPC as grid replacement because the `<= 100%` rule is an aggregate invariant. Repeating the same complete set of client UUIDs is idempotent. |
| `replaceMarketingPlanTargets` | One complete scoped bundle, including an empty list when the user intentionally clears a plan. | A transactional RPC is required. Separate delete/upsert calls can leave half a template or fail after deleting the old plan. The RPC upserts the submitted IDs and deletes omitted IDs in one database transaction. |
| `saveCashBid` | One `cash_bids` upsert by client-generated `id`. | Plain PostgREST suffices. The same UUID plus upsert makes replay idempotent. Manual bids remain distinguishable from automated feed rows by the feed's reserved notes prefix and deterministic feed IDs. |
| `getData` — bins | Read `grain_bins` and `bin_inventory`; verify same-farm references, one inventory row per bin, committed <= bushels, and bushels <= capacity. | There is **no bin write method** in the unchanged interface or current UI. Keep bins read-only in this swap; do not hide writes in `getData`. A future standalone bin/inventory edit is a one-row upsert; a future “create bin with inventory” action needs one bundle RPC because parent and child must succeed together. |
| Grain/settings | No database write in this swap. Owner-only email is a fixed v1 policy, not a configurable address. USDA report IDs/cadence are server configuration. | There is **no Grain settings type, table, or repository method**. Do not store settings in `cash_bids.notes` or localStorage. A later configurable-alert feature needs its own interface, private table, RLS, and migration. |

Do not add delete behavior that the interface does not expose. In particular, a save must never infer deletion from a missing row, except the explicit full-set semantics of `replaceMarketingPlanTargets`.

## Draft migration `0012` — required

`0012` is genuinely needed for atomic monthly-plan replacement. Draft it as `0012_grain_live_support.sql` when Mason separately approves a migration. This design does **not** create the SQL file or apply anything.

Exact contents:

1. Create `public.replace_marketing_plan_targets(p_farm_id uuid, p_crop_year integer, p_commodity_id text, p_operating_entity_id uuid, p_enterprise_label text, p_targets jsonb) returns setof public.marketing_plan_targets` in PL/pgSQL.
2. Make it `SECURITY INVOKER` and set `search_path = public, pg_temp`; the caller's existing table RLS and `can_edit_farm` policies remain active. Revoke from `public` and `anon`; grant execute only to `authenticated`.
3. Reject unauthenticated callers, inaccessible/uneditable farms, invalid crop years, unknown commodities, operating entities outside the farm, malformed/non-array JSON, duplicate target IDs, duplicate target months, rows outside the supplied scope, non-first-of-month dates, out-of-window months, invalid/nullability violations, non-finite numeric input, percentages outside `(0, 100]`, and a total above `100%` (allow only the same tiny rounding tolerance used by the current repository).
4. Serialize concurrent saves for the exact nullable scope with a transaction-scoped advisory lock derived from farm/year/commodity/entity/enterprise. Compare nullable entity/enterprise values with `IS NOT DISTINCT FROM`.
5. Server-bind every written row to the supplied farm and scope. Upsert submitted client UUIDs, preserving existing `created_at` and letting the trigger set `updated_at`; then delete existing rows in that exact scope whose IDs are omitted. An empty JSON array intentionally deletes all targets in that scope.
6. Return the final canonical rows in `target_month, id` order. Any validation, upsert, or delete failure rolls back the entire operation.
7. Add SQL-level migration tests for: unauthorized farm, cross-farm entity, malformed/over-100 plan, nullable-scope matching, empty replacement, replay of the same payload, omitted-row deletion, and rollback after a forced bad row.

No operation-receipts table is needed: the RPC's desired-state replacement and stable target UUIDs make an identical replay converge to the identical final set.

## Offline queue

Extend the proven queue behavior, but isolate Grain bytes under a distinct key:

```text
farm-rx-grain-write-queue:v1:<projectRef>:<userId>:<farmId>
```

Do not reuse `farm-rx-write-queue:v1:...` (Fields), and do not use `farm-rx-local-data` (mock practice data). Queue entries are a strict discriminated union with exact-key parsing:

- `saveProductionEstimate` — normalized complete row with its stable UUID.
- `saveContract` — normalized complete row with its stable UUID.
- `replaceMarketingPlan` — exact scope plus the complete normalized target set. `saveMarketingPlanTarget` is converted to this form before enqueueing.
- `saveCashBid` — normalized complete row with its stable UUID.

Each entry also carries `version`, `module: 'grain'`, `kind`, `operationId` for local FIFO head identity, `userId`, `farmId`, and `enqueuedAt`. `operationId` is not a server receipt; server idempotency comes from row UUID upserts or desired-state plan replacement.

Copy the Fields guarantees exactly: strict version/schema parsing; write-read verification; user/project/farm isolation; per-process serialization plus `navigator.locks`/lease fallback across tabs; FIFO replay; remove only the confirmed head; classify auth/RLS/validation/conflict failures as blocked; retain transport/timeout/unknown-commit failures for retry; preserve corrupt/unknown bytes rather than overwriting them; and expose pending/syncing/blocked/synced status.

When any Grain entry is pending, later Grain writes append instead of jumping ahead. Optimistically overlay queued rows on the last good Grain workspace in FIFO order. A queued plan replacement replaces only its exact scope. Never overlay one user's/farm's queue on another context. With no cached live workspace, an offline Grain page cannot truthfully load and must show the same honest “connect to load your farm” behavior as Fields.

## Mock-to-live handling

The mock envelope under `farm-rx-local-data` contains test data. **Discard it on the live swap.** Do not auto-import, prompt to import, or silently convert its deterministic seed IDs into real records. This avoids test contracts and bushels affecting real marketing decisions.

The old key may remain untouched for rollback during the first release, but the live repository must never read it. A later cleanup may remove the key only under a separately approved, explicit local-data cleanup; deletion is not part of this implementation.

## USDA AMS MARS basis feed

### Source and ingestion

- Pilot endpoint: `GET https://marsapi.ams.usda.gov/services/v1.2/reports/2850` (Iowa Daily Cash Grain Bids), authenticated with the free MARS API key via HTTP Basic auth.
- The API key stays in a Supabase Edge Function secret; never ship it to the browser. Report `2850` is an Iowa pilot and must be labeled as such, not represented as a local Illinois bid. Additional report IDs can be added later as server configuration after their geography is verified.
- Poll once on USDA business days after the EOD report is expected, recommended `4:30 PM America/Chicago`, with one retry around `7:00 PM`. This is daily cash/basis data, not an intraday futures feed; faster polling adds no honest freshness.
- The scheduled Edge Function maps only an explicit commodity whitelist to Farm Rx commodity IDs. Unknown commodities, units, locations, or malformed/non-finite values are skipped and logged, never guessed.

Store normalized observations in the existing `public.cash_bids` history table from `0004`: farm-bound `farm_id`, published location/elevator, commodity, report/bid date, basis, cash price when supplied, delivery window when supplied, and provenance such as `[USDA MARS 2850]` in `notes`. Because the table is farm-private, the pilot service job fans approved observations only into farms on a fixed server-side allowlist rather than creating a cross-farm read path; adding user-controlled feed enrollment is later settings work. Use a deterministic UUID derived from report ID + USDA row identity + bid date + location + commodity + delivery window and upsert by that ID; repeated polls cannot duplicate history. Automated feed writes do not use the browser offline queue.

### Display-only rule

MARS values may be displayed in basis/cash history and may be read by the alert evaluator as a dated observation. They must never silently populate or overwrite a user's contract basis, contract price, marketing target, or manual `saveCashBid` form. In particular, `latestBasis` may remain display/position context, but repository normalization must not copy it into a write. TradingView remains the display-only delayed board-quote layer; MARS is not a substitute for a live CBOT quote.

### Failure and offline behavior

Retain the last successfully stored rows and show their `bid_date`/“as of” age. If the scheduled poll fails, log/alert operations, leave existing history untouched, and show “Basis feed unavailable — last updated …”; never insert zeros or repeat yesterday under today's date. If the browser is offline, cached Grain data may show the last loaded history with a stale/offline label. A stale or basis-only row must not trigger a price alert requiring a cash price.

## Alerts: smallest honest v1

Implement v1 evaluation in the client after a complete Grain workspace loads. This is intentionally **check-on-open**, not 24/7 monitoring. Say that plainly in the UI. A scheduled Edge Function can later become the evaluator when background delivery is justified.

V1 triggers:

- **Price target hit:** a `marketing_plan_targets.target_price` is at or below the highest fresh `cash_bids.cash_price` for the same commodity. Require an observation no older than 36 hours on a USDA business day; basis alone cannot hit a cash-price target. Fire once per target ID + target price + observation ID. Do not evaluate `breakeven_relative_pct` until the profitability backend is live and supplies a real breakeven.
- **Target deadline:** notify seven calendar days before and on the target's `deadline`, once per target/deadline/window.
- **USDA report date:** notify seven calendar days before and on `usda_report_dates.report_date`, once per report/date/window. This is a calendar reminder, not a claim that a market price target was hit.

Show the alert in-app. For owner-only email v1, the client may call a small authenticated delivery Edge Function after evaluation. That function must verify the caller is the farm owner, re-read the referenced target/report/observation, send only to the owner's authenticated account email, accept no arbitrary recipient, rate-limit, and use the deterministic alert key. Keep a local per-user/farm set of sent keys so normal reloads do not resend. Be explicit that this best-effort v1 checks and emails only when the owner opens Grain and may duplicate across devices; durable cross-device receipts and scheduled evaluation belong in a later alert migration. Managers, employees, reps, advisors, and spouses receive no v1 email.

This alert delivery does not require a Grain settings write or expand migration `0012`. If product requirements change to guaranteed background/exactly-once email, add a private alert-rules/preferences/delivery-receipts design and RLS in a separately reviewed migration rather than stretching this client-side v1.

## Network-free regression contract suite

Use fake Fields/gateway/storage/clock/ID sources and run at least these 15 checks without Supabase or internet:

1. All eight result sets map exactly, Postgres numeric strings/nulls survive correctly, deterministic ordering holds, and any partial gateway read rejects.
2. Unknown enum values, malformed dates/IDs, missing required fields, and all non-finite numeric variants fail closed.
3. A selected-farm mismatch in every private row type rejects; global USDA rows remain allowed without `farm_id`.
4. Cross-farm/unknown entities, commodities, bins, or inventory references reject, as do capacity and commitment violations.
5. Injected Fields remains authoritative; planted acres and expected bushels reconcile by exact scope without touching Fields storage.
6. Production save overwrites caller farm/derived totals, preserves its UUID, returns the canonical mapped row, and safely repeats after an unknown commit.
7. Contract save enforces all four type/price shapes, delivery ordering, finite values, farm binding, and repeat-upsert behavior.
8. A single target edit becomes a complete scoped plan bundle; over-100, duplicate month/ID, wrong scope, and invalid month/deadline values reject before the gateway.
9. Full-plan replacement handles nullable scopes and empty plans, sends stable IDs, returns canonical rows, and fake gateway failure leaves the prior fake database unchanged.
10. Manual cash-bid save validates commodity/delivery/numbers, binds the farm, and repeated UUID upsert does not duplicate the history row.
11. Live read/write failures propagate; no call returns mock/seed success and neither the Fields queue nor `farm-rx-local-data` is read or changed.
12. Grain queue parsing rejects corrupt bytes, extra/missing fields, unknown versions/kinds/enums, context mismatch, storage-full, and write/read mismatch without replacing prior bytes.
13. Queue keys isolate project/user/farm and are distinct from Fields; two tabs append without losing an entry.
14. Replay is FIFO, retains the same row/target IDs across transport and ambiguous-commit retries, removes only a confirmed head, and blocks rather than retries auth/RLS/validation failures.
15. Optimistic overlays match each write's exact semantics, including scoped plan replacement, and release composition uses live Fields + queued live Grain only when the backend manifest says `grain: 'supabase'`.

Keep the existing mock regressions until rollback confidence is no longer needed, but update the release-composition assertion only in the same change as the final backend flip.

## One-time live manual verification before the flip

Use a non-production test farm or explicitly approved owner test records, then verify:

1. Owner loads all Grain tables plus live Fields; no mock rows appear and no cross-farm rows are visible.
2. Create/update one real production estimate, each contract type, one target, a full template replacement, and one manual basis row; refresh and confirm exact canonical values and position math.
3. Submit an invalid/over-100 plan and confirm the entire old plan remains unchanged. Clear a test plan and confirm only that exact nullable scope is removed.
4. Verify owner/manager/granted-member read behavior and denied ordinary-member behavior from applied `0008`; separately verify existing write roles through `can_edit_farm` and that a read-only financial grant cannot write.
5. Drop network during each queued write family, refresh, reconnect, and confirm FIFO replay produces one row/set with visible sync status. Repeat one request after an induced timeout to prove idempotency.
6. Confirm bins/inventory load read-only and invalid/cross-farm references cannot be observed or written.
7. Run the MARS job twice for the same report payload: history must not duplicate, provenance/date must display, stale/failure state must retain the last good rows, and no feed value may prefill a contract/target/manual-bid form.
8. Open Grain as the owner near a controlled target/deadline/report trigger; confirm the in-app alert and owner-only email, deterministic dedupe on reload, no arbitrary recipient path, and the visible check-on-open limitation.
9. Flip only `moduleBackends.grain` to `'supabase'`, run typecheck/build/regressions, render the Grain page, inspect console/network errors, then perform the signed-in smoke again. Production deployment remains a separate approval gate.

## Release verdict

Migration `0012` **is required** before the live flip, solely to make marketing-plan replacement atomic and idempotent as a complete desired state. All current single-row Grain saves use plain PostgREST upserts; no receipts table, bin RPC, or settings table is required for this repository swap.

## Migration 0012 security clarification

The approved migration uses `SECURITY DEFINER`, superseding item 2 of the earlier draft checklist. It still acts only for the signed-in caller: the function reads `auth.uid()`, requires the existing `can_edit_farm` permission, checks every farm-owned reference itself, and writes farm and scope values only from its arguments rather than trusting payload stamps.
