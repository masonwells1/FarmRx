# Farm Rx Foundation Audit

Date: 2026-07-13  
Scope: static code/docs audit plus local TypeScript, regression, and production-build gates. No live database, network-service, or authenticated browser testing was performed.

## 1. Executive summary

**Verdict: NOT-SOLID. Do not put the current build in front of real customers yet.**
The code compiles, all 23 regression suites pass, and the production bundle builds.
Those gates do not cover eleven confirmed release blockers that can duplicate writes or show wrong farm-money numbers.
The largest risks are missing double-submit locks, crop-share/flex settlement errors, unsafe grain-forward guidance, and non-atomic offer conversion.
Tenant isolation is broadly well designed: every farm-owned table has row-level security, and no confirmed cross-farm row leak was found statically.
One push-notification function still lacks a caller-ownership check, and public-signup status cannot be proven without a live settings check.
Offline queues are strong in several modules, but a few direct writes can block forever after “server committed, response lost.”
The foundation is repairable, but P0 and P1 fixes plus real-device/browser verification must happen before customer onboarding.

## 2. Verdict

**NOT-SOLID.** The successful compiler, regression, and build gates prove that the repository is internally buildable, not that its business outputs are safe. The audit confirmed **11 P0**, **16 P1**, **15 P2**, and **2 P3** findings. P0 means a credible path to wrong money, duplicate/lost data, or equivalent release-blocking harm. Several P0s are independent and customer-triggerable: ordinary rapid taps can create separate writes, Fields can reuse cancelled drafts, landlord settlement buckets and budgets can be wrong, Grain can understate planned revenue or overstate forward capacity, and a filled offer can become two contracts. This is beyond “ship and patch”; it needs a focused foundation repair pass and repeat audit.

## 3. Ranked findings

All P0 and P1 items below were reopened in the current source by Sol before inclusion. “Confirmed” means the cited production path, not just a subagent summary, was inspected.

### P0 — release blockers

| ID | Evidence | Plain-English defect and concrete failure | Suggested fix | Found by / confirmation |
|---|---|---|---|---|
| P0-01 | `src/InventoryModule.tsx:41,49,51`; `src/ProgramsModule.tsx:26-31,51`; `src/EquipmentTasksModule.tsx:15-20,42`; `src/ProfitabilityModule.tsx:85,100,120,156-196`; compare the few real locks at `src/FieldsModule.tsx:154-156`, `src/GrainModule.tsx:172-173,226,230,232`, `src/ProfitabilityModule.tsx:73,82` | Most money/data write handlers lack the required synchronous `useRef` lock. Two rapid taps can create two UUIDs and two valid operations—for example two inventory receipts or spray records—before React disables the button. | Add one synchronous ref lock per user-triggered write, acquired before ID creation and released in `finally`; retain visible busy state. Add double-invocation tests. | Workflows/UX; Sol confirmed repository-wide pattern scan. |
| P0-02 | `src/FieldsModule.tsx:166-175,245-248,251-254` | Fields Basics and Yield/Price initialize edit state once and do not restore saved values on Cancel; Records resets existing rows but can retain its add-row draft. Reopening and saving can submit cancelled values. Separate cards also send whole-field drafts, so near-simultaneous card saves can overwrite each other. | Create a fresh draft on every Edit, discard on Cancel, and replace whole-field card writes with focused patches or one serialized editor. | Workflows/UX; Sol confirmed the exact card state/effect behavior and narrowed the overbroad agent claim. |
| P0-03 | `supabase/migrations/0001_module1_fields.sql:184-188`; `src/data/profitabilityCalculations.ts:20-31`; `src/FieldsModule.tsx:19-23`; `src/ProfitabilityReport.tsx:106-116`; `supabase/migrations/0006_module4_profitability.sql:457-461` | The stored “labor and custom” percentage is used only for labor, while custom work is charged to “other inputs”; editor, report, shared calculator, and SQL view disagree. A 50% share of $40 labor + $60 custom on 100 acres can be reported as $2,000 instead of $5,000. | Decide one schema meaning. Safest: restore labor+custom everywhere and keep “other” separate; otherwise add a new custom-share column and explicitly migrate existing values. | Fields/land; Fable advisor; Sol confirmed all four mappings. |
| P0-04 | `src/data/profitabilityCalculations.ts:51-64,92-118`; `src/ProfitabilityReport.tsx:14-25`; `src/ProfitabilityModule.tsx:206-215,242` | Structured flex rent is correctly calculated once on combined field revenue in the shared field helper, but allocation/report paths calculate per crop. A double-crop example that should be $296/ac becomes $400/ac because base rent runs twice. | Group by field/lease year, apply the structured formula once to combined revenue, then allocate the known field rent to report rows. | Fields/land; Fable advisor; Sol confirmed divergent call paths. |
| P0-05 | `src/data/profitabilityCalculations.ts:121-123`; `src/ProfitabilityReport.tsx:22-25,170-175`; `supabase/migrations/0014_flex_lease_methods.sql:395-424` | The newest agreement overlapping any day in a year is applied to the entire crop year. A later amendment can replace the earlier lease for all annual settlement math. | Define the settlement period; require one applicable agreement or split/block when multiple agreements cover the crop. | Fields/land; Sol confirmed selector and report consumers. |
| P0-06 | `src/ProfitabilityReport.tsx:170-182,188-208`; `src/data/fields.ts:23-27`; `supabase/migrations/0006_module4_profitability.sql:29-47` | Landlord reports silently use the selected budget if crop/year match, otherwise the latest matching farm budget, without binding the field’s operating entity or plan. A $550/ac entity can be settled using another entity’s $800/ac plan. | Persist/select the budget per field-crop, require entity match, and block when more than one plan is eligible. Print chosen plan/entity. | Fields/land + Profitability; Sol confirmed fallback logic. |
| P0-07 | `src/GrainModule.tsx:37,202,218,238`; `src/data/marketingAlerts.ts:34-37` | “Target price $/bu” behaves as a cash-price target, but planned revenue adds basis again. With a $4.80 cash target and -$0.20 basis, 10,000 open bushels are valued at $4.60, understating revenue by $2,000. | Rename the stored concept explicitly. For the current cash-target UI, use target price directly (plus only separately defined premium), not target+basis. | Grain; Sol confirmed labels, alert comparison, and revenue formula. |
| P0-08 | `src/data/insuranceMath.ts:34-45`; `src/GrainModule.tsx:202,216-218` | Revenue Protection is shown as physically “Safe to forward.” RP guarantees revenue, not delivery bushels; enterprise-unit averaging, basis, premiums, share, and contract terms can leave the farmer exposed even when the heuristic number exists. | Rename to an insurance-backed marketing estimate, explain limits, and require a farmer-set sale limit; do not present it as safe physical production. | Profitability/insurance + Grain; Fable advisor; Sol confirmed UI path. |
| P0-09 | `src/GrainModule.tsx:202,214-218`; `supabase/migrations/0004_module2_grain.sql:271-292` | In the legacy insurance-unit fallback, the card displays total guarantee bushels and does not subtract already contracted or pending-offer bushels. A 1,600-bu guarantee with 1,500 already sold still shows 1,600 “safe.” | Display guarantee, contracted, pending offers, and remaining capacity separately; clamp remaining at zero and validate new commitments. | Grain; Sol confirmed fallback versus RP-budget paths. |
| P0-10 | `src/data/insuranceMath.ts:21-45`; `supabase/migrations/0030_budget_insurance.sql:14-16`; `src/ProfitabilityModule.tsx:182` | Coverage inputs of 86–95% are calculated as individual RP using farm APH. Those levels are SCO/ECO county-area territory, not a 90% farm-level guarantee. | Restrict individual RP to valid 50–85% levels; model SCO/ECO separately or omit them. | Profitability/insurance; Fable advisor; Sol confirmed validator, DB range, and displayed result. |
| P0-11 | `src/GrainModule.tsx:131-153`; `supabase/migrations/0028_firm_offers.sql:19-20,50-61` | Filling an offer writes a contract, then separately marks the offer filled. If the first commits and the second response/write fails, refresh leaves an open offer that can create a second sale. | One transaction/RPC: lock offer, reject already-filled/expired, create deterministic contract, link and fill offer, return both rows; add ambiguous-response replay tests. | Grain; Sol confirmed the two-write sequence. |
### P1 — broken or materially unsafe features

