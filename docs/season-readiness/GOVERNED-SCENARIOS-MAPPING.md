# Governed scenarios: implementation and proof mapping

**Source snapshot:** `fc232173ba2cc8f6340e6cad2c390c54430dd308`
**Scenarios:** NF, PS, HR, CC, and PH
**Status:** mapping only; this file is not executable proof

This packet maps the governed scenarios in
`WORKFLOWS-AND-SCENARIOS.md` to the current product, database, browser
storage, and missing proof infrastructure. It deliberately distinguishes:

- **product defect** — current behavior cannot satisfy the contract and needs a
  bounded repair before a scenario can pass;
- **proof gap** — the product path exists, but no current disposable fixture,
  browser gauntlet, and SQL verifier proves the complete scenario; and
- **out of scope** — an assertion the contract explicitly does not make.

A unit test, this mapping, or a chat review is never a substitute for executing
the named UI path against the disposable local backend and comparing exact
pre/post database and browser-storage state. All product-row IDs used by proof
must come from the external manifest. No `run_id` or other proof-only product
column is allowed.

## Shared proof rules

- Use only synthetic users and data on a disposable local Supabase stack.
- Pin the browser clock and `America/Chicago` offset at each named instant.
- Run farmer-facing paths in both desktop and phone Playwright projects unless
  a step is explicitly a backend fixture-controller action.
- Seed authentication without printing passwords or tokens. Evidence may name
  manifest users, operation IDs, fence-token identifiers, and epochs, but not
  bearer tokens or secrets.
- Capture a baseline before each scenario. Verify the exact allowed writes and
  also compare counts and relevant row versions for every named non-write.
- Treat navigation as usability evidence only. Authorization denials require
  database/RLS proof with zero mutations.
- Deterministic browser-created UUIDs must be supplied through the existing
  browser UUID seam in the same order the real UI requests them. The app must
  still own its normal validation, queue, submit-lock, RPC, and receipt paths.
- Governed scenarios are independent. Reset before each scenario, except for
  explicitly ordered steps inside that scenario. HR additionally requires a
  second clean reset for the reverse November order.

## Manifest identities used here

| Identity | UUID |
|---|---|
| owner user | `27000000-0000-4000-8000-000000000001` |
| manager user | `27000000-0000-4000-8000-000000000002` |
| worker user | `27000000-0000-4000-8000-000000000003` |
| read-only user | `27000000-0000-4000-8000-000000000004` |
| named Crop RX rep | `27000000-0000-4000-8000-000000000005` |
| outsider | `27000000-0000-4000-8000-000000000006` |
| North Fork / field / crop | `27010000-0000-4000-8000-000000000002` / `27020000-0000-4000-8000-000000000002` / `27030000-0000-4000-8000-000000000002` |
| North permission-test task | `27061000-0000-4000-8000-000000000002` |
| Prairie Spray / field / crop | `27010000-0000-4000-8000-000000000003` / `27020000-0000-4000-8000-000000000003` / `27030000-0000-4000-8000-000000000003` |
| Prairie product / application / product line | `27040000-0000-4000-8000-000000000001` / `27043000-0000-4000-8000-000000000001` / `27044000-0000-4000-8000-000000000001` |
| Harvest Ridge / field / crop | `27010000-0000-4000-8000-000000000004` / `27020000-0000-4000-8000-000000000004` / `27030000-0000-4000-8000-000000000004` |
| Harvest estimate / contract / delivery | `27070000-0000-4000-8000-000000000004` / `27071000-0000-4000-8000-000000000004` / `27072000-0000-4000-8000-000000000004` |
| Harvest bin / baseline / out movement | `27073000-0000-4000-8000-000000000004` / `27073500-0000-4000-8000-000000000004` / `27074000-0000-4000-8000-000000000004` |
| Cedar Creek / field / crop | `27010000-0000-4000-8000-000000000005` / `27020000-0000-4000-8000-000000000005` / `27030000-0000-4000-8000-000000000005` |
| Cedar product / application / product line / scouting note | `27040000-0000-4000-8000-000000000005` / `27043000-0000-4000-8000-000000000005` / `27044000-0000-4000-8000-000000000005` / `27060000-0000-4000-8000-000000000005` |
| Pine Hill / field / crop | `27010000-0000-4000-8000-000000000006` / `27020000-0000-4000-8000-000000000006` / `27030000-0000-4000-8000-000000000006` |
| Pine connected / revoked note | `27080000-0000-4000-8000-000000000001` / `27080000-0000-4000-8000-000000000002` |
| Pine connected / revoked operation | `27090000-0000-4000-8000-000000000001` / `27090000-0000-4000-8000-000000000002` |
| Pine initial / revoked fence token | `27091000-0000-4000-8000-000000000001` / `27091000-0000-4000-8000-000000000002` |

