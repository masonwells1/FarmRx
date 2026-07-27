# Luna scope and proof cross-check — Farmer Simplicity tranche 1

You are a fresh-context, read-only scope, regression, and evidence reviewer. Inspect the repository directly. Treat every prior completion claim as untrusted until verified. Do not edit files, commit, push, deploy, call live services, change git refs, or mutate a database.

## Required execution identity

- Model: `gpt-5.6-luna`
- Reasoning effort: `medium`
- Sandbox: `read-only`
- Worktree: `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Base HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

Read project guidance, the current diff, `RECONCILED-SLICE-PLAN.md`, and `SCOPE-CORRECTION.md` in the audit directory.

## Review objectives

1. Reconcile every changed tracked file against the corrected 13-file manifest and confirm no unintended scope, dependency, generated, secret, or production artifact changes.
2. Map each tranche acceptance condition to concrete implementation and regression evidence. Flag false proof, tautological mocks, weak assertions, unregistered tests, or untested failure modes.
3. Verify snapshots cannot write to web storage, IndexedDB, queue locks/leases, caches, IDs, sync notices, or remote data under online, offline, missing-fence, cross-farm, and delayed-context cases.
4. Verify access-profile cache and publication fencing covers account, access token, farm, local generation, server epoch, evidence freshness, malformed cache, and capability consistency.
5. Check changed lines for secrets, credentials, debug leakage, unsafe logs, TODO bypasses, dead code, and accidental behavior outside tranche 1.
6. Independently judge whether the named focused regressions and TypeScript build are sufficient to allow a pre-commit checkpoint, and list any additional local proof required.

You may run local read-only tests and inspection. Do not browse or contact external services.

## Report contract

Return findings first, ordered `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`. Each actionable finding must cite exact file and line evidence, failure impact, and correction. If there are no blocker/high findings, say exactly: `No BLOCKER or HIGH findings.` Then provide an acceptance-condition evidence matrix, commands actually run/results, residual risks, exact tracked-file count, and external mutation status `no`.
