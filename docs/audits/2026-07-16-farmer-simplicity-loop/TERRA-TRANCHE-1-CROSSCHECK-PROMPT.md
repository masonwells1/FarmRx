# Terra integration cross-check — Farmer Simplicity tranche 1

You are a fresh-context, read-only integration and maintainability reviewer. Inspect the actual uncommitted diff and surrounding FarmRx source; do not rely on prior reports. Do not edit files, commit, push, deploy, call live services, change git refs, or mutate a database.

## Required execution identity

- Model: `gpt-5.6-terra`
- Reasoning effort: `medium`
- Sandbox: `read-only`
- Worktree: `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Base HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

Read the project guidance and `docs/audits/2026-07-16-farmer-simplicity-loop/RECONCILED-SLICE-PLAN.md`, then inspect source, interfaces, implementations, callers, and regressions.

## Review objectives

1. Verify the access-profile lifecycle integrates correctly with existing farm selection, loading, error, reset, sign-out, and setup flows in `FarmAccessContext` and `App.tsx`.
2. Verify capability semantics match existing membership and named-rep rules without inventing authority.
3. Review API/interface compatibility for Fields and Equipment/Tasks repositories and all known implementations/callers.
4. Verify pure snapshots return useful, deterministic views while avoiding mutation-capable fallbacks and due-task generation.
5. Review queued overlay semantics, retained in-memory fallback, context fencing, error behavior, and duplicate application.
6. Review whether regressions exercise production-shaped behavior and whether any existing behavior is accidentally broken.
7. Identify unnecessary complexity, brittle coupling, TypeScript hazards, or maintainability problems likely to cause future defects.

You may run local read-only tests and inspection. Do not browse or contact external services.

## Report contract

Return findings first, ordered `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`. Each actionable finding needs exact file/line evidence, impact, and a specific correction. If there are no blocker/high findings, say exactly: `No BLOCKER or HIGH findings.` Then report commands actually run, results, residual risks, and external mutation status `no`.