Operating-entity, arrangement, membership, rep-grant, access-epoch, baseline,
and snapshot rows must also be deterministic. Membership and rep grants use
their existing composite keys, not invented row UUIDs.

## NF — North Fork permissions and privacy

### Exact contract and current path

North Fork begins with `share_with_rep = false`, named-rep epoch `1`, active
owner/manager/worker/read-only memberships, an enabled unrevoked named-rep
grant without membership, and an outsider with no access. North Home 80 and its
2027 `corn_yellow` assignment already exist.

The owner uses `/privacy`. `FarmPrivacyPage` exposes the explicit sharing
switch, requires confirmation before turning sharing on, never queues privacy
changes offline, and refreshes access after a confirmed server save. NF requires
OFF → ON at 08:15 (rep epoch `1 → 2`) and ON → OFF at 10:00 (epoch `2 → 3`).
Only the farm sharing value/version and named-rep epoch may change.

The worker uses `/tasks` to create task `27061000-0000-4000-8000-000000000002`
with title `Inspect North Home gate`, details `Check synthetic gate latch.`,
normal priority, `todo`, due `2027-02-10`, source `manual`, assigned to the
worker and linked to North Home 80. The manager later changes only that task to
`done`; the database owns `completed_by`, `completed_at`, version, and
`updated_at`.

The rep may read only the sharing-enabled private surfaces and may not edit.
The read-only member may read allowed operational data but may not create,
update, or delete. The outsider may not select/read/write North Fork. An open
rep tab must lose access after NF-7 and must not keep North private data current.

### Storage and non-write boundary

The scenario must inspect the farm access snapshot, selected-farm context,
access-epoch cache, revocation fence/generation ledger, and scoped IndexedDB
workspace keys before and after sharing changes and farm switches. No denied
attempt may create a queue entry or needs-attention record. Switching farms
must clear North private content before publishing the next farm.

Unchanged throughout except for the explicitly named rows: ownership,
memberships, field/crop operational rows, Grain, financial rows, and all other
farms. Rep/read-only/outsider denied writes must leave table counts and row
versions unchanged.

### Classification

- **Proof gap:** the current repository contains no complete NF fixture,
  multi-role browser sequence, stale-rep-tab test, or SQL before/after verifier
  tied to the manifest identities and simulated instants.
- **No current NF product defect proven:** current SQL and client capabilities
  already model the required owner, manager, worker, read-only, rep, and
  outsider boundaries; the sharing trigger advances the rep epoch; and the task
  row visibly moves to Done after refresh. The quick-action path does not expose
  the same durable receipt component used by task creation, but the NF contract
  does not by itself prove that this is a blocking defect. Treat it as a
  cross-workflow trust hardening candidate, not as authority to widen NF.
- **Proof-time constraint:** `completed_at` is server-owned Postgres `now()`.
  Browser clock injection cannot control it. The disposable backend needs a
  governed database-clock seam, and the harness must prove the value came from
  that server seam; it must not patch the product row after the UI action.

### Bounded tranche

1. Build one deterministic NF fixture and SQL baseline/verifier.
2. Run owner, rep, worker, read-only, manager, stale-rep-tab, and outsider
   browser lanes on desktop and phone; directly exercise denied writes as well
   as hidden navigation.
3. Prove both epoch advances, exact task insert/completion, zero denied writes,
   and stale private-content removal. Require fresh Sol adversarial review.
4. Make a product change only if this exact execution exposes a defect. Any
   broader task-receipt tranche remains separately governed.

## PS — Prairie Spray compliance presence

### Exact contract and current path

The manager uses Inventory `/inventory` → **Spray record** at
`2027-06-15T14:10:00-05:00`. Prairie South 120, its 2027 `soybeans`
assignment, and `Synthetic Herbicide 41` are selected. The UI submits the
manifest application and application-product IDs with 120.00 acres, date/time,
`Synthetic broadleaf`, `Scenario Operator`, literal license
`PRESENCE-ONLY-2027`, manually typed 8.0 mph/SW/74.0°F/52%, and product rate
`0.0625 gal/acre`, total `7.50 gal`, no package factor, status completed.

The canonical application RPC and repository already preserve application and
label snapshots and derive inventory use in the canonical unit. The target
state is exactly one application row and one product row; on-hand changes
100.00 → 92.50 gal.

