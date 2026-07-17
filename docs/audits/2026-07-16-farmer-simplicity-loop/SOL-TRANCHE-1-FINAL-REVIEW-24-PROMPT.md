# Sol authoritative adversarial release review 24 — cross-tab auth closure

Act as a fresh-context, read-only release-gate orchestrator using actual `gpt-5.6-sol` at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Treat all earlier reviews and PASS claims as untrusted. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your final response.

Review 23 is rejected historical evidence. Its two MEDIUM findings were repaired. Return `GO` only if no HIGH or MEDIUM correctness, security, auth-isolation, concurrency, rural recovery, data, permission, or proof-quality blocker remains.

First reattack the exact Review-23 closure:

- A historical auth-key deletion event with `newValue === null` must not erase a newer accepted login. Verify the handler rereads current persisted state and ignores the event only when the current session exactly matches a durable accepted user/JWT `sub`/signed `session_id` lineage; genuine current deletion, pending intent, malformed bytes, and signed-out fence must remain safe.
- A failed password attempt must capture and restore one coherent shared rollback tuple: exact auth entries, parsed session, and exact intent bytes. It must not combine provider-local `acceptedSession`/`trustedAuthSnapshot` with another tab's shared intent. Inspect double-read validation and every restore/adoption path.
- A prior pending, malformed, signed-out, or mixed tuple must never be restored. The failure path must fail closed, and an older request must not regain nonce ownership after a newer failed attempt (nonce ABA).
- Attack the ownership checks around multi-key auth snapshot and intent restoration. Decide whether any reachable inter-tab interleaving can still overwrite a newer accepted state or leave a reload-trusted mixed lineage.
- The mounted two-provider fixture must exercise the historical deletion after a newer accepted login, the lagged shared-C/provider-local-B rollback window, prior-pending ABA, older returned error, rejected promise/throw, auth-js early success, injected commit error, and delayed sign-out cleanup.
- Each competing race must assert byte-for-byte newer session and accepted-intent preservation, including nonce, access token, refresh token, JWT session lineage, and timestamp where applicable—not only rendered user text.
- The durable foundation guard must enforce the exact ordered 18-route manifest, and its controlled mutation drill must turn red on a route change.

Then spot-check the wider Farmer Simplicity release: bounded transport-only offline auth/access/profile restore; exact user/JWT/farm/fence/epoch bytes; seven-day and clock rollback; all eleven queue lanes without offline server due generation; gate `Try again` versus strict-live `Check signal`; serialized retries; queue-only offline-ready save; truthful retry state; pure snapshots; farm rollback; Fields/flex; Equipment FIFO/service reversal and provenance; Program provenance; operational RLS; strict mocks; credential hygiene.

Reconcile exactly 47 non-audit files (43 tracked changes plus 4 untracked), zero staged files, HEAD equal to base, unchanged ordered 18/18 routes, and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Fresh outer proof on the repaired bytes reports: focused mounted auth regression PASS; forced app/node and standalone-E2E TypeScript PASS; all 39 regressions PASS; production build PASS with only the known chunk warning; dependency audit 0; foundation static PASS; controlled mutations 11/11; credential scan 47/0; diff/scope/routes/hash/staged gates PASS; and all nine disposable PostgreSQL probes 0033, 0034, 0035, 0036, 0037, 0039, 0040, 0041, 0042 plus the RLS role matrix PASS. Browser/Playwright/phone remain deliberately excluded. Rerun concise read-only non-browser probes as useful.

Report findings first with exact evidence and reachable sequence. End with categorical `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof reconciliation, skipped-lane limits, and `External mutation: no` only if true.
