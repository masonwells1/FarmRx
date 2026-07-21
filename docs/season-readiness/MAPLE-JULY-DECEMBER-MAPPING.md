# Maple Ridge July-December mapping

**Mapping snapshot:** `fc232173ba2cc8f6340e6cad2c390c54430dd308` on `codex/farmrx-2027-season-ready`
**Controlling sources:** [`WORKFLOWS-AND-SCENARIOS.md`](WORKFLOWS-AND-SCENARIOS.md), [`ORCHESTRATOR-RUNBOOK.md`](ORCHESTRATOR-RUNBOOK.md), [`SCORECARD.md`](SCORECARD.md), and [`../GOAL.md`](../GOAL.md)
**Fixture source:** [`../../tests/season/season-2027.manifest.json`](../../tests/season/season-2027.manifest.json)

## Evidence boundary

This document is a read-only design map. It records source-derived UI paths, data ownership, expected writes and non-writes, known defects, fixture needs, and the proof still required for Maple Ridge July through December. It is **not** runtime evidence, an accepted evidence packet, a Sol verdict, or a claim that any month below has passed.

The continuous Maple scenario must reset once before January and preserve the same disposable local database through December. A month cannot be upgraded to **PROVEN** from this mapping, a committed harness, chat-reported output, or a narrow test. The runbook's full evidence and fresh exact-SHA Sol review requirements still apply.

No new module, integration, vendor, automatic coupling, year-end finalization entity, or proof-only product column is authorized. The mapped repairs are limited to honest save receipts on existing writes and the removal of a hidden zero-effect write.

## Shared fixture identity and retained state

July begins with the accepted contract outcomes from January through June, whether or not the current branch has yet re-proven them continuously:

- owner `27000000-0000-4000-8000-000000000001` on Maple Ridge `27010000-0000-4000-8000-000000000001`;
- Maple East 160 field `27020000-0000-4000-8000-000000000001`, owned arrangement `27021000-0000-4000-8000-000000000001`, and 2027 Yellow Corn assignment `27030000-0000-4000-8000-000000000001`;
- Inventory product `27040000-0000-4000-8000-000000000000`, received at 100.00 gal and reduced to 90.00 gal only by the completed June application;
- Program `27050000-0000-4000-8000-000000000001`, assignment `27052000-0000-4000-8000-000000000001`, applied assigned pass `27053000-0000-4000-8000-000000000001`, free-typed assigned product `27053100-0000-4000-8000-000000000001`, and unchanged draft application `27054000-0000-4000-8000-000000000001`;
- completed application `27043000-0000-4000-8000-000000000000` and product line `27044000-0000-4000-8000-000000000000`;
- the preseeded Maple cash bid `27070500-0000-4000-8000-000000000001`, whose exact value stability must be asserted rather than inferred from row count.

Every later month must snapshot and retain all earlier manifest rows, versions, counts, and derived totals outside that month's explicit write allowance.

## Status summary

| Month | Mapping status | Existing behavior decision | Executable proof state |
|---|---|---|---|
| July | **PRODUCT-BLOCKED** | Scouting save lacks an honest visible receipt; the separately created Task already has a form-save receipt. | No accepted July browser/SQL packet. |
| August | **PRODUCT-BLOCKED** | Task quick actions (`Start`, `Done`, `Reopen`) save durably but do not publish the existing receipt to the Tasks page. | No accepted August browser/SQL packet. |
| September | **PRODUCT-BLOCKED** | Harvest closes its editor after save but does not show the existing honest receipt states. | No accepted September browser/SQL packet. |
| October | **PROOF-ONLY GO (mapping only)** | The explicit Grain estimate then Harvest-to-Grain reconciliation workflow is source-real; no product correction was identified by mapping. | No accepted October harness or runtime packet. |
| November | **PRODUCT-BLOCKED** | Grain storage/contract/delivery writes lack action-specific honest receipt coverage; the generic saved timestamp can belong to a different action. | No accepted November browser/SQL packet. |
| December | **PRODUCT-BLOCKED** | A zero-effect Program due-item check inserts a hidden repository receipt during live access restoration/reload. | No accepted closeout harness or zero-write packet. |

`PROOF-ONLY GO` means only that source inspection did not identify a required product repair for the stated workflow. It is not **PROVEN** or **STATIC-ACCEPTED**.

## July - scouting note and separate manual task