### Writes and non-writes

Allowed writes are the manifest completed application, manifest product line,
their idempotency receipt, and the derived inventory effect. No second
application is accepted on retry.

Programs, provider/provenance data, Crop RX delivery data, tasks,
notifications, Grain, scouting, and unrelated Inventory rows/counts/versions
remain unchanged. Weather values are manual input; no Weather-to-application
link exists or is requested.

### Classification

- **Proof gap:** the product path and database snapshot logic exist, but no
  governed PS fixture/browser/SQL packet currently proves the exact IDs,
  snapshots, inventory arithmetic, idempotent retry, and all negative tables.
- **Product defect:** the saved Compliance card retains the required values but
  visibly surfaces only field/date, product names/acres, missing-check results,
  and a label summary. It does not show the saved time, pest, applicator/license,
  wind, temperature, humidity, or product rate/total. PS explicitly proves that
  these facts are retained **and surfaced**, so the current UI cannot pass.
- **Receipt hardening candidate:** Spray currently uses a generic page success
  message rather than an ID-bound shared receipt. That is relevant to the
  season-wide trust goal, but the missing saved-detail surface is the directly
  proven PS blocker.
- **Out of scope:** this proves presence and retention of compliance-looking
  fields only. It does not validate a license, label legality, eligibility,
  expiration, or jurisdiction.

### Bounded tranche

1. Expand the existing saved Compliance record using already-loaded snapshots
   so the literal saved facts and rate/total are visible. Add no schema,
   compliance service, or eligibility claim.
2. Add focused saved-detail derivation/rendering regressions and preserve the
   explicit presence-only wording. Any shared-receipt wiring must remain a
   separately bounded existing-save hardening slice.
3. Build the deterministic Prairie fixture and desktop/phone UI gauntlet, plus
   SQL verification of exact snapshots, 7.50-gal arithmetic, one receipt, and
   every named non-write. Require fresh Sol adversarial review.

## HR — Harvest Ridge Grain truth

### Exact contract and current path

The owner starts with estimate `32000.00`, `actual_bushels = null`, projected
math; a 30,000.00-bu baseline in a 40,000.00-bu bin; and contract
`HR-2027-001` for 5,000.00 bu with zero delivered.

At 17:30 the owner uses `/harvest` to save 27,600.00 bu on Harvest Bottom 160.
Only the crop-assignment harvest actual fields may change. At 17:40 Grain's
existing reconciliation view must show Harvest actual 27,600 and Grain actual
`not entered`, still projected, with no write. At 17:45 the owner explicitly
confirms **Use harvest total as Grain actual**; only estimate
`27070000-0000-4000-8000-000000000004` becomes actual 27,600 and
`drives_math = actual`.

On November 6 the owner adds manifest append-only Out movement
`27074000-0000-4000-8000-000000000004`, 5,000.00 bu `corn_yellow`, source
`manual entry`, note `Delivery to Synthetic Elevator`, reducing bin on-hand to
25,000.00. Separately the owner records manifest delivery
`27072000-0000-4000-8000-000000000004`, 5,000.00 bu, date `2027-11-06`, null
note, making contract delivered 5,000.00. The UI already states that recording
a delivery does not remove grain from a bin; the database uses separate locked
RPCs.

### Writes and non-writes

- HR-1: crop-assignment harvest fields only; no estimate/bin mutation.
- HR-2: zero writes.
- HR-3: production actual and math basis only; no harvest/bin mutation.
- HR-4: one append-only bin transaction; no contract/delivery/estimate change.
- HR-5: one contract-delivery row; no bin transaction, bin balance, or
  production change.

No automatic Grain reconciliation, bin/contract coupling, or lot creation is
allowed. After a clean reset, HR-4 and HR-5 must also pass in reverse order
with identical final database state and no hidden coupled mutation.

### Classification

- **Proof gap:** the product has distinct harvest, explicit reconciliation,
  locked bin-movement, and locked delivery paths, but there is no complete HR
  fixture or two-order desktop/phone/SQL gauntlet using the manifest IDs.
- **Product defect:** Harvest save has no durable visible receipt. Grain
  movement and delivery use local messages and retry drafts rather than the
  shared save-receipt state. These existing high-value writes need honest
  Saving/Saved/Needs-attention confirmation before HR can be accepted.
- **Not a defect:** the absence of automatic coupling and lots is intentional
  and must be proven as a negative assertion, not implemented.

### Bounded tranche

1. Reuse the receipt component for Harvest, manual bin movement, and contract
   delivery while preserving their existing idempotent IDs and retry drafts.
