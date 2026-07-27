Findings first

- MEDIUM — E2E mocks do not enforce exact request shapes for all paths. `farms` accepts any `id` query, while entity/field/arrangement/crop/commodity reads validate neither `farm_id` nor ordering; the account-replacement fixture is even looser. Evidence: [foundation-shell.spec.ts:62-74](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:62), [foundation-shell.spec.ts:157-172](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:157). A production query with missing or incorrect filters could still pass.

- MEDIUM — Cold Equipment corruption coverage is incomplete. The cold-cache matrix checks relationships and a few duplicates, but not malformed equipment rows, numeric upper bounds/scale, malformed meter/log/task values, duplicate IDs across every collection, duplicate members, invalid due rows, or forged task-link combinations. Evidence: [SupabaseEquipmentTasksRepository.regression.ts:118-132](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.regression.ts:118), while live-only numeric coverage is at [SupabaseEquipmentTasksRepository.regression.ts:146-154](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.regression.ts:146).

No BLOCKER or HIGH findings.

The repaired production paths appear isolated: canonical Fields validation reaches live, retained, cold-cache, nested, and overlay paths; Equipment validation enforces numeric bounds and relation invariants; deleted-interval normalization is explicit; profile publication rechecks both token and epoch; pure snapshots avoid mutation-capable fallbacks and writes.

Verdict: NO-GO until the two MEDIUM test-quality gaps are closed.

Residual risk: static inspection only; no build, regression execution, Playwright, browser, database, or network checks were run as requested. The exact code scope reconciles to 18 files: 17 modified tracked files plus untracked `src/data/deviceClockFence.ts`. `AGENTS.md` is absent in this worktree.

External mutation: no