| ID | Evidence | Plain-English defect and concrete failure | Suggested fix | Found by / confirmation |
|---|---|---|---|---|
| P1-01 | `src/ProfitabilityReport.tsx:127-138,188-208`; `src/data/fields.ts:128-137` | The “Landlord settlement” has no net amount due and silently omits negotiated items such as drying/hauling and any separately handled indemnities or government payments. A farmer can pay crop share without offsetting landlord-paid inputs. | Until complete, call it a worksheet/estimate. Add net due-to/from, manual adjustments, percentages used, and explicit inclusions/exclusions governed by the written lease. | Fields/land + Fable; Sol confirmed output rows and missing net. |
| P1-02 | `src/ProfitabilityModule.tsx:107,156-179`; `src/data/SupabaseProfitabilityDataGateway.ts:7,24` | The delayed insurance save sends a whole stale budget and can overwrite a just-changed price/yield; switching tabs within 350 ms clears the timer and loses the last insurance edit. | Patch only insurance fields or serialize all budget writes with revisions; persist the pending edit before navigation and flush safely. | Profitability/insurance; Sol confirmed timer, cleanup, and unconditional whole-row upsert. |
| P1-03 | `src/data/planningTools.ts:5-8`; `src/ProfitabilityModule.tsx:246-262`; `supabase/migrations/0006_module4_profitability.sql:206-208` | Plan comparison groups only crop/year and mixes whole-farm or other-entity plans with arrangements they cannot serve, so the wrong plan can be shown “Best.” | Include entity and enterprise scope in grouping; separate whole-farm comparisons. | Profitability/insurance; Sol confirmed grouping keys. |
| P1-04 | `supabase/migrations/0029_bin_upgrades.sql:22-40`; `src/data/binLedger.ts:30-42`; `src/GrainModule.tsx:228` | Bin movements can exceed capacity or go below zero; the UI caps/clamps the display and can hide how impossible the balance is. | Append through a locking RPC that enforces commodity, nonnegative balance, and capacity; display legacy overage explicitly. | Grain; Sol confirmed DB checks and display math. |
| P1-05 | `src/data/binLedger.ts:30-35`; `supabase/migrations/0029_bin_upgrades.sql:19-21` | `bin_inventory` is always added to all ledger movements with no baseline date, so a measurement that already includes a receipt can count it twice. | Make measurements dated baselines or convert the opening balance to a ledger entry; expose reconciliation status. | Grain; Sol confirmed additive formula. |
| P1-06 | `src/data/binLedger.ts:37-52`; `src/data/SupabaseGrainDataGateway.ts:25` | A movement-only bin infers commodity from the newest row and its bushels can appear in every crop year. Corn history can disappear or be counted in the wrong year after a later soybean movement. | Persist lot/crop-year identity and derive balance chronologically within a reconciled lot. | Grain; Sol confirmed newest-first load and missing year filter. |
| P1-07 | `src/GrainModule.tsx:31-35,202,226`; `src/data/grain.ts:123-136` | Basis and HTA records cannot be completed with their missing price leg, and delivery tracking stores only dates—not delivered quantities or remaining obligation. Farmers cannot close pricing or reconcile contract fulfillment. | Add explicit price-leg finalization and immutable delivery applications with remaining-bushel calculation. | Grain; Sol confirmed current editor/data shape. |
| P1-08 | `src/data/basisMath.ts:3-10`; `src/data/grainAlerts.ts:14-16`; `src/GrainModule.tsx:202`; `supabase/functions/deliver-grain-alert/index.ts:25-28` | Quote selection is not consistently crop-year/delivery/location/freshness scoped; display-only MARS observations can participate in generic alerts, and marketing-rule delivery only checks rule shape. | Centralize eligible quote selection and freshness; recompute the full rule server-side before delivery. | Grain; Sol confirmed selection and Edge Function validation gap. |
| P1-09 | `supabase/migrations/0022_harvest.sql:146`; `src/data/grain.ts:139-142`; `src/data/SupabaseGrainRepository.ts:40`; `src/data/binLedger.ts:30` | Harvest actuals, Grain actual production, and bin balances are independent with no reconciliation screen. Entering 80,000 harvested bushels can leave Grain on a preseason estimate and bins empty. | Show the three totals and unexplained difference; add an intentional “copy harvest total to Grain actual” action. Do not silently alter bins. | Field operations; Sol confirmed independent stores. |
| P1-10 | `src/data/weatherService.ts:65-69`; `src/WeatherModule.tsx:30,34,48` | An unlimited-age cached forecast can still render green “Good — Spray now” and send a good-window notification after the live request failed. | Treat stale as unknown/caution, cap age, suppress positive notifications unless fresh, and show age prominently. | Field operations; Sol confirmed cache and notification path. |
| P1-11 | `src/data/QueuedInventoryRepository.ts:17-28`; `src/data/QueuedGrainRepository.ts:22-47`; `src/data/QueuedEquipmentTasksRepository.ts:13-24`; direct gateways at `src/data/SupabaseInventoryDataGateway.ts:32`, `src/data/SupabaseGrainDataGateway.ts:46-48`, `src/data/SupabaseEquipmentTasksDataGateway.ts:11,15-17` | Inventory adjustments, Grain deletes, and meter/deletion writes can commit, lose the response, then replay into duplicate/not-found errors that block the FIFO queue and all later work. | Add server operation receipts or stable-ID reconciliation; make deletes idempotent; test “commit then transport error.” | Data layer; Sol confirmed entry IDs are not server receipts for these writes. |
| P1-12 | `src/data/SupabaseProfitabilityDataGateway.ts:29`; `supabase/migrations/0013_profitability_live_support.sql:225-245`; `src/data/QueuedProfitabilityRepository.ts:141-144` | Offline matrix replay blindly deletes/reinserts a snapshot with no revision. A later replay can erase another user’s newer price/yield assumptions. | Add budget revision plus operation receipt; reject stale replacement and require reload/merge. | Data layer; Sol confirmed destructive replacement and absent conflict token. |
| P1-13 | `src/data/SupabaseNotificationsDataGateway.ts:11`; `supabase/functions/send-push/index.ts:27-95`; `src/ProgramsModule.tsx:20`; `src/NotificationsModule.tsx:21-27`; `supabase/migrations/0024_programs.sql:2035-2058` | Phone push exists but notification creation never invokes it; Program reminders are generated only when a user opens/refreshes the app. A Sunday reminder may appear Monday and never reach the phone. | Add a server-side due scheduler and one durable push-delivery queue invoked exactly once per notification. | Programs/notifications; Sol confirmed no `send-push` invocation in source/SQL. |
| P1-14 | `src/EquipmentTasksModule.tsx:38-39`; `supabase/migrations/0024_programs.sql:394-396,2075-2079` | Tasks lets users mark Program-owned tasks Done/Reopen without changing the pass. The task can disappear while the pass remains planned, and dedupe prevents regeneration. | Make Program cards navigation-only for status; enforce at the server that only Program RPCs change tracker-owned task status. | Programs/notifications; Sol confirmed direct task upsert. |
| P1-15 | `supabase/migrations/0016_equipment_tasks.sql:196-240`; `supabase/migrations/0017_service_log_rls_fix.sql:171-211`; `src/EquipmentTasksModule.tsx:29`; `src/data/SupabaseEquipmentTasksDataGateway.ts:16` | Deleting a service log deletes only that row; interval completion and any derived meter reading remain. An erroneous oil change can still suppress the next reminder. | Use an atomic reversal/recalculation RPC or immutable correction records. | Programs/inventory/equipment; Sol confirmed delete path and side effects. |
| P1-16 | `supabase/functions/send-push/index.ts:27-60` | `send-push` trusts platform JWT verification but never checks that the caller owns/can access the requested notification before using the service role. Any signed-in user with a notification UUID can trigger another user’s push. | Validate caller JWT in-function and require `notification.user_id === caller.id` or an authorized server-only invocation token; rate-limit/dedupe delivery. | Sol security audit; directly confirmed. |

