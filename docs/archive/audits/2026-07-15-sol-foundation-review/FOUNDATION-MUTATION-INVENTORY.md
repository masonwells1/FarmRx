# Foundation Mutation and Storage Inventory

**Captured:** 2026-07-15 on `codex/farmrx-foundation-repair`
**Purpose:** freeze the repair surface before changing schema, queues, or offline state

## Identity and farm selection

| Surface | Current source | Risk |
|---|---|---|
| Browser session | Supabase session in `localStorage` via `farm-rx-auth:<projectRef>` | restores the auth token locally, but application context still performs network lookups |
| User ID | `src/data/index.ts` -> `supabase.auth.getUser()` | always requires an Auth request before a queue key can resolve |
| Farm ID | `src/data/index.ts` -> RLS-filtered `farms` query | rejects zero or more than one farm |
| Shell farm name | `findOnlyAccessibleFarm()` | repeats the one-farm assumption |
| Access gate | `FarmAccessGate` | blocks offline before cached farm/module data can render |

## Queue families

| Module | Durable key scoped user+farm | Operation IDs | Cross-tab critical section | Cached canonical workspace | Pending projection |
|---|---:|---:|---:|---:|---:|
| Fields | yes | yes | yes | memory only | field bundle |
| Field location/weather | yes | yes | yes | weather localStorage cache only | location operation |
| Grain | yes | yes | yes | memory only | broad Grain operations |
| Profitability | yes | yes | yes | memory only | broad budget/cost/allocation operations |
| Programs | yes | yes | yes | memory only | broad Program operations |
| Harvest | yes | yes | yes | no complete workspace cache | harvest save |
| Field Log | yes | yes | yes | no complete workspace cache | save/delete |
| Inventory | yes | partial by operation type | **no** | memory only | product only; ledger/application operations missing |
| Equipment/Tasks | yes | yes | **no** | memory only | partial |
| Scouting/photos | yes | yes | **process-only** | memory only | partial/photo-sensitive |
| Notifications | yes | yes | **no** | memory only | mark-read only |

All queue mutations read and rewrite complete localStorage envelopes. The unlocked families can erase or double-replay entries across tabs. Multiple modules contain copied implementations of the same Web Locks + renewable-lease idea.

## Mutable canonical aggregates lacking expected-version control

| Aggregate | Current write shape | Dependent readers |
|---|---|---|
| Field + current arrangement + crop assignments | `save_field_bundle` RPC serializes transactions but does not compare the editor snapshot | Grain production, Profitability land economics, Inventory/Programs/Harvest field links |
| Grain production, contracts, plan targets, alerts, insurance, bins | ID upserts or replace RPCs; append-only/finalized subpaths are stronger | position math, alerts, revenue, Profitability |
| Crop budgets and cost lines | ID upserts; matrix replacement is the strong expected-snapshot exception | breakeven, land comparison, Grain overlay, reports |
| Budget field allocations | ID upserts | field-level cost/revenue allocation |
| Equipment, maintenance intervals, tasks/assignments | ID upserts/updates | maintenance due state, task ownership, Programs links, alerts |
| Harvest values shared with crop assignments | ID upsert/last-write-wins | Grain actual production, nutrient removal, field history |
| Editable inventory products and draft receipts | upsert/bundle without editor version | compliance facts, cost allocations, spray records |
| Program templates | server revision exists and is materially stronger | assignments/tasks/notifications |

Append-only bin transactions, contract deliveries, adjustments, application correction/reversal records, immutable price finalization, operation receipts, and finalized service history must retain their ledger/idempotency model.

## Browser and storage boundaries

- Farm/module canonical data is not durably cached; the service worker precaches only the application shell.
- Queue and needs-attention records live in localStorage and are already keyed by project/user/farm after context resolves.
- Weather and calculator preferences have separate localStorage caches.
- Scouting photo state crosses browser storage and private Supabase Storage; cleanup/retry must remain farm/path scoped.
- TradingView's loader script currently executes in the authenticated parent origin.
- `vercel.json` currently has a SPA rewrite only and no security headers.

## Alert evaluators and delivery paths

| Trigger | Current evaluator | Delivery activation |
|---|---|---|
| Marketing price/date | client check-on-open plus server delivery recheck with mismatched entity scope | only when invoked |
| Legacy Grain alert | client check-on-open | only while app is active |
| Program due | client generation plus scheduler-safe SQL function | checked-in cron block is inactive placeholder |
| Spray/weather transition | mounted Weather component | no app-closed evaluator |
| Push queue | durable claim/backoff in 0035 | Edge Function must be invoked externally |

## Repair invariants

1. Server/RLS remains authoritative for membership, selected-farm validity, private financial access, and replay.
2. Cached private financial data expires after 24 hours without revalidation; nonfinancial operational cache expires after 7 days.
3. Every browser key includes project, user, and farm identity.
4. Cross-tab write/replay is serialized through one shared primitive.
5. Editable aggregate saves compare an expected version; stale operations never silently overwrite.
6. Append-only and immutable paths remain receipts/ledgers, not ordinary editable rows.
7. Offline projection never invents server-confirmed state; it is labeled pending and reconciled on reconnect.
