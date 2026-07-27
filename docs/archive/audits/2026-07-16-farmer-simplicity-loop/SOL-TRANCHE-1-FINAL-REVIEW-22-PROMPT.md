# Sol authoritative adversarial release review 22 — final exact-byte closure

Act as a fresh-context, read-only release-gate orchestrator using actual `gpt-5.6-sol` at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Treat summaries, earlier verdicts, and PASS claims as untrusted. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your final response.

Reviews 20 and 21 are rejected historical evidence. Return `GO` only if no HIGH or MEDIUM correctness, data, permission, rural recovery, concurrency, auth-isolation, or proof-quality blocker remains on the exact current 44-file checkpoint.

First attack the latest auth closure in `src/auth/AuthProvider.tsx` and its mounted regression. Verify:

- two independent same-origin providers/clients/Storage views with asynchronous ordered delivery and per-provider test state;
- pending password nonce never authorizes, expires after five minutes, and expired pending is distinguishable from absent legacy state and converted to a durable signed-out deny fence;
- accepted state binds exact JWT `sub` and signed `session_id`; same-user/different-session is rejected while legitimate same-session refresh survives;
- a signed-out record is an intentionally universal durable deny fence, so it safely rejects every stale lineage until a deliberate password attempt replaces it; it need not identify only one previous lineage;
- local, raw auth-js, sibling delayed `SIGNED_OUT`, auth-key deletion, late refresh/sign-in, deferred restore, signout-only restore, and transport/offline fallback cannot resurrect stale access;
- competing sign-ins obey exact persisted nonce ownership: older failure/throw/cancel/commit error and auth-js-style older success that writes/broadcasts before returning cannot replace a newer accepted account;
- sign-out clears shared auth and publishes the fence synchronously before awaited farm-cache cleanup, so delayed account-A cleanup cannot erase newer account-C;
- production module globals are per browser tab JavaScript realm; the same-process two-provider test correctly injects separate intentional-signout state.

Reject vacuous fixture claims: inspect exact UI and persisted-byte assertions for expired pending, signed-out offline fallback, delayed sibling sign-out, raw sign-out replay, same-account stale lineage, competing attempts, and delayed clearFarmAccess.

Then recheck the wider Farmer Simplicity release: bounded transport-only offline auth/access/profile restore; exact user/JWT/farm/fence/epoch bytes; seven-day and clock rollback; all eleven queue lanes without offline server due generation; gate `Try again` versus strict-live `Check signal`; double-click serialization; queue-only save after offline-ready; truthful retry status; pure snapshots; farm rollback; Fields/flex; Equipment FIFO/service reversal and provenance; Program provenance; operational RLS; strict mocks; credential hygiene.

Reconcile exactly 44 non-audit files, unchanged ordered 18/18 routes, zero staged files, HEAD equal to base, and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Fresh outer proof on the exact bytes reports focused auth/farm regressions, forced and standalone E2E TypeScript, all 39 regression lanes, production build, dependency audit 0, targeted/foundation guards, 11/11 mutation drills, credential scan 44/0, diff/scope/routes/hash/staged gates, and all nine disposable PostgreSQL probes green. Browser/Playwright/phone remain deliberately excluded. Rerun concise read-only non-browser probes as useful.

Report findings first with exact evidence and reachable sequence. End with categorical `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof reconciliation, skipped-lane limits, and `External mutation: no` only if true.