### P2 — correctness, auditability, and usability risks

| ID | Evidence | Risk / scenario | Suggested fix | Source |
|---|---|---|---|---|
| P2-01 | `src/data/insuranceMath.ts:34-45`; `src/data/profitability.ts:7-18` | The RP card cannot calculate an indemnity: it lacks harvest price, production-to-count, unit structure, county data, and policy identity. | Keep it explicitly “projected-price planning arithmetic”; do not show claim/payment language until fully modeled. | Profitability/insurance + advisor. |
| P2-02 | `src/data/marketingAlerts.ts:25-45`; `src/data/grainAlerts.ts:19,29-34`; `supabase/functions/deliver-grain-alert/index.ts:28`; `src/GrainModule.tsx:55` | Rules can repeat daily while true, server delivery does not re-evaluate the condition, and refresh-triggered writes lack a guard. | Persist transition/crossing receipts; recompute conditions server-side; make evaluation idempotent. | Grain + Workflows/UX. |
| P2-03 | `src/data/firmOffers.ts:53-57` | A future-delivery cash offer becomes `cash_spot`, obscuring a forward commitment. | Map future windows to `forward_cash` or ask explicitly. | Grain. |
| P2-04 | `src/ProfitabilityModule.tsx:24,159,196,203`; `src/data/SupabaseProfitabilityRepository.ts:85-88,179-183,213-226`; numeric schemas across migrations | Some inputs accept non-finite or extra-scale values until the database rounds/rejects them. | Shared finite/scale validators and deterministic decimal rounding before queueing. | Profitability + Data layer. |
| P2-05 | `src/data/SupabaseFieldsRepository.ts:59`; regression-quality matrix in `data-layer-test-quality-report.md` | Some missing selected columns collapse to null, and several tests assert fake echoes rather than prove a dropped column fails. | Require every contracted column and add dropped/misnamed-column sentinel tests. | Data layer. |
| P2-06 | `src/data/syncStatus.ts`; Program queue status paths cited in `data-layer-test-quality-report.md` | Aggregate sync can undercount Program writes and retain stale retry callbacks/messages. | Derive counts from queues and clear callback lifecycle deterministically. | Data layer. |
| P2-07 | `src/data/weatherService.ts:68,103,107`; `src/WeatherModule.tsx:13` | Field-zone timestamps are displayed in the browser’s zone, so a traveling user can see the wrong spray-window clock time. | Preserve resolved IANA zone and pass it to all formatters. | Field operations. |
| P2-08 | `src/HarvestModule.tsx:45-46`; `src/data/harvest.ts:39`; `supabase/migrations/0022_harvest.sql:136` | Arbitrary future harvest dates are accepted. | Enforce farm-local current date/tolerance in UI, repository, and RPC. | Field operations. |
| P2-09 | `src/data/scoutingStorage.ts:7-8`; `src/ScoutingModule.tsx:27`; `src/data/QueuedScoutingRepository.ts:20-23` | Ambiguous upload/save/delete failures can orphan private photo objects. | Durable cleanup outbox plus authenticated orphan reconciliation. | Field operations. |
| P2-10 | `src/data/QueuedFieldLogRepository.ts:34`; `src/FieldLogModule.tsx:25`; `src/data/QueuedScoutingRepository.ts:31`; `src/ScoutingModule.tsx:30` | Offline deletes queue successfully, then forced reload fails and UI says deletion failed, encouraging repeats. | Return/display a pending tombstone receipt and avoid live reload while offline. | Field operations. |
| P2-11 | `src/InventoryModule.tsx:11`; `src/EquipmentTasksModule.tsx:5`; `src/ProgramsModule.tsx:50`; `src/data/programDueItems.ts:7-9` | UTC date defaults and caller-local due cycles can record tomorrow for a Central farm or shift reminders when a manager travels. | Store farm IANA zone and use one farm-local date helper/server authority. | Programs + Field operations. |
| P2-12 | `src/styles/app.css:5,18,120,122,128,411,417,427,429,450,455,597,600,856,868-869,947,954` | The explicit 18px/48px house rules are violated on important money/report/task controls. | Raise farmer-facing text and every interactive target to the contract minimum. | Workflows/UX. |
| P2-13 | `src/InventoryModule.tsx:43`; `src/EquipmentTasksModule.tsx:11`; `src/ProfitabilityModule.tsx:81` | Several writes close/refresh without a per-record “saved locally / synced / needs attention” receipt. | Standard typed receipt state for every write and row-level pending marker. | Workflows/UX. |
| P2-14 | `supabase/migrations/0006_module4_profitability.sql:81-96`; `src/data/SupabaseProfitabilityRepository.ts:31-38` | DB-valid `inventory`/`equipment` cost-source rows are rejected by the repository. | Implement those mappings or narrow the schema until supported. | Data layer. |
| P2-15 | `docs/programs-design.md:54-64`; `src/ProgramsModule.tsx:54`; `src/InventoryModule.tsx:61` | Programs intentionally does not decrement inventory, but the split workflow can be mistaken for a complete spray record/on-hand update. | Make “progress only” versus “also create inventory application” explicit at confirmation. | Workflows/UX. |

