Implemented all seven fixes within the approved nine files.

- Stable queued service-reading IDs, RPC parameter, and echo validation.
- Mapper limits aligned to all `0016` DB length checks.
- Default task board now includes Done; Done is newest-first and capped at 10.
- “Mine” uses the authenticated viewer, not farm creator.
- Viewer role is loaded fail-closed; manager-only controls are hidden for workers/read-only users.
- Calendar service completion accepts retained interval readings.
- Regression suite rebuilt with a stateful canonical fake gateway and 9 coverage groups.

Proof:

```text
.\node_modules\.bin\tsc.cmd -b --force
Exit code: 0

.\node_modules\.bin\vite.cmd build
✓ 135 modules transformed.
✓ built in 1.26s

Local tsx equivalent of npm run regression:
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
SupabaseFieldsRepository regressions passed.
SupabaseGrainRepository regressions passed.
MockProfitabilityRepository regressions passed.
SupabaseProfitabilityRepository regressions passed.
MockInventoryRepository regressions passed.
SupabaseInventoryRepository regression passed (8 coverage groups)
SupabaseEquipmentTasksRepository regression passed (9 coverage groups)
```

Deviation: both global `npx` and `npm` shims are broken because their npm CLI modules are missing. I used the repo-local TypeScript, Vite, and tsx binaries instead. No database operations, server launches, or git commands were run.