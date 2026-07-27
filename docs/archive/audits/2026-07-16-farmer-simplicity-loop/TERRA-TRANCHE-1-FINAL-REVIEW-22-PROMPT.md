# Terra independent cross-check 22 — delayed sign-out and expired pending

Act as a fresh-context, read-only reviewer using actual `gpt-5.6-terra` at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust prior reviews or PASS claims. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Reviews 20 and 21 are rejected. Return `GO` only if no HIGH or MEDIUM production-reachable blocker remains.

Recheck your Review-21 delayed-clearFarmAccess finding directly. Shared auth and signed-out fence must publish synchronously before farm-cache cleanup yields. The mounted two-provider regression must defer A cleanup, accept C in B, resume A, and prove both UI states plus exact C bytes survive.

Attack the rest of auth ordering: expired pending versus absent legacy state; live and transport/offline restore; universal durable signed-out deny fence; accepted JWT `sub` + `session_id`; legitimate same-session refresh; stale same-user/different-session; raw and sibling delayed `SIGNED_OUT`; auth deletion; competing older failure and older auth-js success; exact nonce-owned rollback only. Check the two-client asynchronous fixture is not a singleton shortcut.

Spot-check bounded rural offline restore, all eleven queues, strict-live recovery, queue-only offline-ready save, pure snapshots, farm rollback, Fields/flex, Equipment/service provenance, Program provenance, RLS, strict mocks, and credential hygiene.

Reconcile exactly 44 non-audit files, 18/18 unchanged ordered routes, zero staged files, HEAD/base equality, and Option 2 hash `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`. Outer exact-byte proof reports all 39 regressions, TypeScript, build, audit 0, guards/mutations, credential scan 44/0, and nine disposable PostgreSQL probes green. Browser/Playwright/phone are excluded.

Report severity-ordered findings with exact evidence and smallest correction. End with `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof result, skipped-lane limits, and `External mutation: no` only if true.