### P3 — polish and secondary auditability

| ID | Evidence | Issue | Suggested fix | Source |
|---|---|---|---|---|
| P3-01 | `src/GrainModule.tsx:166-168`; `supabase/migrations/0028_firm_offers.sql:141-153` | Filled offers can be deleted, erasing offer-to-contract history while the contract remains. | Archive/hide; prohibit deletion after fill. | Grain. |
| P3-02 | `src/data/SupabaseProgramsDataGateway.ts`; `src/data/syncStatus.ts` | An archive-filter argument is ignored at one gateway seam, and aggregate sync reports only the first blocked module message. | Honor/remove the flag; expose all blocked modules. | Data layer. |

## 4. Plan versus built

The full item-by-item design yardstick is `contract-inventory.md` (221 numbered promises). This table cross-references every inventory section; roadmap-only items are not treated as present-release defects unless the newer docs marked them complete.

| Contract items | Area | Built? | Verified? | Gap notes |
|---|---|---|---|---|
| 1-6 | Product/platform/ship objective | Mostly | Static + gates | React/TS/PWA/Supabase seams exist. First-customer usability is not proven without live browser/device work. Future integrations remain future. |
| 7-35 | Cross-cutting UX/house rules | Partial | Static | Tabular-number foundation is good; 18px, 48px, per-write receipt, and re-entrancy contracts fail. |
| 36-48 | Auth/onboarding/privacy | Mostly | Static only | Sign-in-only UI and RLS exist. Live “public signup disabled” setting and real role behavior remain unverified. `send-push` caller authorization fails. |
| 49-65 | Fields/foundation | Built | Static + repository gates | Atomic/receipt-backed seam is strong. Stale editor drafts and land-economics/report errors break correctness. |
| 66-90 | Grain/marketing/storage/alerts | Partial | Static + regressions | Carry math and plan replacement are sound. Safe-forward, planned cash price, firm-offer conversion, bin source of truth, contract lifecycle, and alert scope are incomplete/wrong. |
| 91-106 | Inventory/spray/compliance | Built with risks | Static + regressions | Catalog, receipts, application snapshots, conversions, and RUP checks exist. Double-submit, incomplete local projection/receipts, and acknowledgement-loss recovery remain. |
| 107-129 | Profitability/scenarios/reports | Built but unsafe | Static + regressions | Per-acre arithmetic and core RP projected-price formula are sound. Plan selection, entity scope, insurance save races, settlement, and flex/crop-share math are not customer-safe. |
| 130-141 | Equipment/Tasks | Built with gaps | Static + regressions | Core records/tasks/service exist. Program-task authority and service reversal are broken; several direct writes lack receipts/locks. |
| 142-155 | Weather/spray windows | Built with unsafe fallback | Static + regression | Threshold math and no-cache failure are sound. Stale data can still produce a positive recommendation; field-zone display is wrong. |
| 156-170 | Rain/Field Log/GDD/Scouting/Harvest | Mostly built | Static + regressions | Core validation, RLS, private photos, and receipt RPCs are strong. Harvest does not reconcile to Grain, and date/photo/offline-delete edges remain. |
| 171-177 | Notifications/push | Partial | Static + regression | In-app notification privacy/dedupe exist. Push and closed-app scheduling are not wired end to end. |
| 178-198 | Programs | Mostly built | Static + regressions | Templates, assignment snapshots, due dedupe, costs, and actions exist. Task/pass state can diverge; inventory separation needs stronger workflow wording. |
| 199-204 | Machine import/future agronomy | Mostly roadmap | Static | Machine file import/live sync/variety analytics are not built; these are documented future scope. GDD via Open-Meteo is built. |
| 205-211 | Ship/governance | Partial | Local gates only | Typecheck/regression/build pass. Provisioning, public-signup setting, live RLS, offline PWA, and real-device sunlight/gloves checks remain. |
| 212-221 | Contradictions/precedence | Recorded, not all resolved | Static | The strict 18px rule is not met; bin source-of-truth contradiction manifests as double counting; future inventory planners remain unbuilt by design. |

