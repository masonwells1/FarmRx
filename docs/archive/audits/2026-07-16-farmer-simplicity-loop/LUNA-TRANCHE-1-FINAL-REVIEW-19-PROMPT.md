# Luna farmer-recovery cross-check 19 — offline startup closure

Use actual `gpt-5.6-luna` at Medium reasoning as an independent fresh-context, read-only reviewer. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust prior verdicts or PASS text. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone, mutate persistent databases/data, or expose credentials. The outer runner alone writes your response.

Return `GO` only if no HIGH/MEDIUM farmer-visible recovery, correctness, permission, offline, data-integrity, concurrency, or proof-quality blocker remains. Review 18 is rejected historical evidence because valid cached offline access could still be stopped by server-only due generation.

Trace the real startup/reconnect behavior in plain farmer terms. With a valid offline profile, every pending queue must still be inspected/replayed, retry controls must be installed, cached farm state must become ready, and Program/Equipment server due generation must not run. With a live profile, both strict due generators must still run; a failure must stay visible and retryable without duplicate saving or false synced/ready state. Explicit Equipment retry must continue to inspect the queue and then perform strict due generation. Attack source races, stale access, cancellation, missing work, silent failure, and misleading UI state.

Spot-check earlier farmer-visible/data-safe repairs: read-only users cannot write; Program tasks cannot be forged but trusted Season progress works; service history never guesses a meter relationship and exact reversals remain safe; farm selection rolls back atomically; flex formulas fail closed; queues survive offline/revocation boundaries; no cross-farm data leaks or false sync state; navigation remains capability-shaped. Inspect the 0042 application scenarios sufficiently to ensure supported service RPCs really run authenticated, not as owner with claims.

Reconcile 43 non-audit files, ordered 18/18 unchanged routes, staged zero, HEAD/base equality, and Option 2 hash `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Fresh outer proof reports focused offline regression, forced TypeScript, standalone E2E TypeScript, 39 regressions, build, audit 0, guards/mutations, credentials 43/0, exact manifest/hash gates, and all nine disposable PostgreSQL probes green. Browser/Playwright/phone excluded. Rerun concise read-only checks if useful.

Report findings first, categorical `GO`/`NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof/skipped limits, and `External mutation: no` only if true.
