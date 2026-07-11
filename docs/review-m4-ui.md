## Findings

1. **P1** — Owned fields retain the planned land charge, `src/FieldsModule.tsx:31` and `src/ProfitabilityModule.tsx:89`: owned returns `null`, which triggers the full-budget fallback and incorrectly includes land. Return zero from the shared equivalent-rent formula for owned ground while preserving Fields’ display wording.

2. **P1** — Crop-share rent ignores landlord-paid inputs, `src/FieldsModule.tsx:34`: the calculation returns gross landlord revenue share, overstating equivalent rent and understating operator profit. Extend the shared formula to subtract each categorized cost multiplied by its landlord share.

3. **P1** — Arrangement selection disagrees with the view semantics, `src/ProfitabilityModule.tsx:18`: it selects the first open-ended arrangement regardless of the budget year, ignoring ended arrangements effective during that year and future arrangements not yet effective. Select the latest arrangement overlapping the crop year.

4. **P1** — Switching budgets can display a profit answer from the previous budget’s price and yield, `src/ProfitabilityModule.tsx:39`: `pickedCell` is never reset when `selectedId` changes. Reset the selected cell to the new budget’s expected price and yield.

5. **P1** — Persisted profitability data is not bound to the injected farm, `src/data/MockProfitabilityRepository.ts:52`: the fixed storage key can load another farm’s budgets because `fieldsFarmId` is only used when seeding. Fail closed unless every persisted budget belongs to the currently injected farm.

6. **P1** — Duplicate allocations can double-count acreage, `src/data/MockProfitabilityRepository.ts:72`: the repository does not enforce the database’s unique `(budget_id, crop_assignment_id)` rule, so rapid repeated allocation can create multiple rows and inflate acreage-based totals. Reject conflicting allocations and prevent repeated submission while saving.

7. **P2** — The mock category cannot map to migration 0006, `src/data/profitability.ts:4`: it stores `equipment`, while the database enum and arrangement view require `equipment_depreciation`. Use the schema value internally and retain “Equipment” as the farmer-facing label.

8. **P2** — Matrix and breakeven-yield regressions test locally repeated arithmetic, not production behavior, `src/data/MockProfitabilityRepository.regression.ts:38`: those assertions would pass even if the UI formulas were broken. Extract shared calculation functions and test them, including owned, crop-share, flex, zero-cost, farm isolation, allocation uniqueness, and write-queue byte preservation.

9. **P2** — Invalid matrix ranges fail silently, `src/ProfitabilityModule.tsx:75`: `stepsFromRange` errors are swallowed, so the farmer receives neither validation guidance nor `farmerError` handling. Surface the caught error through the page error state.

10. **P2** — Profitability violates the explicit 18px/48px baseline, `src/styles/app.css:361`: KPI labels, matrix controls/headers, remove actions, field results, and arrangement text use 15–16px; matrix inputs are explicitly reduced to 44px. Raise all Profitability text to at least 18px and all interactive targets to at least 48px.

11. **P2** — A valid empty budget envelope traps the user, `src/ProfitabilityModule.tsx:46`: the empty state says to start a budget but returns before rendering any creation control. Provide a first-budget form or seed action in this state.

12. **P2** — Required total cost is absent, `src/ProfitabilityModule.tsx:57`: the page shows cost per acre but never total budget cost across allocated acres. Add a clearly labeled total-cost result using the applicable allocation acreage and field-adjusted cost basis.

13. **P2** — The “breakeven contour” is an arbitrary global tolerance, `src/ProfitabilityModule.tsx:79`: `4.5%` of the largest absolute cell can outline many cells or none rather than the cells nearest zero. Determine the nearest-to-zero/sign-boundary cells from the actual grid.

Verified clean: base budget totals, breakeven price/yield, BU TO COVER, and matrix-cell arithmetic match migration 0006 for valid positive inputs; zero costs produce finite zero breakevens. The current `{type, trigger, bonus_rate}` flex formula is reused rather than replaced with the pending migration shape. Profitability writes structurally target only `farm-rx-profitability-mock:v1`, copy-from-budget clones lines and steps, the backend manifest is correct, Fields data comes through the injected repository, no Supabase profitability implementation was added, matrix overflow is container-scoped, and the Grain changes are type/composition changes rather than flow rewrites.

VERDICT: NEEDS FIXES (6 P1)