## 5. Verified-good inventory

- **Compilation and regression foundation:** forced project TypeScript check passed; all 23 suites passed; production PWA build passed.
- **Tenant structure:** all 48 created tables were inventoried. Every farm-owned table has RLS; the six Programs tables are enabled through the migration loop. Global `commodities`/`usda_report_dates` are read-only lookup data. No confirmed static cross-farm row read/write path was found.
- **Employee privacy:** Grain and Profitability reads are replaced by `can_read_private_financials`; active owner/manager or explicitly permitted employees/representatives are required. Helpers use fixed `search_path`, revoke public/anon execution, and check `auth.uid()`.
- **Storage:** scouting bucket is private, farm-path scoped, authenticated, MIME-limited, and capped at 20 MB; metadata has same-farm relationships.
- **Atomic/idempotent paths:** Fields, Field Log, Scouting metadata, Harvest, Programs, inventory receipt/application bundles, and service-log creation use strong farm-bound RPC/receipt patterns.
- **Offline queue core:** versioned farm/user/project keys, FIFO replay, corrupt-byte preservation, transport-versus-definite failure classification, and multi-tab coordination are present in the stronger modules.
- **Core calculations:** cost-of-carry arithmetic, futures+basis cash relationship when both legs are known, basic budget revenue/profit/break-even units, individual RP projected-price floor at valid inputs, and U of I planning-tool examples all passed hand-calculated regressions.
- **Fields fundamentals:** atomic field/arrangement/crop save, null-versus-zero preservation, explicit crop-share percentages, and supported flex formula validation are strong. Owned/cash-rent land replacement avoids double-counting the budget land line.
- **Inventory/compliance:** unit conversion fails closed across incompatible families, label facts snapshot into application records, negative stock is visibly flagged, and completed application/receipt replays are protected.
- **Programs:** assignment snapshots preserve applied history, due-item cycle keys dedupe tasks/notifications, missing cost lines do not become zero, and free-text products intentionally cannot guess inventory matches.
- **Weather/operations:** configured units are consistent (Fahrenheit, mph, inches, bushels/acres); generic spray thresholds match the design; no-cache failure fails closed; GDD refuses incomplete history.
- **UI numeric typography:** global tabular numerals and numeric table utilities exist; the defect is size/touch compliance, not numeric font alignment.

## 6. Gate results

Full verbatim output is preserved in `gate-tsc.txt`, `gate-regression.txt`, `gate-build.txt`, and `gate-spot-regressions.txt`.

