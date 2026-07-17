# Sol authoritative adversarial release review 23 — repaired lineage fallback

Act as a fresh-context, read-only release-gate orchestrator using actual `gpt-5.6-sol` at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Treat every earlier review and PASS claim as untrusted. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your final response.

Review 22 is rejected historical evidence. Its two MEDIUM auth findings and LOW foundation follow-up were repaired. Return `GO` only if no HIGH or MEDIUM correctness, data, permission, rural recovery, concurrency, auth-isolation, or proof-quality blocker remains.

First reattack the exact Review-22 closure:

- `settleRestoreFailure` must validate an accepted intent against the persisted session's exact JWT `sub` plus signed `session_id` before any offline farm restoration. A mismatch must clear bytes and publish a durable signed-out fence.
- The mounted same-user/different-session transport-failure case must reach that branch with an otherwise valid offline user and prove signed-out UI, removed auth bytes, and a durable fence.
- Both Storage propagation and auth broadcasts in the two-provider fixture must be asynchronous and ordered, with independent providers/clients/windows/Storage views and per-provider intentional-signout state.
- Competing older returned error, rejected promise/throw, auth-js-style success, and injected commit-error races must preserve the newer exact accepted bytes and intent.
- Signed-out transport fallback must survive an unmount/remount with the exact durable fence unchanged.
- Delayed sign-out farm cleanup must preserve the exact raw newer session bytes, not only user/refresh fields.
- `verify-0042-disposable.ps1` must be in the durable foundation orchestrator and the deterministic static guard must require all 18 lanes including 0042.

Then spot-check the wider Farmer Simplicity release: bounded transport-only offline auth/access/profile restore; exact user/JWT/farm/fence/epoch bytes; seven-day and clock rollback; all eleven queue lanes without offline server due generation; gate `Try again` versus strict-live `Check signal`; serialized retries; queue-only save after offline-ready; truthful retry state; pure snapshots; farm rollback; Fields/flex; Equipment FIFO/service reversal and provenance; Program provenance; operational RLS; strict mocks; credential hygiene.

Reconcile exactly 46 non-audit files (42 tracked changes plus 4 untracked), zero staged files, HEAD equal to base, unchanged ordered 18/18 routes, and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Fresh outer proof on the repaired bytes reports: focused mounted regression PASS; app/node/standalone-E2E TypeScript PASS; all 39 regressions PASS; production build PASS with only the known chunk warning; dependency audit 0; targeted guards 11/11; foundation static PASS; mutations 11/11; credential scan 46/0; diff/scope/routes/hash/staged gates PASS; and all nine disposable PostgreSQL probes 0033, 0034, 0035, 0036, 0037, 0039, 0040, 0041, 0042 PASS. Browser/Playwright/phone remain deliberately excluded. Rerun concise read-only non-browser probes as useful.

Report findings first with exact evidence and reachable sequence. End with categorical `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof reconciliation, skipped-lane limits, and `External mutation: no` only if true.
