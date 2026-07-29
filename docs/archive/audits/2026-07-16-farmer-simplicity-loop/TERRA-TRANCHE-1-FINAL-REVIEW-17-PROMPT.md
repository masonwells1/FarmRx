# Terra final cross-check 17 — unambiguous application-role proof

Use actual gpt-5.6-terra at Medium reasoning as an independent read-only reviewer. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust summaries/PASS text and do not mutate files, Git, services, databases, or external state. Do not run browser/Playwright/phone. The outer runner alone writes your response.

Return GO only with no HIGH/MEDIUM blocker. Reconcile 43 non-audit files, ordered 18 routes, and the Option 2 hash.

Review 16 is rejected because positive service evidence mixed database-owner and application-role calls. Inspect the repaired `scripts/verify-0042-disposable.ps1`: the redundant owner new-save/replay/reversal workflow must be absent; the canonical new-save/replay/reversal path must execute under authenticated role; the backdated/calendar paths must remain authenticated; and both sides of the dblink save/delete race must now execute the application service RPCs under authenticated role. Owner usage is valid only for migration/backfill/private/catalog assertions and dblink orchestration that an app role cannot perform. Attack for stale claims, missing role restoration, remote connection still acting as postgres, or assertions that cannot distinguish a bypass.

Spot-check all earlier permission, Program, service provenance/wrapper, farm rollback, strict Program/flex, interval, offline/replay/cancellation, pure snapshot, route, fixture, and credential repairs. Fresh outer proof reports TypeScript/E2E TypeScript, 39 regressions, build, audit 0, guards/mutations, credential 43/0, diff/staged/scope/routes/hash, and 9/9 PostgreSQL probes green; browser/Playwright/phone excluded. Rerun concise read-only checks if useful.

Report findings first, categorical verdict, LOW follow-ups, actual model/effort if visible, scope/proof/skipped limits, and `External mutation: no` only if true.
