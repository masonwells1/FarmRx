# Sol final adversarial release review 17 — unambiguous application-role proof

Act as a fresh-context read-only release-gate orchestrator using actual gpt-5.6-sol at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not trust summaries, prior verdicts, or PASS text. Do not edit/create files, change Git, commit, push, deploy, call live services, run browser/Playwright/phone, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Return GO only if no HIGH or MEDIUM correctness, data-integrity, permission, isolation, offline, recovery, migration, concurrency, proof-quality, or release blocker remains. Otherwise return NO-GO with exact evidence, reachable sequence, business impact, smallest repair, and non-vacuous proof. Reconcile exact 43 non-audit implementation/config/test files, ordered 18/18 routes, and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Review 16 is rejected because Luna found mixed owner/application positive service evidence. Verify the final 0042 correction directly:

- the old database-owner duplicate for new service save/replay/reversal has been removed;
- the owner block at the start is explicitly limited to migration backfill, legacy-history reversal safety, deferred private provenance, and catalog metadata that require owner/private visibility;
- the one canonical new save/exact replay/reversal workflow uses `SET LOCAL ROLE authenticated` for every application operation, with owner context only between calls to inspect the private provenance link;
- the backdated/calendar service workflows use authenticated role;
- the two-session race now sets both the outer service save/delete and the remote dblink save connection to role `authenticated`; owner context only coordinates dblink and inspects private/final state;
- Program’s positive manual/task and trusted `skip_program_pass` workflow remains genuinely authenticated.

Try to defeat the role transitions, transaction-local claims, public/private assertions, remote role state, and concurrency proof. Then recheck all earlier RLS, Program provenance, private helper revocation, service wrapper, farm rollback, strict due generation/retry, flex queue, exact history/recompute, offline/cancellation/replay, pure snapshot, clock fence, queue/echo, capability-route, strict fixture, and credential-isolation repairs.

Fresh outer proof on current bytes: forced and standalone-E2E TypeScript PASS; 39/39 regressions PASS; build PASS with existing chunk warning only; audit 0; targeted guards 11/11; foundation static and mutation 11/11; credential 43/0; diff/staged/scope/routes/hash PASS; all nine PostgreSQL 17 disposable probes PASS after this final proof cleanup. Browser/Playwright/phone are deliberately excluded. Independently inspect and rerun concise read-only non-browser checks as useful.

End findings-first with categorical GO/NO-GO, LOW follow-ups, actual model/effort if visible, scope/proof/skipped limits, and `External mutation: no` only if true.
