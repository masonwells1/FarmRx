Verified again after the hook.

- `npm run build` passed: TypeScript build and Vite production bundle completed.
- `npm run regression` passed: all five suites, including `MockInventoryRepository`.
- The executed Inventory regression covers receiving, derived on-hand, mixed-unit conversion, package factors, receipt lock/cancellation, farm isolation, snapshots, and rate validation.

UI browser verification remains unperformed because the task explicitly prohibited starting a server, and no accessible existing FarmRx dev-server endpoint was available.