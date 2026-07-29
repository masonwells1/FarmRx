HIGH

- `src/data/SupabaseEquipmentTasksRepository.ts:32-36, 40-52` — `mapFields()` only checks array presence and `farm_id`. Malformed nested Field rows, duplicate IDs, dangling entity/commodity/field references, and invalid nested data can survive the claimed canonical Equipment workspace validator across live, memory, and IndexedDB paths. Smallest correction: invoke the canonical Fields workspace validator from `mapFields()` and reject duplicates/relationships there before retention and after overlays.

MEDIUM

- `src/data/SupabaseEquipmentTasksRepository.regression.ts:110-120` — cold-restart proof covers only one cross-farm Equipment row. It does not exercise malformed rows, duplicate IDs, invalid viewer data, dangling references, or malformed nested Fields payloads.

LOW

- `src/auth/farmContext.regression.ts:204-207` — publication-race proof changes the session token during final `setItem`, but does not change both token and server epoch in that exact write window. Source code performs both final checks correctly.

Verdict: NO-GO.

Checks:

- TypeScript no-emit: passed.
- Farm access regression: passed.
- Fields regression: passed.
- Equipment regression: passed.
- Queued operation-context regression: passed.
- `git diff --check`: passed.
- Playwright not run, per instruction.
- Scope reconciliation: 17 modified tracked files plus untracked `src/data/deviceClockFence.ts` = exactly 18 code/test files. Audit artifacts remain excluded.
- No live services, databases, browsers, refs, or files were mutated.

Residual risk: Equipment workspace validation is not fully fail-closed for its nested Fields payload.

External mutation: no
