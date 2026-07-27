# TASK — Module 3 Inventory UI adversarial review (Sol, read-only)

CRITICAL EXECUTION RULE: headless, no human; produce the review document as your FINAL
message — never ask for approval or input.

Review the Module 3 Inventory & compliance UI implementation against the task spec
docs/build-notes/task-m3-ui.md and the semantics in docs/schema-module3.md + migrations
0010/0011. Read code, do not run it. Be adversarial.

## Scope (uncommitted changes)
New: src/InventoryModule.tsx, src/data/inventory.ts, src/data/MockInventoryRepository.regression.ts.
Modified: src/App.tsx, src/data/backends.ts, src/data/index.ts, src/styles/app.css, package.json.

## Hunt specifically for
1. **Ledger integrity**: on-hand ALWAYS derived (no stored running total anywhere, including
   caches that can go stale); received receipts immutable (edit paths rejected; cancel is
   append-style with reason); adjustments append-only; negative on-hand surfaced honestly.
2. **Unit math**: conversions only within volume↔volume / weight↔weight; package units
   require an explicit saved factor; no density guessing; rate×acres ≈ total check only when
   units are truly convertible; snapshotted factors used on historical rows.
3. **Snapshot semantics**: product regulatory/cost facts copied onto application rows at
   save; later catalog edits must not change historical records (check object references —
   a shared mutable reference is a P1).
4. **RUP completeness honesty**: federal-minimum vs good-practice separation matches
   docs/schema-module3.md; no field falsely labeled a legal requirement.
5. **Storage safety**: writes only to farm-rx-inventory-mock:v1; farm binding fail-closed;
   other modules' keys byte-untouched; write-verified persistence; corrupt envelope fails
   closed; seed only when absent.
6. **Seam discipline**: backends manifest + composition correct; Fields via injected
   repository; no Supabase inventory code.
7. **Regression honesty**: stateful, real-behavior assertions (not recomputed arithmetic).
8. **UI rules**: ≥18px, ≥48px, tabular-nums, plain farmer English, farmerError taxonomy,
   375px container-scoped scrolling, teaching empty states, crop-assignment (not bare
   field-year-crop) linkage on spray records.
9. Cross-module regressions: App.tsx/backends changes don't break auth flow or other modules.

## Output format (FINAL message = ONLY this markdown document)
## Findings
Numbered. Each: **P1**/**P2** — one-line title, file:line, what breaks, concrete fix.
Then a short paragraph on verified-clean items.
VERDICT: COMMIT-READY or NEEDS FIXES (n P1)
