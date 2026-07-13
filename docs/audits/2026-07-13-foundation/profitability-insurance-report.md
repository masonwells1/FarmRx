# Foundation Audit — Profitability, Planning, Budgets, and Crop Insurance

**Method:** static code-and-docs audit only. No network, live database, secrets, or files were modified.

## Result

| Severity | Count |
|---|---:|
| P0 — money-wrong/data loss | 4 |
| P1 — broken feature/data loss | 3 |
| P2 — correctness risk | 2 |
| P3 — polish | 0 |

## P0 findings

### P0-1 — “Safe to forward” treats an RP revenue guarantee as physically safe bushels

**Evidence:** `revenueProtectionMath` sets `safeToForwardBushels` equal to APH × coverage × allocated acres and explicitly does not cap it by production: `src/data/insuranceMath.ts:34`, `src/data/insuranceMath.ts:38-45`. Grain then subtracts contracts and presents the remainder as **“Safe to forward”**: `src/GrainModule.tsx:203-216`.

**Farmer failure scenario:** A farmer has 160 allocated acres, 180 APH, and 80% coverage. The app derives 23,040 “safe” bushels. If the actual crop is only 16,000 bu, it can still encourage commitments based on 23,040 bu. RP is a revenue policy, not a physical-delivery guarantee; an indemnity does not eliminate delivery-default, buyout, basis, or contract-risk exposure.

**Suggested fix:** Do not label this quantity “Safe to forward.” Label it “Entered RP coverage bushels — not a delivery guarantee,” require an explicit farmer-set forward-sale limit, and cap any suggested volume by conservative production/contract rules. Keep the number informational unless policy/unit data and a documented marketing-risk rule are added.

### P0-2 — 86–95% inputs are calculated as individual Revenue Protection despite being area-coverage territory

**Evidence:** The database accepts `rp_coverage_pct` through 95%: `supabase/migrations/0030_budget_insurance.sql:14-16`. The calculator applies the same individual APH × coverage × projected-price formula to every accepted value: `src/data/insuranceMath.ts:36-45`. The UI warns that 86–95% is typically ECO/SCO, but still displays the resulting dollar and bushel figures: `src/ProfitabilityModule.tsx:182`.

**Static RMA definition check:** Standard individual RP coverage is generally 50–85%. SCO covers the band from the underlying policy’s coverage to 86%, and ECO is county/area-based coverage at selected trigger levels. Those products do not equal `farm APH × 90% × projected price`.

**Farmer failure scenario:** At 90%, 180 APH, and $4.62, the app displays a $748.44/ac floor. A farmer may treat that as individual RP protection even though an ECO/SCO payment depends on county results and its interaction with the underlying policy.

**Suggested fix:** Restrict this individual-RP calculator to 50–85%. Model SCO/ECO separately with explicit county/area inputs and wording, or block 86–95% until that model exists.

### P0-3 — Grain can show an arbitrary plan’s break-even when multiple named budgets exist

**Evidence:** The product intentionally supports several named plans for one crop/year: `docs/profitability-upgrade-spec.md:26-37`. `getBreakeven` chooses the first budget matching only the scope, even though multiple names are permitted: `src/data/SupabaseProfitabilityRepository.ts:261-266`. Workspace ordering includes budget name, making this deterministic but still arbitrary: `src/data/SupabaseProfitabilityRepository.ts:136-140`. Grain displays that result as its singular break-even: `src/GrainModule.tsx:202`, `src/GrainModule.tsx:218`.

**Farmer failure scenario:** “Cheap Plan” breaks even at $3.85 while “Full Program” breaks even at $4.55. Grain may show $3.85 simply because “Cheap Plan” sorts first, making a $4.00 cash bid look profitable for acres actually budgeted under Full Program.

**Suggested fix:** Require a designated active/marketing budget per scope, or return `null` plus “Choose a plan” whenever more than one budget matches. Never select a named plan by sort order.

### P0-4 — Landlord settlement can use a budget from the wrong operating entity

**Evidence:** Fields carry an operating entity: `src/data/fields.ts:23-27`; budgets also support one: `supabase/migrations/0006_module4_profitability.sql:29-47`. The landlord report selects the currently selected budget when crop/year match, without checking the field’s entity; otherwise it selects the most recently updated crop/year budget: `src/ProfitabilityReport.tsx:170-182`. It then calculates landlord expense shares from that budget’s costs: `src/ProfitabilityReport.tsx:188-208`.

