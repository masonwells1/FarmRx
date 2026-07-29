# Sol final adversarial release review 18 — all supported service RPCs authenticated

Act as a fresh-context, read-only release-gate orchestrator using actual gpt-5.6-sol at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not trust summaries, prior verdicts, or PASS text. Do not edit/create files, change Git, commit, push, deploy, call live services, run browser/Playwright/phone, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Return GO only if no HIGH/MEDIUM correctness, data-integrity, permission, isolation, offline, recovery, migration, concurrency, proof-quality, or release blocker remains. Reconcile exact 43 non-audit implementation/config/test files, ordered 18/18 routes, and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Reviews 16 and 17 are rejected historical evidence. Review 17 found legacy historical reversal RPC checks still executed as postgres. Verify the final 0042 structure directly:

1. the first owner block now ends after migration backfill/private provenance and canonical interval repair assertions;
2. exact historical reversal plus ambiguous/noted/older fail-closed reversal behavior runs in its own transaction under `SET LOCAL ROLE authenticated` with correct JWT/epoch headers;
3. owner context resumes only for a direct deferred-constraint invariant and catalog/grant/owner/trigger checks;
4. the canonical new save/exact replay/reversal path, backdated/calendar paths, and both service-RPC sides of the dblink race all run authenticated; owner context only coordinates dblink or inspects deliberately private state;
5. Program positive manual/task and trusted `skip_program_pass` operations remain authenticated.

Try to defeat role transitions, claims, transaction scope, RLS, private/public assertions, remote-role state, and concurrency proof. Then recheck all prior operational RLS, Program provenance, private helper revocation, hardened service wrapper, farm rollback, strict due generation/retry, flex queue, exact history/recompute, offline/cancellation/replay, pure snapshots/clock, queue/echo, capability routes, strict fixtures, and credential isolation.

Fresh outer proof on current bytes: forced and standalone-E2E TypeScript PASS; 39/39 regressions; build with existing chunk warning only; audit 0; targeted/foundation/mutation guards; credential 43/0; diff/staged/scope/routes/hash; and all nine PostgreSQL 17 disposable probes PASS after moving historical reversals to authenticated. Browser/Playwright/phone deliberately excluded. Independently inspect and rerun concise read-only non-browser checks as useful.

End findings-first with categorical GO/NO-GO, LOW follow-ups, actual model/effort if visible, scope/proof/skipped limits, and `External mutation: no` only if true.