**Contract instant:** `2027-07-09T16:10:00-05:00`
**Direct UI paths:** `/scouting`, then `/tasks`

### Source-real farmer path

1. Open Scouting, locate the `Maple East 160` card, choose **New scouting note**, and save:
   - manifest note ID `27060000-0000-4000-8000-000000000001`;
   - observed date `2027-07-09`;
   - category `weed`;
   - note `Synthetic waterhemp at south gate`;
   - null latitude/longitude, no photos, and **Add a follow-up task** unchecked.
2. Open Tasks, choose **Add task**, and save manifest task `27061000-0000-4000-8000-000000000001` with title `Inspect Maple south gate`, details `Check synthetic waterhemp patch.`, `todo`, normal priority, owner assignment, due `2027-07-10`, Maple East linkage, and source `manual`.

The source controls are owned by `src/ScoutingModule.tsx` and `src/EquipmentTasksModule.tsx`. Data flows through `QueuedScoutingRepository`/`SupabaseScoutingRepository` and `QueuedEquipmentTasksRepository`/`SupabaseEquipmentTasksRepository`; schema ownership begins in migrations `0020_scouting.sql` and `0016_equipment_tasks.sql`.

### Expected writes and non-writes

- Exactly one `scouting_notes` row and one separately submitted `farm_tasks` row.
- Zero `scouting_photos` and zero scouting-created notifications or tasks.
- No application, Program status, Inventory, Grain, field/crop, or cash-bid mutation.
- Merely opening Scouting, opening Tasks, or opening either form is a non-write.

### Existing defect and bounded repair

`ScoutingFieldCard.save` closes the form and refreshes or projects pending data, but neither `QueuedScoutingRepository` nor the page publishes an entity-ID-bound `Saving`, `Saved`, `Queued offline`, or `Needs attention` state through the existing `SaveReceipt` mechanism. A busy farmer cannot distinguish a confirmed save from an uncertain close. This is an existing-workflow trust defect, not a request for a new workflow.

The bounded repair should reuse the shared receipt component and repository receipt identity. It must cover connected success, offline queueing, replay success, terminal failure, and double-submit locking without changing Scouting row shape or creating a follow-up task when the checkbox is off. The manual Task form already wires a receipt and should be asserted, not redesigned in the July tranche.

### Fixture and harness boundary

- No new product UUID is needed beyond the manifest note and task IDs.
- Deterministic browser UUID injection must target only the Scouting note, Task, and their queue operation IDs; operation IDs remain proof infrastructure and must not be added to product tables.
- The July runner must chain from June without reset, run desktop and phone-sized projects, block external traffic, and capture before/after database state around each of the two separate buttons.
- Required UI evidence: Scouting receipt and timeline row; Task receipt and To Do card. Required database evidence: exact two rows, zero photos/notifications, and retained January-June state.

## August - complete the manual task

**Contract instant:** `2027-08-17T13:00:00-05:00`
**Direct UI path:** `/tasks`

### Source-real farmer path

Open Tasks, locate `Inspect Maple south gate` in **To Do**, choose **Done**, and reload. `TaskColumn.move` in `src/EquipmentTasksModule.tsx` sends the complete existing task snapshot with `status = done` and its optimistic `expected_updated_at` through the Equipment/Tasks repository.

### Expected writes and non-writes

- Only task `27061000-0000-4000-8000-000000000001` changes.
- Canonical status becomes `done`; server-owned `completed_by` and `completed_at` reflect the owner and simulated instant; version/`updated_at` advances exactly once.
- No second task, notification, Program, scouting, Inventory, Grain, Fields, equipment, or service row changes.
- Opening or reloading Tasks is a non-write in the continuous fixture.

### Existing defect and bounded repair

Task creation/editing exposes the page-level receipt, but `TaskColumn.move` discards the receipt identity returned by `saveTask`; the quick actions `Start`, `Done`, and `Reopen` therefore do not drive `SaveReceipt`. The bounded repair should route the existing operation/receipt ID to the Tasks page and preserve the submit lock. It must not change completion ownership, server time, task source rules, or Program-owned task restrictions.

### Fixture and harness boundary

- Reuse the July manifest task; no new product ID.
- Run only after July on the same database. Browser/data clock injection does not control Postgres `now()`: the disposable backend must have a governed database-clock seam aligned to the August instant, and the proof must show `completed_at` came from that server seam rather than patching the row after the UI action.
- Prove one click produces one version change; a rapid second click does not produce a second transition; offline/transport ambiguity shows an honest pending state and replay does not duplicate or overwrite unrelated fields.
- UI evidence must show the receipt and the card in **Done** after reload, including completion metadata.