| Gate | Verbatim pass/fail result | Notes |
|---|---|---|
| `npx tsc -b --force` | `EXIT_CODE=0` | Passed. No compiler output before the exit line. |
| `npm run regression` | `costOfCarry regression: all checks passed` … `Weather service regressions passed (8 coverage groups).` `EXIT_CODE=0` | All 23 package-script suites passed. |
| `npm run build` | `✓ built in 1.54s` … `files generated` `dist/sw.js` `EXIT_CODE=0` | Passed. Vite warned that the main JS chunk is over 500 kB; not a correctness failure. |
| Spot runs | `MockGrainRepository regressions passed.`; `SupabaseEquipmentTasksRepository regression passed (10 coverage groups)`; `SupabaseProfitabilityRepository regressions passed.`; each `EXIT_CODE=0` | Re-ran individually because their coverage was flagged as thin around dropped columns/acknowledgement loss. Passing does not cover those missing scenarios. |

## 7. Needs live browser verification

Static proof cannot replace these customer-path checks:

1. Confirm public signups are disabled in the live Supabase Auth settings; create/provision a test customer through the intended out-of-band flow.
2. Use two farms and owner/manager/worker/read-only/representative accounts to prove RLS, employee financial privacy, revocation, and cross-farm reference rejection.
3. On a real phone/PWA, test sign-in restore, expired session, install/update, offline/online transitions, multi-tab sync, full storage, and queued receipt wording.
4. Rapidly double-tap every write action before fixes and after fixes; verify exactly one server row/receipt and one inventory/money effect.
5. Cancel/reopen every edit card and rapidly edit multiple cards/fields; prove cancelled values never reappear and concurrent saves cannot overwrite each other.
6. Exercise numerical landlord cases: crop share, custom/labor costs, double crop structured flex, mid-year agreement, multiple plans/entities, indemnity/adjustment exclusions, and net due.
7. Exercise Grain with cash targets and positive/negative basis, prior contracts, pending offers, RP units, 86–95% rejection, offer-fill response loss, bin capacity/negative/commodity/year cases, and basis/HTA completion.
8. Compare Harvest total, Grain actual production, contracts, and bin balance in the UI; verify the reconciliation decision is explicit.
9. Simulate stale cached weather/offline mode and confirm no green recommendation or positive push is emitted from stale data.
10. Upload/delete scouting photos across interrupted connections and verify no orphan metadata/object or cross-farm signed access.
11. Verify Program due generation, Program-task status authority, service-log reversal, in-app notification dedupe, real web-push delivery, and push caller authorization.
12. Run the required sunlight/gloves/accessibility pass: 18px text, 48px targets, focus, screen-reader labels, loading/empty/error states, and print/PDF reports.

## 8. Recommended fix order

1. **Stop duplicate writes:** add synchronous locks to every write handler and focused regression/browser double-tap tests.
2. **Repair land money:** resolve labor/custom schema semantics, run structured flex once per field, bind agreement period and field budget/entity, and rebuild the landlord output as an explicit worksheet/settlement with net and exclusions.
3. **Repair Grain risk numbers:** cash-target semantics, RP wording/50–85% bounds, contracted/pending subtraction, explicit plan selection, and a single atomic offer-fill RPC.
4. **Repair bin/contract truth:** enforce capacity/nonnegative/commodity/year, define the ledger baseline, add price-leg finalization and delivery quantities, and reconcile Harvest→Grain.
5. **Repair save durability:** insurance patch/revision flow, queue receipts/idempotent deletes, matrix conflict token, and per-record offline receipts.
6. **Repair operational integrations:** stale-weather fail-safe, server due scheduler + push delivery, Program-task authority, service reversal, and `send-push` caller check.
7. **Close P2/UI gaps:** farm time zone, photo cleanup, finite/decimal contracts, dropped-column tests, 18px/48px compliance, and honest offline-delete states.
8. Re-run forced TypeScript, all regressions, build, focused new tests, the full static audit, and the live-browser list above before onboarding a customer.

## 9. Appendix

### A. Subagent report index

| Assignment | Model | Authoritative artifact | Status |
|---|---|---|---|
| Contract inventory | `gpt-5.6-luna` | `contract-inventory.md` | Accepted after one required rerun; 221 cited items. |
| Fields & land economics | `gpt-5.6-terra` | `fields-land-economics-report.md` | Accepted after one required rerun. |
| Grain marketing | `gpt-5.6-terra` | `grain-marketing-report.md` | Accepted after one required rerun. |
| Profitability & insurance | `gpt-5.6-terra` | `profitability-insurance-report.md` | Accepted. |
| Field operations | `gpt-5.6-terra` | `field-operations-report.md` | Accepted. |
| Programs/inventory/equipment/notifications | `gpt-5.6-terra` | `programs-inventory-equipment-notifications-report.md` | Accepted. |
| Data layer & test quality | `gpt-5.6-luna` | `data-layer-test-quality-report.md` | Accepted. |
| Workflows & UX | `gpt-5.6-terra` | `workflows-ux-report.md` | Accepted. |

The first Batch 1 attempts returned completion links in their `-o` files rather than complete reports. They were rerun once as required. `fields-land-economics-audit.md` and `grain-marketing-audit.md` are non-authoritative side artifacts from those first attempts; synthesis used the canonical `*-report.md` reruns above.

### B. Sol evidence artifacts

- `security-inventory.txt` — table/RLS/policy/grant/auth/storage inventory.
- `known-bug-pattern-scan.txt` — repository-wide historical bug pattern scan.
- `p0-p1-confirmation-evidence.txt` — focused source lines used to confirm included high-severity findings.
- Gate logs listed in Section 6.

### C. Outside advisor Q&A transcripts

Three Claude Fable calls were used. No Opus call was needed because the answers did not conflict with the code analysis.

#### Advisor call 1 — Revenue Protection

**Question (verbatim)**

