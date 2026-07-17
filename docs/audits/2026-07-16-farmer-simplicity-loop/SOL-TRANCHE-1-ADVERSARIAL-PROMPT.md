# Sol Extra High adversarial review — Farmer Simplicity tranche 1

You are the fresh-context, read-only security adversary for the first Farmer Simplicity implementation tranche. Do not trust earlier summaries or proof claims. Inspect the actual repository, current uncommitted diff, and relevant surrounding source. Do not edit files, commit, push, deploy, call live services, change git refs, or mutate a database.

## Required execution identity

- Model: `gpt-5.6-sol`
- Reasoning effort: `xhigh`
- Sandbox: `read-only`
- Worktree: `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Base HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

Read the project guidance, then inspect the actual diff and all relevant callers. The intended tranche is documented in `docs/audits/2026-07-16-farmer-simplicity-loop/RECONCILED-SLICE-PLAN.md`, but source code is authoritative.

## Attack objectives

Try to prove the implementation unsafe or incomplete. Concentrate on:

1. Access-profile privilege escalation or confused-deputy paths across owner, manager, worker, financial worker, read-only member, named rep, disabled rep, share-off rep, dual member/rep, malformed roles, unknown roles, and cross-farm rows.
2. Stale async publication after account replacement, access-token replacement, selected-farm change, local access-generation change, server epoch change, logout, or provider remount.
3. Unsafe offline reuse: missing/mismatched fences, expired evidence, cross-account or cross-farm reuse, malformed cached data, capability inconsistency, and accidental persistence of the access token.
4. Whether the direct membership/rep queries and helper RPC evidence are internally consistent and fail closed under partial, duplicate, missing, or malformed responses.
5. Hidden side effects in Fields and Equipment/Tasks `getSnapshot()` paths: queue replay, queue locks/leases, cache writes, IndexedDB initialization, sync-status changes, ID creation, due-task generation, storage mutation, database mutation, or mutation-capable dependency fallbacks.
6. Pending overlay duplication, ordering bugs, cross-farm queue items, stale retained in-memory data, or context changes during delayed reads.
7. Integration gaps in `FarmAccessContext` and `App.tsx` that can publish or consume a stale/incorrect profile.
8. Tests that assert mocks rather than real contracts, miss negative cases, or could pass while the implementation remains unsafe.

You may run read-only inspection and local tests. Do not browse the internet or contact Supabase, Vercel, GitHub, or production.

## Report contract

Return findings first, ordered `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`. Every actionable finding must include exact file and line evidence, a concrete failure scenario, and the smallest safe correction. Distinguish proven defects from questions. If there are no blocker/high findings, say exactly: `No BLOCKER or HIGH findings.` Then list tests/commands actually run, their results, residual risks, and confirm external mutation status is `no`.