## September - record harvest

**Contract instant:** `2027-09-28T18:05:00-05:00`
**Direct UI path:** `/harvest`

### Source-real farmer path

Open Harvest, choose crop year `2027`, find Maple East 160, choose **Enter harvest**, enter 30,800.00 bu, date `2027-09-28`, actual price `$4.250000`, and choose **Save harvest**. The write is owned by `src/HarvestModule.tsx`, `QueuedHarvestRepository`, `SupabaseHarvestRepository`, and the existing versioned Fields/crop-assignment path.

### Expected writes and non-writes

- Only crop assignment `27030000-0000-4000-8000-000000000001` changes: `harvested_bushels`, `harvest_date`, `actual_price_per_bu`, and server version fields.
- Grain production remains absent/projected at this point; no production estimate, contract, delivery, bin, movement, lot, task, notification, Program, Inventory, or application mutation.
- Visible derived results after save/reload are 192.5 bu/ac, 7.5 bu/ac under the 200 bu/ac plan, and $130,900.00 actual revenue.

### Existing defect and bounded repair

The Harvest form closes after a successful repository call and projects/reloads the saved crop, but it does not expose the shared honest save receipt. The bounded repair should wire the existing receipt states without changing crop arithmetic, optimistic versioning, queue semantics, or the form itself.

### Fixture and harness boundary

- The crop-assignment ID is retained from January; no new product UUID.
- Chain from August. Snapshot the complete crop row before the button and assert the exact allowed columns/version delta afterward.
- Prove connected, offline/replay, terminal failure, and double-click behavior. Assert Grain tables and all earlier scenario tables remain byte/count stable.
- Run desktop and phone-sized browser coverage and reload the Harvest page before accepting the visible totals.

## October - create Grain estimate and explicitly reconcile Harvest

**Contract instant:** `2027-10-19T08:40:00-05:00`
**Direct UI path:** `/grain`

### Source-real farmer path

1. In **Start your grain estimate**, enter APH/expected yield `200.0000` and choose **Create estimate** for 2027 Yellow Corn.
2. After the page becomes the Grain position view, confirm Harvest actuals are 30,800.00 bu and Grain actual is `not entered`.
3. Choose **Use harvest total as Grain actual** and accept the exact confirmation that the action changes Grain actual only and does not change bins.

The UI is owned by `src/GrainModule.tsx`; the write path is `QueuedGrainRepository`, `SupabaseGrainRepository`, and their gateways. Core schema originates in `0004_module2_grain.sql` with later live/version support migrations.

### Expected ordered writes and non-writes

- First write: insert production estimate `27070000-0000-4000-8000-000000000001` with 160.00 planted acres, APH 200.0000, expected 32,000.00 bu, null actual, and `drives_math = projected`.
- Second write: update that exact row to actual 30,800.00 and `drives_math = actual`, retaining APH, expected bushels, identity, and null scope fields.
- Harvest/crop row remains unchanged across both actions.
- Cash bid, bins, bin inventory, bin movements, contracts, deliveries, lots, and unrelated rows remain unchanged; no storage or sale row is automatically created.

### Mapping decision and risks to prove

This lane is a **proof-only GO at mapping level**: the source contains the explicit two-step workflow and disclosure, and no required product correction was identified. Runtime proof must still defeat these risks:

- deterministic identity for the newly inserted production estimate;
- exactly two ordered writes, including optimistic-version behavior and lost-response replay;
- no implicit Harvest-to-Grain coupling before confirmation and no bin coupling after confirmation;
- no unexpected marketing-alert transition on page refresh. Maple has no alert rule in the fixture, so `firedRuleIds` must remain empty and alert tables byte/count stable.

### Fixture and harness boundary

- Use manifest estimate ID `27070000-0000-4000-8000-000000000001`; do not accept a runtime-generated product ID.
- The fixture needs the retained exact cash-bid values, not merely one row count.
- Chain from September, run desktop and phone-sized views, capture state after each of the two buttons, and assert the confirmation copy and reconciliation values after reload.

## November - independent bin, contract, movement, and delivery writes

**Contract instant:** `2027-11-10T11:25:00-06:00`
**Direct UI paths:** `/grain/storage` (**Bins & basis**) and `/grain/contracts` (**Contracts**)

