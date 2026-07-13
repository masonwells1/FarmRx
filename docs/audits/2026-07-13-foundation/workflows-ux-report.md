# FarmRx Foundation UX and Write-Safety Audit

**Scope:** static code and docs audit of all user-facing `src/` modules. No network, database, browser, or live-service calls were made. No project files were changed.

## Verdict

**P0 — release blocker:** 57 user-triggerable data or money write paths were found. Only 7 have the required synchronous `useRef` re-entrancy lock. The rest rely on React state or no busy state at all, so a rapid double-tap can start multiple writes before the screen re-renders.

The app has strong durable offline queues and clear “saved on this device” language, but the missing UI locks can place duplicate operations into those same queues. Durable replay does not make two separately generated operation IDs into one operation.

## Findings

### P0 — Double-submit can duplicate inventory, application, program, field, equipment, and profitability records

Most write handlers begin an async call immediately, create a fresh ID, and only then set React state such as `saving` or `submitting`. React state does not update synchronously, so two rapid clicks can both enter the handler.

Examples:

- A farmer taps “Save receipt” twice during weak signal. The handler can create two receipts and, when creating a new product, two product records. Both can increase on-hand inventory and create duplicate purchase-cost history. [InventoryModule.tsx:41](C:\FarmRx\src\InventoryModule.tsx:41)
- A farmer double-taps “Save spray record.” Two application bundles with new IDs can be saved, consuming inventory twice and doubling the compliance record. [InventoryModule.tsx:51](C:\FarmRx\src\InventoryModule.tsx:51)
- A farmer double-taps “Confirm applied.” Two applied-pass operations can be submitted with separate operation IDs, risking duplicate application history and actual-cost reporting. [ProgramsModule.tsx:51](C:\FarmRx\src\ProgramsModule.tsx:51)
- A farmer saves a field’s lease terms and then quickly saves Basics from the same detail page. Each card constructs a whole-field draft from its own captured props, so one save can overwrite the other card’s newer change. [FieldsModule.tsx:166](C:\FarmRx\src\FieldsModule.tsx:166), [FieldsModule.tsx:174](C:\FarmRx\src\FieldsModule.tsx:174), [FieldsModule.tsx:189](C:\FarmRx\src\FieldsModule.tsx:189)
- A farmer taps “Log service” twice. The equipment service cost can be duplicated; the follow-up task-closing loop also has no lock. [EquipmentTasksModule.tsx:17](C:\FarmRx\src\EquipmentTasksModule.tsx:17)
- A farmer double-taps a profitability cost, allocation delete, budget copy, or matrix save. Separate writes can run concurrently and produce a misleading profit picture. [ProfitabilityModule.tsx:120](C:\FarmRx\src\ProfitabilityModule.tsx:120), [ProfitabilityModule.tsx:159](C:\FarmRx\src\ProfitabilityModule.tsx:159)

**Fix:** Every user-triggered write must begin with the same pattern, before creating IDs, constructing payloads, or mutating data:

```ts
const writeLock = useRef(false)

async function submit(...) {
  if (writeLock.current) return
  writeLock.current = true
  try {
    // create IDs and perform the write
  } finally {
    writeLock.current = false
  }
}
```

Keep the visible disabled/busy state too, but it is only a visual aid—not the safety guard.

### P0 — Field detail cards retain cancelled edits and can resubmit stale values

Basics, Yield & price, and Records initialize local state once and their Cancel action only toggles `editing`. Cancel does not restore values from the current saved field. Reopening the card shows cancelled values, and Save can write them later.

- Basics: [FieldsModule.tsx:173](C:\FarmRx\src\FieldsModule.tsx:173), [FieldsModule.tsx:175](C:\FarmRx\src\FieldsModule.tsx:175)
- Yield & price: [FieldsModule.tsx:245](C:\FarmRx\src\FieldsModule.tsx:245), [FieldsModule.tsx:248](C:\FarmRx\src\FieldsModule.tsx:248)
- Records: [FieldsModule.tsx:251](C:\FarmRx\src\FieldsModule.tsx:251), [FieldsModule.tsx:254](C:\FarmRx\src\FieldsModule.tsx:254)

**Farmer failure:** Change a planned corn price, tap Cancel, later reopen the card and save an unrelated correction. The cancelled price is silently included in the whole-object field save.