> You are advising a static audit of a US farm-management app. No web lookup is needed. The app computes `guaranteedBushels = APH yield * coverage_pct * allocated acres`, sets `safeToForwardBushels = guaranteedBushels`, and labels the remainder after contracts as “Safe to forward.” It accepts 50%-95% coverage and applies the same individual RP formula at every level; UI text merely warns that 86%-95% is typically ECO/SCO. It has no harvest price, production-to-count, unit structure, county result, or indemnity calculation. Focused questions: (1) Under standard RMA Revenue Protection practice, is it economically safe/correct to call APH*coverage acres “safe to forward” physical bushels? (2) Can 86%-95% be calculated as individual RP this way, or must SCO/ECO be modeled separately? (3) What wording and bounds should a farmer-facing planning tool use? Answer concisely and state any important nuance.

**Answer (verbatim)**

Here are the audit answers, from standard RMA/extension practice — no code changes, just the assessment.

**1) Is APH × coverage% × acres "safe to forward" physical bushels?**

Directionally defensible, literally wrong. RP guarantees **revenue in dollars**, not bushels. The reason extension economists (farmdoc, ISU) do treat guaranteed bushels as a reasonable pre-harvest marketing benchmark is RP's harvest-price feature: if you come up short *and* futures rally, the indemnity is recalculated at the higher harvest price, which roughly funds buying out a futures-based forward contract. So the heuristic is legitimate — but only with these caveats, several of which bite this app specifically:

- **Unit structure.** The guarantee applies per insurance unit. With enterprise units (the most common, because of the premium discount), one drowned-out field can fail while the whole unit still exceeds its guarantee → **zero indemnity**, yet the farmer forward-sold that field's bushels. Field-level "safe to forward" math silently assumes optional units.
- **Basis and contract terms aren't covered.** Indemnity is futures-based; a buyout at the elevator happens at cash, plus any cancellation fees. Wide basis moves are uninsured.
- **Premium contracts aren't covered.** Farm Rx treats white and non-GMO corn as separate commodities — correctly — but RP indemnifies at *yellow corn futures*. Forward-selling premium bushels against an RP guarantee leaves the premium exposed.
- **Harvest price is capped** (typically 200% of projected), truncating protection in an extreme rally.
- **Share matters.** A 50% crop-share farmer insures only their share; guaranteed bushels must use the farmer's share of production, which interacts with your landlord input-share feature.
- **Indemnity nets out production-to-count**, quality adjustments, etc. — the app computes none of that, which is fine for a planning number but not for the word "safe."

**2) Can 86–95% be computed as individual RP?**

No. Individual RP tops out at **85%**. 86–95% exists only via **SCO/ECO, which are county-area plans**: they pay on *county* revenue outcomes, not the farm's. A farmer can have a total farm loss and collect nothing from ECO if the county did fine. So applying the individual APH formula at 90% doesn't just mislabel the product — it manufactures "guaranteed bushels" that have **no farm-level guarantee at all**. SCO/ECO cannot be folded into a farm-bushel number; they'd need separate county-based modeling, and for a planning tool the right answer is to exclude them.

**3) Recommended wording and bounds**

- **Bounds:** restrict the coverage input to **50–85% in 5% steps** (the actual RP levels). Delete 86–95% rather than warn about it — a warning next to a wrong number is still a wrong number.
- **Label:** replace "Safe to forward" with something like **"Insurance-backed marketing benchmark (estimate)"** or "Bushels backed by your revenue guarantee." Avoid "safe" and "guaranteed bushels" as the remainder label.
- **One-line caveat near the number**, plain English: *"RP guarantees revenue, not bushels. This estimate assumes optional/field-level units and futures-priced contracts; basis, premiums (white/non-GMO), and enterprise-unit averaging can reduce protection. Not insurance advice."*
- Optionally let the user pick **unit structure** (enterprise vs. optional) later; if enterprise, compute the benchmark at the whole-crop level, not per field — that's the single biggest correctness gap after the 86–95% issue.

**Bottom line:** the core formula is the standard, accepted heuristic and fine to keep at 50–85% with honest labeling; the 86–95% range as individual RP is factually wrong and should be removed, and "safe" should come out of the label.

#### Advisor call 2 — structured flex rent and double crops

**Question (verbatim)**

> You are advising a static audit of a US farm-management app. A field can be double-cropped. A structured flex cash lease stores a base rent per acre plus a percentage of gross revenue per acre above a trigger, optionally capped. One helper correctly combines all crop revenue for the field, then applies the formula once. Two reports instead apply the formula separately to each crop allocation, so the base rent and floor/cap can be counted twice. Example: 100-acre field, wheat $480/ac plus double-crop beans $480/ac, lease $200/ac base + 40% of revenue above $720/ac. Combined method gives $296/ac; per-crop method gives $200 + $200 = $400/ac. Under ordinary lease interpretation, should the formula normally be applied once to the leased acres using combined revenue, or once per crop? What contract ambiguity must the software surface? Answer concisely.

**Answer (verbatim)**

Applied once per leased acre using combined revenue. A flex cash lease is a lease of land, not of crops: the base rent, the revenue trigger, and any cap are all attributes of the acre, priced against the total gross revenue that acre generates in the lease year. Double-crop revenue is simply more revenue from the same acre. Standard flex-lease structures (as described in extension guides from Iowa State, Illinois, etc.) compute one flex payment per acre per year; nothing in the ordinary form re-runs the formula per commodity. Applying it per crop double-counts the base rent and gives each crop its own trigger/floor/cap, which is why your per-crop method produces $400/ac instead of the correct $296/ac ($200 base + 40% × ($960 − $720) = $296). So the helper that combines revenue first is right, and the two reports are wrong — the reports also literally charge $400/ac of rent on a lease whose base is $200/ac, which no landlord-tenant pair would recognize as their agreement.

