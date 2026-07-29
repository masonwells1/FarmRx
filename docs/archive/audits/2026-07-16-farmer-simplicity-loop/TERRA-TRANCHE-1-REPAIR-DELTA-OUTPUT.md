HIGH — corrupted cached workspaces are not fully validated.

- `src/data/QueuedFieldsRepository.ts:19-22,102-106`: a cold IndexedDB Fields payload is only checked for array shape and `farm_id`. Malformed rows, duplicate IDs, and dangling field/entity references can be returned offline.
- `src/data/SupabaseEquipmentTasksRepository.ts:32-36,43-51`: embedded Fields data is cloned without canonical row validation or duplicate-ID checks. Thus a cached Equipment workspace with malformed/duplicate Fields rows can pass the claimed canonical validator.

Smallest correction: expose/use one strict Fields workspace parser for live, retained-memory, and IndexedDB data; invoke it inside Equipment’s `mapFields` and before Fields snapshot retention/return.

HIGH — forged `service_interval` tasks lack required interval linkage.

- `src/data/equipmentTasksWriteQueue.ts:32-37`
- `src/data/SupabaseEquipmentTasksRepository.ts:30,51`

A locally injected queue item with `source: "service_interval"` and `interval_id: null` is accepted, then passes post-overlay validation because the relation is checked only when an interval ID exists. Direct probe result: `ACCEPTED forged service_interval task without interval linkage`.

Smallest correction: require a valid `interval_id` for `service_interval` in both queue parsing and canonical workspace validation (and add the matching regression).

NO-GO.

Prior repairs otherwise held under focused review: durable/in-memory clock fencing, rollback cleanup, profile publication rechecks and token non-persistence, queue shape/value limits, and fresh existing-IndexedDB opening behavior. E2E mocks include all six capability RPC shapes. The two HIGH findings mean the claimed complete workspace/queue hardening is not closed.

Commands run:

- `git diff --check <base>` — passed.
- Focused `farmContext`, Fields, and Equipment regressions — passed.
- `tsc --noEmit -p tsconfig.app.json` — passed.
- Direct hostile queue probe — reproduced the service-interval bypass.

Scope reconciliation: exactly 18 code/test files are present: 17 tracked diff files plus `src/data/deviceClockFence.ts`; audit artifacts remain excluded per `SCOPE-CORRECTION.md`.

Residual risk: no browser/E2E execution was run, as required; the inspected E2E mock shapes are static-only evidence.

External mutation: no.