**Fix:** Build a fresh draft whenever Edit opens, and discard it whenever Cancel closes. Also replace whole-object field saves with focused patches or use one shared, serialized field-editor draft.

### P1 — Offline receipt language is good, but not consistently surfaced after every write

The queue implementation persists typed envelopes, keeps operations until their canonical head is confirmed, and uses “Nothing was deleted” for blocked work. This is solid foundation behavior. [inventoryWriteQueue.ts:5](C:\FarmRx\src\data\inventoryWriteQueue.ts:5), [inventoryWriteQueue.ts:35](C:\FarmRx\src\data\inventoryWriteQueue.ts:35), [writeQueue.ts:51](C:\FarmRx\src\data\writeQueue.ts:51)

However, several screens optimistically close or refresh after a write without showing a per-record pending receipt. This leaves a farmer unable to tell whether a just-entered record is confirmed, waiting for signal, or failed.

Examples include inventory receipt/adjustment/spray, equipment, tasks, and profitability writes. [InventoryModule.tsx:43](C:\FarmRx\src\InventoryModule.tsx:43), [EquipmentTasksModule.tsx:11](C:\FarmRx\src\EquipmentTasksModule.tsx:11), [ProfitabilityModule.tsx:81](C:\FarmRx\src\ProfitabilityModule.tsx:81)

**Fix:** Return and display a single consistent receipt state for every write: “Saved,” “Saved on this device—waiting for signal,” or “Needs attention—Try again.” Link a pending row to the global Sync Notice retry action.

### P1 — Programs “apply” deliberately does not change inventory, but the workflow makes the split easy to miss

The Program tracker allows an applied pass to create/link an application record while stating that products are free-typed and inventory on-hand is not changed. [ProgramsModule.tsx:54](C:\FarmRx\src\ProgramsModule.tsx:54)

That is explicit in the form, but it creates a practical dead end: a farmer can mark a spray applied in Programs and reasonably expect inventory to reflect it, while the system leaves stock unchanged.

**Fix:** Offer an explicit choice at confirmation: “Record program progress only” or “Also create an inventory application record.” If stock cannot be changed from this flow, use a prominent confirmation receipt directing the farmer to Inventory.

### P1 — Grain alert evaluation writes during refresh without a guard

Loading Grain can write `last_triggered_at` for fired alert rules. Repeated refreshes or overlapping mounts can submit this update more than once. [GrainModule.tsx:55](C:\FarmRx\src\GrainModule.tsx:55)

**Fix:** Make alert evaluation a repository-side idempotent operation keyed by rule and trigger period, or guard it with a synchronous ref in the page.

### P2 — Task actions violate the 48px touch-target rule

The global rule starts correctly at 48px, but task-chip links are reduced to 34px and task action buttons to 40px. [app.css:18](C:\FarmRx\src\styles\app.css:18), [app.css:600](C:\FarmRx\src\styles\app.css:600)

**Farmer failure:** On a moving truck, muddy hands, or bright sun, a farmer can miss “Done,” “Reopen,” or linked field/equipment chips.

**Fix:** Remove the overriding heights and use `min-height: 48px` for every interactive task control.

### P2 — The minimum-18px text rule is not met across important farm and money screens

The global base is correct at 18px. [app.css:5](C:\FarmRx\src\styles\app.css:5)

But multiple visible labels and financial explanations override it:

- Field totals and column headers: 15–16px. [app.css:120](C:\FarmRx\src\styles\app.css:120), [app.css:122](C:\FarmRx\src\styles\app.css:122), [app.css:128](C:\FarmRx\src\styles\app.css:128)
- Grain market stamps, eyebrow labels, position labels, footnotes, template details, and month details: 12–16px. [app.css:411](C:\FarmRx\src\styles\app.css:411), [app.css:417](C:\FarmRx\src\styles\app.css:417), [app.css:427](C:\FarmRx\src\styles\app.css:427), [app.css:429](C:\FarmRx\src\styles\app.css:429), [app.css:450](C:\FarmRx\src\styles\app.css:450), [app.css:455](C:\FarmRx\src\styles\app.css:455)
- Equipment status and machine facts: 15–16px. [app.css:597](C:\FarmRx\src\styles\app.css:597)
- Banker and landlord reports: 12–15px, including numeric report cells. [app.css:856](C:\FarmRx\src\styles\app.css:856), [app.css:868](C:\FarmRx\src\styles\app.css:868), [app.css:869](C:\FarmRx\src\styles\app.css:869), [app.css:947](C:\FarmRx\src\styles\app.css:947), [app.css:954](C:\FarmRx\src\styles\app.css:954)

