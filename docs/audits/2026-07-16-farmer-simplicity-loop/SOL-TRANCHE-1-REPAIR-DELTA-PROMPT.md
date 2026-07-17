# Sol Extra High repaired delta gate — Farmer Simplicity tranche 1

Fresh-context, read-only security gate. Inspect the actual current uncommitted diff against base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`; do not trust summaries, earlier reports, or passing tests. Do not edit files, refs, services, browsers, or databases.

- Model `gpt-5.6-sol`, effort `xhigh`, sandbox `read-only`
- Worktree `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Intended checkpoint: exactly 18 production/test files listed by the current diff plus untracked `src/data/deviceClockFence.ts`; audit artifacts are excluded from the future code commit.

The preceding final gate found one HIGH and three MEDIUM issues. Attack their repairs directly:

1. **Clock rollback:** reproduce live/day-six/rollback for general access, profile access, Fields retained snapshots, Equipment retained snapshots, and cold IndexedDB reads. Verify a durable account high-water mark, in-memory high-water for write-free snapshots, skew handling, fail-closed cleanup, and no snapshot-path writes.
2. **Publication race:** change session token and server epoch during the final profile `setItem`; prove the cache is deleted and no old profile returns. Check that no session token is persisted or logged.
3. **All five Equipment queue writes:** try blank/oversized text, impossible calendar dates, negative/out-of-range numbers, missing rules, meter/reading mismatch, cross-farm equipment, missing program linkage, malformed optional fields, and unexpected keys. Then attack post-overlay farm/field/equipment/interval/member/source relations.
4. **Workspace payload validation:** corrupt live, retained-memory, and IndexedDB Equipment workspaces with malformed rows, duplicate IDs, cross-farm rows, invalid viewer data, and dangling references. Verify one canonical validator runs before retention and again after overlays.
5. **Cold restart:** inspect the fresh-repository IndexedDB tests for Fields and Equipment. Confirm they actually exercise an existing database and store, perform no create/upgrade/write/notice/access-resolution/ID work, and reject corrupted payloads.
6. Recheck the complete access-profile capability matrix, pure snapshot mutation checklist, production composition, E2E mock request shapes, TypeScript correctness, and scope reconciliation. Treat `SCOPE-CORRECTION.md` as the current 18-file checkpoint declaration requiring Mason's explicit commit approval.

Run any local read-only probes needed. You may use `TSX_DISABLE_CACHE=1 node --import tsx`, no-emit TypeScript, and `git diff --check`; do not run Playwright or anything that writes build/test artifacts.

Report findings first as BLOCKER/HIGH/MEDIUM/LOW with exact file/line, failure scenario, and smallest correction. If there is no blocker or high, say exactly `No BLOCKER or HIGH findings.` State a categorical `GO` or `NO-GO`, list commands/results and residual risks, reconcile all 18 code/test files, and state `External mutation: no`.
