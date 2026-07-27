## 1. Runtime

- Model: runtime identifies this as **Codex based on GPT-5**. It does not expose a more specific model identifier.
- Reasoning effort: no named effort tier is exposed, so I cannot truthfully report one.
- No Claude, Fable, sub-agent, or other model was called.

## 2. Checks personally run

- Read the permitted goal, handoff, repair roadmap, original Sol findings, prior delta verdict, command logs, complete tracked base diff, and all untracked candidate code/tests/migrations/assets.
- Confirmed `HEAD` remains base commit `49614e75140fdf4dee94d916e32b386bef922f1a`.
- Ran `git diff --check`: passed except existing line-ending warnings.
- Ran all 35 package regression entrypoints with:
  `TSX_DISABLE_CACHE=1 node --import tsx <regression-file>`
  Result: **35 passed, 0 failed**.
- Ran both TypeScript project checks with `--noEmit --incremental false`: passed.
- Transpiled 23 changed/new TypeScript files in memory: no syntax errors.
- Parsed four PowerShell scripts and five JSON/config files: passed.
- Scanned 33 candidate text files for likely secrets: no candidates.
- Structurally checked all three PNG icons and visually inspected the 512px icon.
- Personally executed focused in-memory attacks for:
  - retained generation ledger after primary-fence deletion;
  - missing/all-missing/corrupt revocation metadata;
  - missing access snapshot across revoke/regrant;
  - delayed older validation;
  - paused real repository/queue path across revoke/regrant;
  - cross-user concurrent access refresh;
  - hanging database completion beyond the push budget;
  - provider success followed by repeated completion failure and reclaim.
- Confirmed Docker, `psql`, and Deno are unavailable.

I treated `COMMAND-LOG.md` only as claims and did not award proof credit from it.

## 3. Closure matrix

| Finding | Delta-2 result |
|---|---|
| `FRX-FRESH-001` revocation and stale work | **OPEN — P1.** Retaining the independent ledger correctly prevents primary-fence deletion from resetting generation 2. Partial metadata also fails closed. However, all metadata missing with an existing access snapshot recreates generation 1; a missing/corrupt access snapshot prevents removed farms from being discovered; a paused RPC can mutate remotely after revoke/regrant; and a delayed generation-1 read can be written to IndexedDB under generation 2. |
| `FRX-FRESH-002` legacy delivery migration | **No code defect found; runtime proof missing.** Migration 0039 places its actionable failed/claimed-parent refusal before its first schema change and retires/revokes the legacy RPCs. The documented rollout order is coherent. I could not execute the pre-migration refusal, clean-parent migration, transactional rollback, or mixed-protocol drill. |
| `FRX-FRESH-003` weather-domain validation | **CLOSED in reviewed code.** Full temperature, humidity, wind, precipitation, visibility, pressure, and weather-code validation exists. The 28-case regression passed. |
| `FRX-FRESH-004` older observation rejection | **CLOSED in reviewed SQL; database proof missing.** Migration 0039 rejects observations no newer than the persisted reading. |
| `FRX-FRESH-005` first valid observation firing | **CLOSED in reviewed SQL; database proof missing.** The first valid observation can fire without requiring a prior sample. |
| `FRX-FRESH-006` per-target delivery state and health | **CLOSED for normal paths; database proof missing.** Target state, terminal versus retryable counts, and service-role RPC restrictions exist. The push regression passed. The separate whole-budget defect below still affects whether health returns at all. |
| `FRX-FRESH-007` weather failure versus push execution | **CLOSED.** Weather work is bounded and push execution remains independent. Scheduler/orchestrator regressions passed. |
| `FRX-FRESH-008` scheduler failure propagation | **CLOSED in reviewed code.** Failed farm/weather results and push failures propagate to an unhealthy scheduler response. The helper regression passed; the deployed Edge handler was not executed. |
| `FRX-FRESH-009` notification-link validation | **CLOSED.** Only valid same-origin application paths are accepted. Regression passed. |
| `FRX-FRESH-010` empty revoked-queue recovery | **CLOSED.** Empty queues are skipped rather than shown as recoverable work. Regression passed. |
| Prior delta P2: whole push budget | **OPEN — P2.** Provider sends are bounded, including the 100-hanging-target regression, and the scheduler has an independent 22-second abort. Database completion retries and the final health query remain unbounded. |

## 4. Release defects

### P1 — `FRX-FRESH-001` remains exploitable through missing state and stale in-flight work

Reachable results from my attacks:

- Existing access snapshot plus both metadata records deleted:
  `knownAccessSnapshotAccepted=true`, `queueAccepted=true`, generation 1 recreated.
- Missing access snapshot during revocation:
  no farm is classified as removed, the old queue remains, and the later regrant accepts it under the retained generation.
- Actual queued repository path paused before revoke:
  after revoke, primary-fence deletion, and regrant, the fake remote recorded `remoteApplied=1`; only the client’s post-response verification failed.