**Fix:** Raise farmer-facing text to 18px minimum, including print reports. Keep compact visual hierarchy with weight, color, spacing, and uppercase—not smaller type.

### P2 — Numeric display rule is structurally supported

The global `tabular-nums` setting and `.numeric` utility are present. [app.css:5](C:\FarmRx\src\styles\app.css:5), [app.css:27](C:\FarmRx\src\styles\app.css:27)

Programs, Weather, Harvest, Grain carry, and profitability tables also explicitly preserve tabular numerals. [app.css:231](C:\FarmRx\src\styles\app.css:231), [app.css:587](C:\FarmRx\src\styles\app.css:587), [app.css:664](C:\FarmRx\src\styles\app.css:664), [app.css:981](C:\FarmRx\src\styles\app.css:981)

No separate numeric-alignment failure was found.

## Complete write-path guard matrix

“Guarded” means a synchronous `useRef` boolean is checked and acquired before ID creation or mutation, and released in `finally`.

| Module | User-triggered write path | Guard |
|---|---|---|
| Setup | Initial farm setup | No — state only |
| Fields | Quick inline add field | **Yes** — `submitting` ref |
| Fields | Basics card save | No |
| Fields | Land agreement save | No |
| Fields | Yield & price save | No |
| Fields | Crop records save | No |
| Fields | Full field editor save | No |
| Grain | Save one marketing target | No |
| Grain | Apply marketing template | No |
| Grain | Save, pause, resume, delete marketing alert | No |
| Grain | Save alert email addresses | No |
| Grain | Create first production estimate | No |
| Grain | Save production estimate / switch actual-projected | No |
| Grain | Save contract | **Yes** — `submitLock` ref |
| Grain | Save firm offer | **Yes** — `submitLock` ref |
| Grain | Fill offer as contract | **Yes** — `submitLock` ref |
| Grain | Save grain bin | **Yes** — `submitLock` ref |
| Grain | Add bin movement | **Yes** — `submitLock` ref |
| Grain | Add cash basis bid | No |
| Grain | Refresh-fired alert timestamp write | No |
| Inventory | Save new product plus receipt / edit draft / receive | No |
| Inventory | Cancel received receipt | No |
| Inventory | Add count adjustment | No |
| Inventory | Save spray/application record | No |
| Equipment | Add or edit machine | No |
| Equipment | Add meter reading | No |
| Equipment | Add/delete service reminder | No |
| Equipment | Log service and close linked tasks | No |
| Equipment | Add service task | No |
| Equipment | Delete service log | No |
| Tasks | Add or edit task | No |
| Tasks | Start, Done, Reopen task | No |
| Tasks | Delete task | No |
| Field Log | Save/edit log entry | No |
| Field Log | Delete log entry | No |
| Scouting | Save/edit note, photo upload, optional task creation | No |
| Scouting | Delete note and photos | No |
| Harvest | Save harvest bushels/date/price | No |
| Programs | Save program | No |
| Programs | Archive program | No |
| Programs | Reorder pass | No |
| Programs | Save/archive pass | No |
| Programs | Assign program to crops | No |
| Programs | Refresh assignment from template | No |
| Programs | Unassign/reassign program | No |
| Programs | Mark pass applied | No |
| Programs | Skip pass | No |
| Programs | Reschedule pass | No |
| Weather | Save GPS/manual field location | No |
| Notifications | Mark one/all alerts read | No |
| Notifications | Turn phone alerts on | No |
| Notifications | Turn phone alerts off | No |
| Profitability | Create budget / U of I starter / copy budget | No |
| Profitability | Save budget fields | No |
| Profitability | Save insurance auto-save | No — queued promise chain is not a ref lock |
| Profitability | Add/edit/delete cost line | No |
| Profitability | Add suggested coaching costs | No |
| Profitability | Save/delete field allocation | **Yes** for save only |
| Profitability | Replace matrix steps | No |

Verified guard implementations:

