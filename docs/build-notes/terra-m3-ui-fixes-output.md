Implemented all nine findings in:

- [inventory.ts](C:\FarmRx\src\data\inventory.ts)
- [InventoryModule.tsx](C:\FarmRx\src\InventoryModule.tsx)
- [MockInventoryRepository.regression.ts](C:\FarmRx\src\data\MockInventoryRepository.regression.ts)
- [app.css](C:\FarmRx\src\styles\app.css)

1. Rejects volume↔weight conversions even with a factor; factors only work when package/count is involved.
2. Fails closed on malformed or semantically invalid saved envelopes, including bad factors, dangling links, farm mismatch, invalid snapshots, and invalid field/crop bindings.
3. Saves signal word and all maximum-label-rate snapshot fields with each application product.
4. Compliance now mirrors defined RUP federal checks and all operational checks, including humidity, REI/PHI, rate-total mismatch, and rate-above-label-max.
5. Added receipt history, editable/finalizable drafts, and required-reason cancellation for received receipts.
6. Enforced chemical-only RUP plus seed crop/variety requirements in both repository and form.
7. Spray records support repeatable, multi-product rows.
8. Raised Inventory badges, warnings, and snapshot facts to 18px minimum.
9. Expanded regressions for full snapshots/factors, volume↔weight rejection, and semantic envelope corruption.

Proof (run against final files):

```text
$ npx tsc --noEmit
Exit code: 0
```

```text
$ npm run build
> farm-rx@0.0.0 build
> tsc -b && vite build
✓ 111 modules transformed.
✓ built in 1.15s
```

```text
$ npm run regression
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
SupabaseFieldsRepository regressions passed.
MockProfitabilityRepository regressions passed.
MockInventoryRepository regressions passed.
```

Deviations: none. The build emits Vite’s existing chunk-size warning only; it does not fail the build.