**Farmer failure scenario:** Entity A’s corn program costs $800/ac and Entity B’s costs $550/ac. Opening Entity A’s selected corn budget while printing a landlord report for Entity B can settle the landlord’s input share from $800/ac rather than $550/ac.

**Suggested fix:** Resolve each report planting to a budget whose entity scope matches the field’s `operating_entity_id`; if multiple plans match, require explicit selection. Print the chosen budget and entity beside every settlement calculation.

## P1 findings

### P1-1 — Debounced insurance saves can overwrite unrelated budget edits

**Evidence:** Insurance builds a whole budget row from the render-time `budget` object and queues it after 350 ms: `src/ProfitabilityModule.tsx:169-179`. Budget controls independently save whole budget rows: `src/ProfitabilityModule.tsx:107`, `src/ProfitabilityModule.tsx:156-159`. The gateway performs an unconditional upsert by ID with no `updated_at` compare-and-swap protection: `src/data/SupabaseProfitabilityDataGateway.ts:7`, `src/data/SupabaseProfitabilityDataGateway.ts:24`.

**Farmer failure scenario:** The farmer changes insurance coverage, then immediately changes expected price from $4.50 to $5.10. The price save succeeds, then the delayed insurance write sends its older full row and restores $4.50.

**Suggested fix:** Save only the insurance columns through a patch/RPC, or serialize all budget writes through one revision-aware queue. Add optimistic concurrency using `updated_at` and refresh/reconcile after a conflict.

### P1-2 — Leaving the Budgets tab within 350 ms loses the final insurance edit

**Evidence:** The unmount cleanup only clears the debounce timer: `src/ProfitabilityModule.tsx:171`. The save is scheduled only after that timer: `src/ProfitabilityModule.tsx:172-179`. The insurance card exists only on the Budgets tab: `src/ProfitabilityModule.tsx:107`.

**Farmer failure scenario:** The farmer enters a projected price, immediately switches to Overview, and later discovers the price never saved.

**Suggested fix:** Flush the current draft synchronously on unmount/tab change, or show an explicit pending-save state and prevent navigation until it is durable. Retain the draft in the write queue before navigation.

### P1-3 — Plan comparison mixes whole-farm and entity-specific plans and arrangements

**Evidence:** Plans are grouped only by crop year and commodity: `src/data/planningTools.ts:5-8`. The comparison gathers all same-year/same-commodity field arrangements, again without entity filtering: `src/ProfitabilityModule.tsx:246-262`. The database correctly prevents an entity-scoped budget from allocating to another entity’s field: `supabase/migrations/0006_module4_profitability.sql:206-208`.

**Farmer failure scenario:** A lower-cost Entity A plan is shown as “Best” under Entity B’s rent arrangement even though it cannot legally be allocated to Entity B’s fields.

**Suggested fix:** Include `operating_entity_id` and `enterprise_label` in plan grouping and arrangement selection. Show a separate whole-farm comparison only when plans are explicitly whole-farm scoped.

## P2 findings

### P2-1 — The calculator is not capable of calculating an RMA RP indemnity or policy-unit result

**Evidence:** The model stores only coverage, APH, projected price, and premium: `src/data/profitability.ts:7-18`, `supabase/migrations/0030_budget_insurance.sql:9-24`. Its optional production argument is unused: `src/data/insuranceMath.ts:34-45`. There is no harvest price, production-to-count, policy/unit identifier, county, approved-yield adjustment, or unit-level allocation model.

**Static RMA definition check:** The projected-price minimum guarantee is correctly represented as `approved yield × coverage level × projected price`. For RP, when harvest price exceeds projected price, the revenue guarantee is price-protected upward; actual revenue uses production to count × harvest price; indemnity is the positive difference between the applicable guarantee and actual revenue. Enterprise and optional units require unit-specific approved yield, acres, production, and loss treatment.

**Farmer failure scenario:** A farmer treats the displayed “income guarantee” or “dollars at risk” as a claim estimate after a yield loss or price rally. The app cannot account for the harvest-price guarantee increase, actual production, or the policy’s unit structure.

**Suggested fix:** Keep the current output explicitly labeled “projected-price planning arithmetic,” as the UI partly does: `src/ProfitabilityModule.tsx:182`. Do not add indemnity language until the required policy/unit inputs and audited formulas exist.

