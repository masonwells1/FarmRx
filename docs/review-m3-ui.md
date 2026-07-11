## Findings

1. **P1** — Cross-family factors can silently convert liquid into weight, `src/data/inventory.ts:37`: any explicit factor is accepted whenever automatic conversion fails, so `gal → lb` can alter on-hand using guessed density. Permit explicit factors only when at least one side is a package/count unit; reject volume↔weight conversions outright.

2. **P1** — Corrupt but parseable envelopes are trusted, `src/data/inventory.ts:38`: validation accepts negative receipt quantities, invalid factors, dangling product/receipt/application links, and incomplete snapshots, allowing corrupted storage to produce false inventory. Validate every field, relationship, farm binding, enum, positive quantity, and snapshotted factor before opening the envelope.

3. **P1** — Application snapshots omit required regulatory facts, `src/data/inventory.ts:16`: signal word and snapshotted maximum label rate/unit/basis from migrations 0010 are absent, so historical records cannot preserve or check those facts after catalog edits. Add the missing snapshot properties and copy them as scalar values in `saveApplication`.

4. **P1** — Compliance can falsely report operational completeness, `src/InventoryModule.tsx:60`: it omits relative humidity, missing REI/PHI, rate-total mismatch, and rate-above-snapshotted-label-maximum checks, yet can say “Weather and operational details are filled in.” Mirror `rup_application_completeness`: federal items only for RUP products and every migration-defined operational item under “Good practice.”

5. **P1** — Received mistakes and drafts have no usable lifecycle, `src/InventoryModule.tsx:51`: the UI creates receipts but provides no receipt history, draft editing/finalization, or cancel-with-reason action; an erroneous received quantity therefore remains on-hand with no UI repair path. Add a receipt list with editable drafts and a received-row cancellation flow that calls `cancelReceipt` with a required reason.

6. **P1** — Inline products can violate schema-level RUP and product rules, `src/InventoryModule.tsx:50`: the unrestricted checkbox can mark seed, fertilizer, or other products as RUP, while seed-required crop/variety data is not represented; repository validation at `src/data/inventory.ts:64` also accepts these invalid products. Enforce product-kind constraints in the repository and conditionally collect every required product fact.

7. **P2** — Spray records support exactly one product, `src/InventoryModule.tsx:56`: the form always submits `products: [product]` and instructs farmers to create another application, splitting what should be one multi-product treatment record. Add repeatable product rows and submit all products together.

8. **P2** — Inventory text violates the 18px minimum, `src/styles/app.css:366`: the RUP badge is 15px and low/negative warnings are 16px; snapshot label facts are also 16px at `src/styles/app.css:372`. Raise all farmer-facing Inventory text to at least 18px.

9. **P2** — Snapshot regression proves only the product name, `src/data/MockInventoryRepository.regression.ts:30`: it remains green while EPA, RUP, REI/PHI, maximum-rate, inventory-unit, cost, and conversion-factor snapshots are absent or mutable. Mutate every catalog fact after saving and assert every historical scalar and saved factor remains unchanged; also add rejection cases for volume↔weight factors and semantically corrupt envelopes.

Verified clean: on-hand is derived from received receipts, append-only adjustments, and effective completed applications; negative balances are surfaced honestly. Received-receipt edits are rejected, cancellation records a reason, adjustments expose no edit path, and saved factors drive ledger math. Storage uses only `farm-rx-inventory-mock:v1`, seeds only when absent, verifies written bytes, and rejects mismatched envelope farms. Fields are injected through `FieldsRepository`; the backend manifest/composition stays mock-only for Inventory with no Supabase Inventory implementation. `App.tsx` only replaces the Inventory placeholder route, leaving authentication and other module routing unchanged. Error handling uses `farmerError`, crop assignments are explicitly linked, and narrow-screen tab scrolling is container-scoped. This was a read-only code review; nothing was executed.

VERDICT: NEEDS FIXES (6 P1)