- Field quick-add acquires its ref before `saveField` and releases it in `finally`. [FieldsModule.tsx:154](C:\FarmRx\src\FieldsModule.tsx:154), [FieldsModule.tsx:156](C:\FarmRx\src\FieldsModule.tsx:156)
- Firm offer, contract, bin, and movement forms all acquire `submitLock.current` before creating IDs and release it in `finally`. [GrainModule.tsx:173](C:\FarmRx\src\GrainModule.tsx:173), [GrainModule.tsx:226](C:\FarmRx\src\GrainModule.tsx:226), [GrainModule.tsx:230](C:\FarmRx\src\GrainModule.tsx:230), [GrainModule.tsx:232](C:\FarmRx\src\GrainModule.tsx:232)
- Profitability allocation save is correctly ref-locked. [ProfitabilityModule.tsx:73](C:\FarmRx\src\ProfitabilityModule.tsx:73), [ProfitabilityModule.tsx:82](C:\FarmRx\src\ProfitabilityModule.tsx:82)

## Journey review

| Journey | Code-walk result |
|---|---|
| Sign-in and first farm setup | Clear loading and error copy; setup save lacks a re-entrancy lock. [App.tsx:136](C:\FarmRx\src\App.tsx:136), [App.tsx:175](C:\FarmRx\src\App.tsx:175) |
| Fields | List, filters, empty filter state, quick add, detail cards, full editor, and validation are present. Quick add is guarded; card cancel/reopen and whole-object concurrent saves are unsafe. [FieldsModule.tsx:149](C:\FarmRx\src\FieldsModule.tsx:149), [FieldsModule.tsx:153](C:\FarmRx\src\FieldsModule.tsx:153), [FieldsModule.tsx:173](C:\FarmRx\src\FieldsModule.tsx:173) |
| Grain | Production, contracts, firm offers, bins, movements, plans, targets, basis, alerts, errors, and empty first-estimate state exist. Contract/offer/bin/movement are guarded; most other grain writes are not. [GrainModule.tsx:192](C:\FarmRx\src\GrainModule.tsx:192), [GrainModule.tsx:217](C:\FarmRx\src\GrainModule.tsx:217), [GrainModule.tsx:234](C:\FarmRx\src\GrainModule.tsx:234) |
| Inventory | Loading, shelf empty/search state, receipt history, draft editing, received-receipt cancellation, adjustments, spray records, validation attributes, and success/error messages exist. Every financial or inventory-changing write lacks the required lock. [InventoryModule.tsx:31](C:\FarmRx\src\InventoryModule.tsx:31), [InventoryModule.tsx:39](C:\FarmRx\src\InventoryModule.tsx:39), [InventoryModule.tsx:49](C:\FarmRx\src\InventoryModule.tsx:49), [InventoryModule.tsx:51](C:\FarmRx\src\InventoryModule.tsx:51) |
| Equipment and Tasks | Loading/empty/error states, add/edit, service history, task board, reopen, and deletes exist. No write guard protects cost, service, meter, reminder, or task mutations. [EquipmentTasksModule.tsx:9](C:\FarmRx\src\EquipmentTasksModule.tsx:9), [EquipmentTasksModule.tsx:15](C:\FarmRx\src\EquipmentTasksModule.tsx:15), [EquipmentTasksModule.tsx:38](C:\FarmRx\src\EquipmentTasksModule.tsx:38), [EquipmentTasksModule.tsx:42](C:\FarmRx\src\EquipmentTasksModule.tsx:42) |
| Weather | Loading, no-fields empty state, GPS/manual location fallback, refresh, and location status messages exist. Location save lacks a lock. [WeatherModule.tsx:38](C:\FarmRx\src\WeatherModule.tsx:38), [WeatherModule.tsx:40](C:\FarmRx\src\WeatherModule.tsx:40), [WeatherModule.tsx:44](C:\FarmRx\src\WeatherModule.tsx:44) |
| Field Log | Loading, empty, add, edit, delete, validation, pending rows, and errors exist. Save/delete have no lock. [FieldLogModule.tsx:24](C:\FarmRx\src\FieldLogModule.tsx:24), [FieldLogModule.tsx:25](C:\FarmRx\src\FieldLogModule.tsx:25), [FieldLogModule.tsx:31](C:\FarmRx\src\FieldLogModule.tsx:31) |
| Scouting | Loading, empty, add/edit/delete, photo validation, offline photo explanation, GPS fallback, pending state, and errors exist. Note/photo/task save and delete have no lock. [ScoutingModule.tsx:27](C:\FarmRx\src\ScoutingModule.tsx:27), [ScoutingModule.tsx:30](C:\FarmRx\src\ScoutingModule.tsx:30), [ScoutingModule.tsx:38](C:\FarmRx\src\ScoutingModule.tsx:38) |
| Harvest | Loading, year selection, no-crop state, entry validation, planting-date validation, cancel, and error message exist. Save lacks a lock. [HarvestModule.tsx:16](C:\FarmRx\src\HarvestModule.tsx:16), [HarvestModule.tsx:45](C:\FarmRx\src\HarvestModule.tsx:45) |
| Programs | Loading/error/retry, empty states, add/edit/archive/reorder, assignment, progress, apply/skip/reschedule, confirmation prompts, and pending labels exist. All mutations lack locks. [ProgramsModule.tsx:10](C:\FarmRx\src\ProgramsModule.tsx:10), [ProgramsModule.tsx:26](C:\FarmRx\src\ProgramsModule.tsx:26), [ProgramsModule.tsx:39](C:\FarmRx\src\ProgramsModule.tsx:39), [ProgramsModule.tsx:51](C:\FarmRx\src\ProgramsModule.tsx:51) |
| Alerts | Loading, empty, retry, mark-read, push availability states, and recovery for failed unsubscribe are present. Alert/push writes lack locks. [NotificationsModule.tsx:46](C:\FarmRx\src\NotificationsModule.tsx:46), [NotificationsModule.tsx:47](C:\FarmRx\src\NotificationsModule.tsx:47), [NotificationsModule.tsx:48](C:\FarmRx\src\NotificationsModule.tsx:48) |
| Profitability and reports | Loading/error, empty first budget, budgets, costs, allocations, insurance, matrix, comparison, and printable reports exist. Allocation save is guarded; nearly every other write is not. [ProfitabilityModule.tsx:81](C:\FarmRx\src\ProfitabilityModule.tsx:81), [ProfitabilityModule.tsx:82](C:\FarmRx\src\ProfitabilityModule.tsx:82), [ProfitabilityModule.tsx:120](C:\FarmRx\src\ProfitabilityModule.tsx:120), [ProfitabilityModule.tsx:159](C:\FarmRx\src\ProfitabilityModule.tsx:159) |
| Read-only modules | Market Quote, Cost of Carry, Section Tabs, and printable report components contain no user-triggered persistence path. |