### P2-2 — Several editable numeric fields lack a consistent finite-number guard before live save

**Evidence:** The UI converts text with `Number(value)`: `src/ProfitabilityModule.tsx:24`. Several editable budget, cost-line, and allocation fields test only `> 0` or `>= 0`, allowing pasted `Infinity` through those UI checks: `src/ProfitabilityModule.tsx:159`, `src/ProfitabilityModule.tsx:196`, `src/ProfitabilityModule.tsx:203`. Live save validation likewise checks positivity but not finiteness for budget yield/price, cost amounts, or allocation values: `src/data/SupabaseProfitabilityRepository.ts:85-88`, `src/data/SupabaseProfitabilityRepository.ts:179-183`, `src/data/SupabaseProfitabilityRepository.ts:213-226`.

**Farmer failure scenario:** Pasting malformed numeric text into a cost or field allocation produces a backend/serialization failure rather than a clear inline correction, interrupting a budget edit.

**Suggested fix:** Use one `finitePositive`/`finiteNonNegative` validator at every UI and repository boundary. Preserve current insurance validation, which already checks finiteness: `src/data/insuranceMath.ts:21-27`.

## Revenue Protection formula assessment

- **Correct for its narrow purpose:** `180 APH × 80% = 144 bu/ac`; `144 × $4.62 = $665.28/ac`. The implementation and its regression example agree: `src/data/insuranceMath.ts:38-45`, `src/data/insuranceMath.regression.ts:5-13`.
- **Correctly avoids double-counting premium:** premium is reference-only; budget cost lines drive cost/risk arithmetic: `src/ProfitabilityModule.tsx:182`.
- **Not an indemnity calculation:** no harvest price or production-to-count is modeled. This must remain an entered-number planning display, not a payment estimate.
- **Enterprise/optional-unit limitation:** a single budget can span multiple allocations, but has only one APH and coverage value. That cannot represent separate optional units or an enterprise unit’s actual loss adjustment.

## What was checked and found good

- Per-acre revenue, profit, break-even price, and break-even yield use consistent units: `src/data/profitabilityCalculations.ts:7-17`.
- Field totals correctly multiply per-acre figures by allocated acres: `src/ProfitabilityModule.tsx:206-215`.
- Field economics replace the budget land line with the actual field agreement, avoiding land double-counting: `src/data/profitabilityCalculations.ts:147`, `src/ProfitabilityModule.tsx:212`, `src/ProfitabilityReport.tsx:22-25`.
- Whole-farm aggregation uses allocated acres and suppresses totals when the same crop assignment is allocated to multiple budgets: `src/ProfitabilityModule.tsx:218-239`, `src/ProfitabilityModule.tsx:109-110`.
- Allocation persistence enforces matching crop year/commodity, entity compatibility, and allocated acres no greater than planted acres: `supabase/migrations/0006_module4_profitability.sql:165-213`.
- Normal null/empty handling is sound for insurance: blank fields become `null`, zero premium is valid, and no RP result appears until coverage, APH, and projected price are complete: `src/ProfitabilityModule.tsx:181-182`, `src/data/insuranceMath.ts:21-32`.
- The insurance card uses one shared draft and serialized insurance-save chain, preventing the earlier intra-card rapid-entry clobber class: `src/ProfitabilityModule.tsx:168-179`.
- Offline writes are strict, farm/user-scoped, FIFO, and guarded by in-process plus cross-tab locks: `src/data/profitabilityWriteQueue.ts:52-74`, `src/data/QueuedProfitabilityRepository.ts:15-17`, `src/data/QueuedProfitabilityRepository.ts:128-149`.
- Matrix replacement is transactionally serialized and validates both axes, distinct values, and sequential order before replacing data: `supabase/migrations/0013_profitability_live_support.sql:92-214`, `supabase/migrations/0013_profitability_live_support.sql:225-261`.
- Profitability data is private-gated before loading, and the multi-row matrix RPC requires authenticated edit and private-financial access: `src/data/SupabaseProfitabilityDataGateway.ts:12-22`, `supabase/migrations/0013_profitability_live_support.sql:68-86`.

## Scope checked

`src/ProfitabilityModule.tsx`, `src/ProfitabilityReport.tsx`, profitability types/calculations/insurance/planning tools, live and queued profitability repositories, data gateway, queue parser, profitability migrations `0006`, `0013`, and `0030`, plus the profitability design, upgrade, grand-plan, and regression documents.