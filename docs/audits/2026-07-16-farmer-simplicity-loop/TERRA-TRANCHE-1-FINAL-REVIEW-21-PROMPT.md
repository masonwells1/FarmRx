# Terra independent release cross-check 21 — hostile rural auth ordering

Act as a fresh-context, read-only reviewer using actual `gpt-5.6-terra` at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not trust prior reviews or PASS claims. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Review 20 is rejected. Return `GO` only if no HIGH or MEDIUM production-reachable blocker remains.

Concentrate on rural weak-signal auth and recovery. Attack deferred account-A restore, exact offline restore, local and raw auth-js sign-out, external deletion, account-B password pending/success/failure/throw, late A refresh/sign-in, same-user stale session, and valid same-session refresh. Confirm accepted lineage is JWT `sub` plus `session_id`, pending never authorizes a recipient, signed-out lineage is durable, and stale cleanup cannot delete a newer pending nonce.

Attack simultaneous password attempts in independent tabs. A newer accepted nonce must beat an older failure and an older auth-js success that writes/broadcasts before returning. No rollback or commit-error cleanup may restore old bytes unless it still owns the exact nonce. No path may render, persist, or reload the wrong account or sign out the newer one.

Verify the mounted fixture really has two independent providers/clients, same-origin different-path windows, separate Storage views, asynchronous ordered storage events, per-provider state, automatic broadcast, exact shared-byte assertions, separate signout-only restore proof, and competing-intent cases. Reject synthetic one-provider proof.

Spot-check all eleven offline queues, strict-live due work, gate `Try again` versus saved-work `Check signal`, double-click serialization, queue-only ordinary offline-ready save, queue context cancellation, pure snapshots, farm rollback, Fields/flex, Equipment/service provenance, Program provenance, RLS, strict mocks, and credential hygiene.

Reconcile exactly 44 non-audit files, 18/18 unchanged ordered routes, zero staged files, HEAD/base equality, and Option 2 hash `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`. Outer proof reports all 39 regressions, forced and E2E TypeScript, build, audit 0, guards, 11/11 mutations, credential scan 44/0, and nine disposable PostgreSQL probes green. Browser/Playwright/phone are excluded.

Report severity-ordered findings with exact evidence and smallest safe correction. End with `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof result, skipped-lane limits, and `External mutation: no` only if true.