2. Add focused lost-response, double-click, capacity, over-delivery, and
   cross-operation non-coupling regressions.
3. Build deterministic HR baseline and exact SQL verifier. Run normal and
   reverse November orders from separate clean resets on desktop and phone.
4. Compare complete relevant table sets after each step and final state; require
   fresh Sol adversarial review.

## CC — Cedar Creek weather and scouting

### Exact contract and browser storage

The owner uses Cedar West 40 at fixed coordinates `38.210000,-89.120000` and
fixed page time `2027-07-07T13:20:00-05:00`. Playwright must intercept the
contract's exact Open-Meteo URL. For the fresh lane it fulfills exactly one
provider-shaped response inside the test process; no packet leaves the process.
The weather service normalizes and stores key
`farm-rx-weather:v1:38.210:-89.120` with outer and bundle `fetched_at =
2027-07-07T18:20:00.000Z`; runtime adds `stale = false`. UI must show the exact
74°F, 8 mph SW, 10-mph gust, 52% humidity, 0.00-in rain, **Good / Spray now**,
and five good hourly samples.

The owner manually transcribes those values into Inventory's Spray record for
40.00 acres and saves the manifest Cedar application/product IDs with
`0.125 gal/acre`, 5.00 gal total, literal license text, and the exact seeded
label snapshot. On-hand changes 20.00 → 15.00 gal.

For stale fallback, the harness replaces only the exact weather key with the
contract's normalized 100-minute-old envelope, aborts the exact provider URL
inside Playwright, and reopens Weather. Runtime must set `stale = true` and show
all four contract warnings, with no actionable spray window.

Finally the owner uses `/scouting` → Cedar West 40 → **New scouting note** to
save manifest note `Synthetic waterhemp along west edge`, category `weed`, no
coordinates, photos, task, or notification. The save receipt must remain
visible even while Weather is stale.

### Writes and non-writes

Allowed product writes are one application, one application product, and one
scouting note, plus their normal idempotency receipts. Weather may write only
its browser cache. No provider/provenance product row is created.

Weather never auto-fills or auto-saves Spray. `scouting_photos`, `farm_tasks`,
notifications, Programs, Grain, field-location, and unrelated Inventory rows
remain unchanged. No photo upload, location capture, task, or notification is
part of CC.

### Classification

- **Proof gap:** exact request interception, normalized cache bytes, fresh and
  stale UI states, manual transcription, and cross-module SQL non-writes are not
  currently assembled into one governed CC gauntlet.
- **Product defect:** Scouting closes and refreshes (or projects a pending row)
  without publishing a save receipt; its visible notice is delete-only. CC
  explicitly requires the Scouting receipt to remain visible across the stale
  Weather lane, so Scouting is the blocking receipt defect.
- **Hardening candidate, not a CC blocker:** Spray already renders the
  action-specific `Spray record saved...` status required to confirm CC-2.
  Converting it to an ID-bound shared receipt may support the broader trust goal,
  but CC does not authorize making that a prerequisite for this gauntlet.
- **Not a defect:** no provider database, provenance link, or automatic weather
  transcription exists. The contract explicitly requires those non-features to
  remain absent.

### Bounded tranche

1. Apply the Scouting shared-receipt repair with focused online, offline,
   replay, lost-response, and double-submit regressions. Preserve and assert
   Spray's existing action-specific success status.
2. Build deterministic Cedar product/inventory/application/scouting fixtures.
3. Add exact Playwright fulfill/abort routes and cache-byte assertions; fail on
   any unhandled external request.
4. Run fresh and stale lanes plus manual Spray and Scouting on desktop and
   phone; verify exact SQL writes/non-writes and require fresh Sol review.

## PH — Pine Hill offline custody and revocation

### Exact contract and storage

Pine begins with the worker's active membership, epoch `1`, selected Pine North
60, an empty Field Log queue, and exact v2 fence and independent generation
ledger at generation `1`, initial manifest token, server epoch `1`, not revoked,
changed at `2027-08-04T13:55:00-05:00`.

Field Log uses queue key
`farm-rx-field-log-write-queue:v1:<projectRef>:<userId>:<farmId>`. Workspace
cache is scoped in IndexedDB database `farm-rx-offline-v1-<projectRef>`.
Revoked work is moved only after durable readback to
`farm-rx-revoked-work-recovery:v1:<projectRef>:<userId>`; the active queue is
then removed and the farm's readable workspace cache deleted. The recovery UI
states that work will never send automatically and supports export and explicit
dismissal.

