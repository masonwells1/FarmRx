# Sol final adversarial release review 15 — repaired 43-file Option 2 checkpoint

Act as the fresh-context, read-only release-gate orchestrator using actual gpt-5.6-sol at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not trust summaries, prior verdicts, or reported PASS text. Do not edit or create files, change Git state, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply a migration to a persistent database, mutate persistent data, or print credentials. The outer runner alone writes your final response.

Return GO only if no HIGH or MEDIUM correctness, data-integrity, permission, data-isolation, offline-queue, farmer-recovery, migration-safety, concurrency, or release blocker remains. Otherwise return NO-GO with exact file/line evidence, reachable sequence, business impact, smallest correction, and non-vacuous proof. Record LOW follow-ups separately.

Reconcile the exact 43 implementation/config/test files in `SCOPE-CORRECTION.md`; audit files are evidence-only. Confirm the unchanged ordered 18/18 routes and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Review 14 is rejected historical evidence. Freshly attack each governing Sol finding and its repair:

1. A `read_only` farm member must be unable to insert meter readings, service logs, or tasks, update an existing task, or invoke the public service writer. Owners/managers/workers must retain intended edit paths. Direct authenticated meter insertion must not forge `source='service'`.
2. Existing Program tasks must reject generic same-source changes, Program-to-manual downgrade, and direct authenticated create/update/delete even if a client sets the old custom GUC. Trusted SECURITY DEFINER Program RPCs must still transition the exact task while preserving source, pass ID, and cycle key. Verify Program mutator owners match the `farm_tasks` owner and the obsolete bypass is gone.
3. Authenticated callers must have neither private-schema usage nor private core/linker execute. The public service wrapper must be an empty-search-path SECURITY DEFINER with explicit auth/edit checks and the same farm lock as its core. It must allow both-new atomic creation and exact idempotent replay, but refuse preexisting unlinked log/reading IDs with `SERVICE_LOG_HISTORICAL_PROVENANCE_UNPROVEN`.
4. A failure on the second farm-selection storage write must restore both prior bytes. A rollback-write failure must invalidate both records and fail closed without reinstalling stale retry authorization.
5. Startup/reconnect must call strict Program due generation. A due-generation failure after queue replay must leave the visible retryable gate blocked, and retry must not repeat the already-completed save.
6. A queued `flex_cash_rent` arrangement with null formula must be rejected.
7. The 0042 PostgreSQL proof must be nonvacuous: genuine read-only and authenticated roles, direct attacks, positive owner/RPC paths, full preserved interval-history snapshots, exact idempotency, grant/owner/trigger metadata, and the two-session save/delete race.

Also recheck all earlier repaired invariants: exact service provenance and no guessing; deferred constraint and atomic reversal; canonical interval recomputation; unknown field edit not-found; farmer-visible farm-switch recovery; serialized replay retry; cancellation fences; pure snapshots and durable clock fences; strict queues/echoes; capability-shaped routes; field relationships/flex validation; Equipment FIFO/rebasing; strict E2E mocks; no hidden replay; and no credential/debug leakage.

Fresh outer proof on these bytes: forced TypeScript PASS; standalone E2E TypeScript PASS; all 39 regressions PASS; production build PASS with only the existing chunk warning; audit 0; targeted guards 11/11; foundation static and controlled mutation drills 11/11; credential scan 43/0; diff and staged-empty checks PASS; scope 43/43; routes 18/18; Option hash exact; all nine PostgreSQL 17 disposable probes PASS. Browser/Playwright/phone remain deliberately excluded. Independently inspect and rerun concise read-only non-browser checks as useful.

End with findings first, categorical verdict, actual model/effort, scope reconciliation, proof run, skipped-lane residual limits, and `External mutation: no` only if true.
