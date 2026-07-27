# Luna independent proof review 21 — two-provider auth and exact scope

Act as a fresh-context, read-only proof reviewer using actual `gpt-5.6-luna` at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not trust summaries, manifests, earlier verdicts, or PASS claims. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Review 20 is rejected. Return `GO` only if no HIGH or MEDIUM correctness or proof-quality blocker remains.

Audit whether the auth regressions prove production behavior. Require two independent mounted AuthProviders and auth clients; same-origin different-path Windows; distinct Storage views backed by one ordered asynchronous bus; per-provider intentional-signout state; auth-client broadcast rather than direct recipient callback; exact UI and persisted-byte assertions; cleanup without unhandled rejection. Confirm separate cases for signout-only deferred restore, signout then new sign-in, pending event before server success, raw `SIGNED_OUT` plus same-session replay, stale different-user and same-user/different-session events, newer success followed by older failure, and newer success followed by older auth-js-style success that writes before returning.

Inspect production nonce ownership and lineage directly. Pending must expire but never authorize. Accepted and signed-out markers must be durable and bind JWT `sub` plus `session_id`. Failure/cancel/commit rollback must act only when its exact nonce still owns storage. Auth-key deletion must publish a durable signed-out fence unless it is stale cleanup while a newer pending nonce owns the attempt. Initial restore and refresh must fail closed on lineage mismatch without breaking a legitimate same-session refresh.

Reconcile every one of exactly 44 non-audit implementation/config/test files to the Farmer Simplicity release, with `src/auth/AuthProvider.tsx` the sole addition beyond the prior 43-file checkpoint. Confirm unchanged ordered 18/18 routes, zero staged files, HEAD equal to base, Option 2 hash `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`, and credential scan coverage of all 44 files.

Spot-check the wider proof for non-vacuous behavior: bounded exact offline access, all eleven queue lanes, strict-live recovery, queue-only ordinary save, pure snapshots, retry truth, farm-switch rollback, Fields/flex, Equipment FIFO and service reversal, operational RLS, Program/service provenance and database races, strict request mocks, and no secret/generated artifact in release scope.

Outer proof reports all 39 regressions, forced and standalone E2E TypeScript, production build, dependency audit 0, targeted/foundation guards, mutation drill 11/11, credential scan 44/0, diff/scope/routes/hash/staged gates, and nine isolated PostgreSQL probes green. Browser/Playwright/phone are deliberately excluded.

Report findings first with exact evidence and smallest correction. End with categorical `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof reconciliation, skipped-lane limits, and `External mutation: no` only if true.