### Source-real farmer path

Perform five independent actions in contract order, capturing state after every button:

1. Create bin `27073000-0000-4000-8000-000000000001`, `Maple North Bin`, capacity 40,000.00 bu, on-farm, location Maple Ridge.
2. Append In movement `27074000-0000-4000-8000-000000000000`, 30,800.00 bu Yellow Corn, occurred `2027-09-28`, note `2027 harvest load-in`.
3. Create cash/spot contract `27071000-0000-4000-8000-000000000001`, Buyer `Synthetic Elevator`, 5,000.00 bu at $4.25, delivery `2027-11-10` through `2027-12-15`, number `MR-2027-001`, zero premium, null notes.
4. Append Out movement `27074000-0000-4000-8000-000000000001`, 5,000.00 bu dated `2027-11-10`, note `Delivery to Synthetic Elevator`.
5. Record delivery `27072000-0000-4000-8000-000000000001`, 5,000.00 bu dated `2027-11-10`, null note, against the manifest contract.

### Expected writes and non-writes

- Exactly one row per action: one bin, two append-only `bin_transactions`, one `grain_contract`, and one `grain_contract_delivery`.
- Bin on-hand progresses independently: 0 -> 30,800 -> 25,800 bu.
- Contract delivered total remains 0 until action 5, then becomes 5,000; delivery never adds a bin movement.
- Bin creation/In does not create a contract or delivery; contract creation does not move grain; Out does not record delivery.
- No `bin_inventory` baseline, grain lot, second transaction, second delivery, notification, task, Inventory, Harvest, Program, Scouting, or cash-bid change.

### Existing defect and bounded repair

The Grain page uses a generic `Saved <time>` whisper shared across actions. It can remain visible from a prior storage or contract action and is not an honest action-specific receipt for bin creation, movement append, contract creation, or delivery recording. The November tranche should attach stable operation identities to the existing shared receipt states and render the receipt beside the action that owns it. It must preserve the deliberate independence of storage and delivery.

This is one coherent trust tranche only if the implementation reuses the same receipt primitive without altering the five business operations. Otherwise split it into smaller immutable commits under the runbook.

### Fixture and harness boundary

- All five product IDs already exist in the manifest. Operation IDs remain deterministic harness inputs, not schema additions.
- Chain from October. Capture canonical database state after each action, not only final totals.
- Exercise lost-response replay for append-only movement and delivery identities; assert no duplicate row and no FIFO blockage.
- Run desktop and phone-sized projects. Assert Contracts and Bins routes separately after reload because their tab state is URL-owned.

## December - read-only whole-year closeout

**Contract instant:** `2027-12-15T09:30:00-06:00`
**Direct UI paths:** `/fields`, `/grain`, `/grain/contracts`, `/grain/storage`, `/inventory`, `/programs`, `/harvest`, `/scouting`, `/tasks`

### Required visible reconciliation

- **Fields:** 1 field, 160 acres, crops assigned 1/1; Maple East 160 / Yellow Corn / Owned.
- **Grain Overview:** Harvest actual 30,800 bu, Grain actual 30,800 bu, all-bin balance 25,800 bu, Harvest-minus-Grain 0.
- **Contracts:** Synthetic Elevator, `MR-2027-001`, Cash/spot, 5,000 bu at $4.25, delivered/remaining 5,000/0.
- **Bins & basis:** Maple North Bin, 25,800/40,000 bu, 65% full.
- **Inventory -> Compliance:** Maple East 160 completed application dated 2027-06-18, known product, 160 acres, and retained application/weather facts. Null seeded REI/PHI/label-maximum facts must remain visibly unknown; this is not a legal-eligibility claim.
- **Programs -> Season progress:** applied 2027-05-20 on 160 acres, application linked, free-typed Program lines explicitly did not change on-hand.
- **Harvest:** 192.5 bu/ac, 7.5 bu/ac under plan, $130,900.00 actual revenue.
- **Scouting:** Weed, 2027-07-09, `Synthetic waterhemp at south gate`, no photo/location/pending marker.
- **Tasks:** `Inspect Maple south gate` appears in Done with completion metadata and not in To Do/Doing.

Opening and reloading every view is expected to write nothing.

### Existing hidden-write defect