The ambiguity the software must surface: what "gross revenue per acre" means when multiple crops (or a failed-then-replanted crop, or insurance indemnities) occur on the same acres in one year. Specifically, the lease may or may not say:

1. **Whether double-crop revenue counts toward the trigger at all** — some leases flex only on the primary crop, or were written assuming one crop and are silent.
2. **Whether the trigger/cap applies to combined revenue or per crop** — a lease that states per-crop flex terms (rare, but possible) would legitimately need the per-crop math.
3. **What's included in "revenue"** — insurance proceeds, government payments, premiums.

Practical recommendation for the app: make combined-per-acre the default and only method in the calculations, fix the two reports to use the shared helper, and put a small explanatory note on the lease setup screen ("Flex is calculated once per acre on combined revenue from all crops; if your written lease says otherwise, check it") rather than adding a per-crop toggle — a toggle invites misconfiguration for a case that's rarely the actual contract. If you ever do need the per-crop variant, add it only when a real customer's written lease requires it.

#### Advisor call 3 — crop-share settlement

**Question (verbatim)**

> You are advising a static audit of a US crop-share landlord settlement feature. The database column is named `landlord_labor_custom_pct`; the app now applies it only to labor and applies a different `landlord_other_input_pct` to custom work, silently changing the stored meaning. The report shows landlord crop value and shared budget expenses but no net amount due, and it omits explicit treatment of crop-insurance indemnities, government payments, drying/storage/hauling, taxes, and other negotiated items. Under standard Midwestern/Illinois crop-share practice, which parts are clearly software defects versus lease-specific terms? What minimum wording/controls are needed before calling the output a “settlement”? Answer concisely and avoid pretending all leases use one split.

**Answer (verbatim)**

I verified the claims in the code first — and the mismatch is actually worse than described: three surfaces disagree with each other. In `src/FieldsModule.tsx:19-23` the editor labels `landlord_labor_custom_pct` as "Labor" and `landlord_other_input_pct` as "Custom work"; in `src/ProfitabilityReport.tsx:111-115` the report labels the first "Labor & custom" but applies it only to the `labor` category, and labels the second "Other inputs" while applying it to the `custom` category; and the SQL view in `supabase/migrations/0006_module4_profitability.sql:457-461` applies `landlord_other_input_pct` to `other_cost`, not custom work. Here's my read of what's a defect versus a lease term.

## Clear software defects (regardless of lease terms)

1. **Silent reinterpretation of a stored column.** `landlord_labor_custom_pct` was defined as "labor + custom work"; applying it to labor only changes the meaning of numbers farmers already entered, with no migration or user confirmation. Any lease that shared custom work at that rate now computes a different landlord share than what the user set up. This is a data-integrity defect, full stop.
2. **Internal inconsistency.** The field editor, the report row mapping, and the database view each assign these two percentages differently. At least two of the three are wrong at any given time.
3. **Calling it a "settlement" with no net amount due.** A settlement's entire purpose is the balancing figure: who owes whom, how much. Showing landlord crop value and shared expenses but no net line means it's a worksheet, not a settlement — presenting it under the settlement label is a defect of framing even if every number is right.
4. **Silent omission (as opposed to omission).** Leaving out indemnities, government payments, drying/storage/hauling, and taxes isn't itself wrong — but omitting them *without saying so* is, because a document titled "settlement" implies completeness. The reader can't tell "excluded by design" from "forgot."

## Lease-specific — the software must not assume a standard

There is no single Midwestern split; 50/50, 1/3–2/3, 60/40, and custom hybrids all exist, and the items below are individually negotiated:

- **Crop insurance indemnities:** most commonly each party insures their own share and collects separately, so exclusion is a defensible default — but only if stated, especially since this app *does* share the premium (`landlord_crop_insurance_pct`).
- **Government payments (ARC/PLC, ad hoc programs):** FSA typically pays each party its share directly per the farm record, so exclusion is again a common default — but some leases route these through settlement.
- **Drying, storage, hauling:** genuinely negotiated (drying on the landlord's share is often the landlord's cost; hauling often the tenant's; storage varies) and these hit exactly at settlement time via elevator deductions, so a settlement ignoring them can be materially off.
- **Real estate taxes:** conventionally the landlord's own expense outside the crop settlement; fine to exclude, say so.
- **Lime/fall-applied fertilizer proration and other negotiated adjustments:** can't be modeled by fixed category percentages at all.

## Minimum bar before the output may be called a "settlement"

- **Fix the column semantics deliberately:** either restore the original combined meaning everywhere, or split it into `landlord_labor_pct` + `landlord_custom_pct` via a migration that makes an explicit, documented decision about existing values — never a silent reinterpretation. All three surfaces (editor, report, SQL view) must then agree, ideally enforced by a single shared mapping.
- **A net line:** landlord revenue share, minus landlord expense share paid by the tenant, plus/minus adjustments, ending in "Net due **to/from** landlord: $X."
- **A signed manual adjustments section** (label + amount) for the negotiated items above.
- **An inclusions/exclusions statement printed on the face of the report:** e.g., "Not included: crop insurance indemnities, government program payments, drying/storage/hauling, real estate taxes — settle these per your written lease."
- **Show the percentages actually used** on the report itself, and freeze/version them per crop year so editing the arrangement later doesn't silently rewrite a past settlement.
- **No defaulted "standard" split** — percentages must be explicitly entered, and a prominent line stating this is an estimate from entered budget figures, and the written lease governs.

Until the net line and the exclusions disclosure exist, the honest label is "settlement worksheet" or "landlord share estimate," not "settlement." I haven't changed any code — this was an assessment; say the word if you want me to plan the fix (the column-semantics repair is the one that needs a migration decision from you).