- A delayed generation-1 read can reach [`QueuedFieldsRepository`](C:/FarmRx/src/data/queuedFieldsRepository.ts:38), after which [`writeWorkspaceCache`](C:/FarmRx/src/data/workspaceCache.ts:42) captures the *current* generation and can label the stale response as generation 2.

The fail-open initialization is in [`farmRevocationFence.ts`](C:/FarmRx/src/data/farmRevocationFence.ts:103). Removed farms are derived only from the optional stored snapshot in [`farmContext.ts`](C:/FarmRx/src/auth/farmContext.ts:56), with an empty fallback at line 75. Client fencing around an asynchronous task is in [`queueTransaction.ts`](C:/FarmRx/src/data/queueTransaction.ts:80); it cannot undo an RPC that already committed.

Impact: revoked work can be replayed or applied after regrant, and stale workspace data can become readable as current. The existing E2E test that manually inserts a correctly labelled generation-1 cache does not exercise delayed data being relabelled generation 2.

Smallest credible fix:

- Never reconstruct missing metadata from a cached access snapshot; require a successful live validation.
- Enumerate independent fence/ledger scopes during validation instead of relying solely on the access snapshot to identify removed farms.
- Capture the expected generation before starting remote reads and require that exact generation when committing cache results.
- Add a server-owned access epoch to mutating RPCs and validate it atomically inside the database transaction. Client-only before/after checks cannot prevent remote application.

Required proof: repeat the paused repository/RPC sequence and demonstrate no remote row mutation, no active queue, and no readable cache for every metadata-loss and delayed-response variant.

### P1 — Cross-user access refresh is shared globally

[`farmContext.ts`](C:/FarmRx/src/auth/farmContext.ts:17) has one module-global `refresh` promise. Lines 100–101 return that promise regardless of the requested user.

My concurrent attack produced one database call and returned user A’s farm access to a request for user B:

`resultBRequested=userB`, `resultBReturnedUser=userA`.

The same pending promise can also finish after sign-out because clearing stored access does not invalidate it.

Impact: a rapid account transition can surface another account’s farm names/membership context and can repersist stale access after sign-out.

Smallest fix: key refreshes by user ID plus an authentication epoch, invalidate them on account transition/sign-out, and reject any result whose user ID or epoch no longer matches the caller.

Required proof: pause A’s refresh, sign out or switch to B, start B’s refresh, resume both, and prove B never receives or stores A’s access.

### P2 — The push “whole delivery budget” does not cover database completion or health

[`pushDeliveryLogic.ts`](C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:43) retries `finishTarget` three times without a deadline. Calls at lines 98, 104, and 113 are not raced against the delivery signal. After workers finish, line 129 performs an unbounded `getHealth`.

With a 100ms configured budget and a hanging completion call, the delivery promise was still pending after 500ms.

Impact: an invocation can exceed its advertised budget, fail to return endpoint health, and run into the scheduler’s outer abort/runtime limit. The current 100-target test passes because it hangs the provider, not completion or health.

Smallest fix: calculate one absolute deadline and apply the remaining time to claim, provider, every completion attempt, and health. Abort the underlying database request where supported. If completion cannot be confirmed before deadline, leave the leased target retryable and return an unhealthy bounded response.

Required proof: separately hang claim, provider, completion, and health with 100 targets; assert concurrency, elapsed time, retryable state, HTTP health, and the independent scheduler abort.

No new P0 was found.

## 5. Proof gaps

- Migration 0039 was not applied against disposable PostgreSQL. Its preflight refusal, zero-schema-change guarantee, clean-parent migration, RPC privileges, `search_path`, locking, and transaction behavior remain unexecuted.
- No Docker, `psql`, or Deno Edge-runtime execution was available.
- No real multi-tab browser/IndexedDB run was possible. The same-result concurrent-tab winner path and its fixed 50ms wait therefore lack browser proof.
- No build or Playwright run was attempted because those paths write generated artifacts in this read-only sandbox.
- No physical-device PWA, notification, or real Web Push provider test was performed.
- No live Supabase, Vercel, GitHub, provider, or production endpoint was contacted.

These are proof gaps, not the basis for the release decision; the P1 and P2 failures above were reproduced or established directly from executable ordering.

## 6. Residual risks distinct from defects

Web Push remains inherently at-least-once: provider acceptance and database completion cannot be made transactional. In my provider-success/completion-failure/reclaim simulation, the provider was called twice. Once bounded completion handling is fixed, this remains a disclosed residual risk rather than a code defect; notification `topic`/service-worker tags can reduce user-visible duplicates but cannot prove exactly-once delivery.

Offline clients also cannot learn a new revocation until connectivity returns. That is acceptable only if cached/queued work remains fenced and no remote mutation can commit under a stale access epoch.

## 7. Verdict and mutation confirmation

**RELEASE BLOCKED**

Confirmed: I made no source, test, evidence, git-state, or external-service changes. I did not stage, commit, push, deploy, migrate, send providers, or mutate Supabase/Vercel/GitHub. I did not read any prohibited report or ledger content.