Live farm-access restoration calls `replayAuthorizedFarmWork` in `src/App.tsx`, which invokes `generateDueProgramItems` through `src/data/index.ts` and `src/data/programDueItems.ts`. `generate_due_program_items` in migration `0024_programs.sql` unconditionally inserts a new `repository_write_receipts` row even when it creates zero tasks and zero notifications. A full document reload can therefore mutate the database during the required read-only closeout.

Simply omitting a 0/0 receipt is not safe: today that receipt consumes the operation ID, while an unrecorded operation could be replayed after eligibility changes and then mutate a different result. The preferred bounded design is a read-only eligibility preflight used by startup so it skips the mutating RPC when nothing is due, while explicit generation keeps its existing operation-consumption and idempotency semantics. If implementation instead changes 0/0 receipt behavior, it must first define whether an operation ID is consumed and prove that the same ID cannot later produce a different result. This design remains unimplemented and unproven here.

The RPC also rejects `p_local_date` outside Postgres `current_date ± 1`. A simulated December 2027 browser clock does not change Postgres `current_date`, so the disposable backend needs a governed database-date/time seam aligned with the contract before the closeout can reach the intended zero-effect path.

Required focused repair proof:

1. With the disposable database date aligned to December 15, the read-only preflight reports no eligible Maple work and startup does not call the mutating RPC or add a receipt.
2. Repeated and concurrent preflights remain read-only and cannot race into generation.
3. A planned due pass calls generation and creates exactly one task, one notification, and one receipt.
4. Same-operation replay and a lost response return the same result without duplicates.
5. Reusing an operation ID across an eligibility change cannot produce a different canonical result; prove the chosen consumption rule explicitly.
6. A later startup after canonical items exist again preflights to no work and writes nothing.
7. Fresh Sol review inspects concurrency, lost-response, operation-consumption, and idempotency semantics.

### Other background-writer fences

- Grain refresh can record marketing-alert transitions if a rule fires. The Maple fixture must have no applicable rule; alert rules/transitions and notifications must remain stable.
- Farm restoration runs Equipment due generation. Maple has no equipment/service intervals; all equipment, interval, service, meter, and task rows must remain stable.
- All module queues must begin empty and remain empty. A parked or pending operation invalidates the closeout rather than being silently replayed.
- Inventory's Compliance tab and Programs' Season progress tab are component state, so a full reload returns to their default views; select the tab again before reasserting visible closeout evidence.

### December harness boundary

- Chain from November without reset.
- Before first navigation, after every full reload, and at the end, capture canonical ordered rows and counts for access state; Fields; Inventory/applications; Programs; Scouting; Tasks; Grain/cash bids/contracts/deliveries/bins/movements; notifications; equipment/service; marketing alerts/transitions; and `repository_write_receipts`.
- Every snapshot must match byte-for-byte. A UI-only request counter is insufficient because read-shaped startup RPCs use POST and hidden server writes are possible.
- Run desktop and phone-sized projects with local-only traffic. Assert no `Saving`, `Queued offline`, or `Needs attention` receipt remains in a fresh read-only browser.
- Do not create a finalization row, rollover row, sync row, or other December product artifact merely to mark the scenario complete.

## Cross-month implementation and proof order

1. Obtain Mason's approval for the multi-file receipt-hardening tranche before product edits.
2. Repair the existing Scouting, Task quick-action, Harvest, and Grain action receipts in reviewable bounded commits; split where behavior ownership or proof differs.
3. Give every repair focused connected/offline/replay/failure/double-submit proof, full relevant regressions/build, and fresh exact-SHA Sol adversarial review.
4. Build July through November browser/SQL lanes in order, each chaining from the previous month without reset and each recording desktop plus phone-sized evidence.
5. Repair the December zero-effect Program receipt in a separate migration tranche and adversarially prove idempotency.
6. Build December closeout and run the full continuous January-December packet on one exact HEAD.
7. Update [`SCORECARD.md`](SCORECARD.md) and append [`LEDGER.md`](LEDGER.md) only from durable executed evidence. Never promote a month from this mapping alone.

## Required evidence packet contents

For every month, record exact commit and parent SHA, migration head, manifest hash, simulated instant, farm/role/network, browser project and viewport, UI evidence paths, before/after SQL evidence, command plus exit code, changed-file/credential checks, and fresh read-only Sol verdict. The eventual full-year packet must additionally prove one reset before January, no reset through December, retained month-to-month identities and totals, and all required non-writes.

No push, pull request, merge, deployment, live database/data, secret/auth/permission, customer account, communication, or destructive action is authorized by this mapping.