PH-1 saves connected note `Synthetic north fence washed out` offline with the
manifest note and operation IDs. UI must show **Saved on this device — waiting
for signal**, one pending row, and exact operation-era user/farm/generation/
token/epoch custody while the database remains unchanged. PH-2 reconnects at
epoch `1`, writes that row exactly once, clears only its matching queue head,
and proves two more retries are no-ops.

PH-3 similarly queues `Synthetic revoked-user note`. PH-4 is the only
fixture-controller mutation: update exactly the Pine+worker membership from
active to revoked and prove its trigger advances epoch `1 → 2`. It must not
touch browser storage, another membership, or a product row.

PH-5 revalidation must learn epoch `2`, fail upload closed, and write exact
fence and ledger generation `3`, revoked manifest token, server epoch `2`,
revoked true, changed at 14:45. The pending work must be exportable from the
recovery surface and must never become another account/farm's queue. PH-6
proves reload/switch cannot show Pine as current or replay it.

### Current product defects

1. **Operation-era authorization is not persisted.** The v1 Field Log queue
   stores operation ID, user, farm, timestamp, and draft, but not captured fence
   generation, token, or server epoch. Replay captures the current fence anew.
   The contract's exact PH-1/PH-3 custody and same-ID revoke/regrant guarantee
   therefore cannot be proven.
2. **Revoked epoch is not observable.** `get_current_farm_access_epochs()`
   filters rows through `can_access_farm`, and client `loadServerEpochs` accepts
   only currently accessible farms. After membership revocation, Pine vanishes
   from the farm list and the removal path knows only prior epoch `1`.
   `markFarmRevoked` consequently produces generation `2`, a random token, and
   server epoch `1`, not required generation `3`/manifest token/epoch `2`.
3. **Fixture/proof gap.** The manifest names Pine IDs, but no complete Pine
   disposable fixture, exact browser sequence, membership controller, or SQL
   verifier currently exists.

### Corruption boundary

Malformed or mismatched queue bytes fail closed and are not overwritten.
During revocation, unreadable active queue bytes make quarantine stop with
`Nothing was cleared`; they are not silently converted into replayable or
exportable work. A separate negative case must prove exact corrupt bytes remain,
zero rows are written, and no false recovery record is published. Corrupt
recovery-vault bytes must render the existing needs-attention alert and remain
undismissed. The valid PH queue must still be durably quarantined and exported.

### Bounded repair and harness tranche

1. Add a backward-compatible Field Log queue contract for newly captured work
   that persists the exact operation-era fence snapshot. A legacy v1 entry has
   no truthful historical fence identity and must therefore fail closed and be
   durably quarantined/recovered for explicit user review, never upgraded from
   the current fence or automatically sent. Add regrant, lost-response, legacy,
   and corruption regressions.
2. Add a narrow database/client mechanism for a signed-in user to read one
   requested, already-known removed-farm epoch only when that exact user has a
   historical revoked/suspended membership or revoked rep grant. It must reject
   arbitrary farm enumeration and all outsider, cross-user, and cross-farm
   requests. Parse accessible and removed epochs separately and use
   authoritative revoked reset. Starting at generation `1` with server epoch
   `2`, the existing reset rule yields generation `3`. The browser UUID seam
   supplies the manifest revoked token deterministically.
3. Build Pine fixture/controller, desktop+phone Field Log sequence, exact
   localStorage/IndexedDB byte assertions, and SQL verifier for one connected
   write, zero revoked writes, epoch mutation, receipts, and all non-writes.
4. Add separate corrupt active-queue and corrupt recovery-vault negative lanes.
   Run full regression/build/disposable reset and fresh Sol adversarial review.

## Governed execution order

The smallest coherent implementation order is:

1. **Directly proven product gaps:** saved Spray/compliance detail visibility,
   the accepted cross-workflow receipt gaps, and PH authorization custody. Keep
   each repair as its own bounded tranche; do not use one scenario to authorize
   unrelated UI expansion.
2. **PH authorization custody:** backward-compatible queue snapshot plus
   authoritative removed-farm epoch handling.
3. **Fixtures and verifiers:** one deterministic fixture and exact SQL verifier
   per scenario; no live services or customer data.
4. **Browser gauntlets:** desktop and phone, pinned clocks, controlled network,
   exact storage/UI checks, and complete write/non-write comparisons.
5. **Acceptance:** immutable commits, fresh-context Sol adversarial review for
   each bounded tranche, then a final governed-scenario review. No push,
   deployment, live migration, secret/auth change, customer action, or
   destructive action occurs without its explicit approval gate.