## Verified-good foundations

- Global Sync Notice clearly distinguishes synced, pending, syncing, and blocked work, states that nothing was deleted, and exposes Retry. [App.tsx:102](C:\FarmRx\src\App.tsx:102)
- Durable queue envelopes validate shape and retain their head until confirmation for Fields, Inventory, Field Log, Scouting, Grain, Harvest, Programs, Equipment, Profitability, and Notifications. [writeQueue.ts:43](C:\FarmRx\src\data\writeQueue.ts:43), [inventoryWriteQueue.ts:29](C:\FarmRx\src\data\inventoryWriteQueue.ts:29), [grainWriteQueue.ts:44](C:\FarmRx\src\data\grainWriteQueue.ts:44)
- Inventory uses receipt cancellation rather than overwriting received history. [InventoryModule.tsx:45](C:\FarmRx\src\InventoryModule.tsx:45)
- Grain movements are append-only and tell the farmer to correct a mistake with an opposite movement. [GrainModule.tsx:228](C:\FarmRx\src\GrainModule.tsx:228)
- Program unassignment and reassignment explain what planned and completed history will do before asking for a reason. [ProgramsModule.tsx:47](C:\FarmRx\src\ProgramsModule.tsx:47), [ProgramsModule.tsx:49](C:\FarmRx\src\ProgramsModule.tsx:49)
- Scouting gives an honest offline-photo limitation rather than falsely promising photo sync. [ScoutingModule.tsx:27](C:\FarmRx\src\ScoutingModule.tsx:27)
- Farmer-facing error translation is used widely instead of surfacing raw service errors.
- Numeric displays have a global tabular-number foundation.

## Recommended fix order

1. Add the required synchronous ref lock to every matrix row marked “No,” starting with Inventory, Programs apply/skip/reschedule, Fields, Equipment service costs, Grain unguarded writes, and Profitability.
2. Refactor Field Detail so every editor gets a fresh draft on Edit, discards it on Cancel, and avoids concurrent whole-object saves.
3. Standardize per-record offline receipts across all write flows.
4. Restore 48px task controls and raise all farmer-facing and report text to 18px minimum.