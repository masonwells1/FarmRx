## 1. Runtime

- Model: `gpt-5.6-sol`
- Reasoning effort: `xhigh` — Extra High
- Source: this session’s runtime metadata/header.
- No Claude, Fable, sub-agent, or other model was used.

## 2. Checks personally run

Read-only checks included:

- `git status --short --branch`
- `git diff --name-status 49614e75140fdf4dee94d916e32b386bef922f1a --`
- `git diff --stat 49614e75140fdf4dee94d916e32b386bef922f1a --`
- `git ls-files --others --exclude-standard`
- File-scoped base-to-working-tree diffs across the changed application, repository, Edge Function, migration, test, PWA, and configuration surfaces.
- Line-numbered inspection of migrations 0038–0040, disposable verification scripts, all singleton queued repositories, cache/fence/lease logic, push delivery, scheduler/weather logic, and relevant RLS/storage policies.
- `rg` traces for:
  - Repository singletons and retained workspaces.
  - Queue keys and transaction callers.
  - Workspace cache reads/writes.
  - Dynamic farm-context resolution.
  - Epoch triggers, grants, `SECURITY DEFINER` functions, service-role paths, and storage policies.
  - Legacy and target-level push RPCs.
- Structural and visual inspection of all three new PNG icons.
- Exact runtime model/effort extraction from session metadata.

I did not count the supplied TypeScript, regression, build, browser, mutation-drill, or PostgreSQL results as independent proof.

## 3. Closure matrix

| Finding | Delta-4 adjudication |
|---|---|
| `FRX-FRESH-001` revocation/stale work | **OPEN — P1.** Same-scope revoke/regrant fencing is materially improved, and the Fields fallback no longer directly returns another account’s retained workspace. The complete closure fails because queued operations are not request-bound to their captured context, and Profitability can persist one context’s financial workspace beneath another context’s cache key. See `FRX-D4-001` and `FRX-D4-002`. |
| `FRX-FRESH-002` incompatible legacy push protocols | **No contrary code defect found; runtime closure unproven.** Migration 0039 performs its refusal before schema changes, retires both legacy RPCs, and revokes their service-role grants. I did not independently execute the transactional refusal or mixed-version rollout. |
| `FRX-FRESH-003` malformed weather domains | **CLOSED in reviewed code.** Current parsing rejects non-finite, negative, fractional weather-code, and out-of-range values. |
| `FRX-FRESH-004` older forecast overwrite | **CLOSED in SQL shape; database proof gap.** `record_scheduled_spray_window` locks the field/day state and rejects observations whose timestamp is not newer. |
| `FRX-FRESH-005` first-good observation never fires | **CLOSED in SQL shape; database proof gap.** A first complete good observation is now eligible to create the deduplicated notification. |
| `FRX-FRESH-006` terminal push failure disappears | **CLOSED for target-state accounting in reviewed SQL.** Terminal and retryable counts remain queryable on an empty later sweep. Deadline/cancellation defects remain separately open. |
| `FRX-FRESH-007` weather outage starves push | **Original sequential-provider defect closed.** Weather work is concurrent and deadline-bounded, and push runs afterward. A related late database mutation/order defect remains as `FRX-D4-005`. |
| `FRX-FRESH-008` partial scheduler failure reports success | **CLOSED in reviewed handler code.** Farm/weather failures produce an error-level result and HTTP 503; deployed Edge-runtime proof is missing. |
| `FRX-FRESH-009` cross-origin notification link | **CLOSED.** Links are parsed against the application origin, exact origin equality is required, and backslashes/control characters are rejected. |
| `FRX-FRESH-010` empty recovery queues | **CLOSED.** Empty queue and needs-attention envelopes are removed without becoming recovery records. |
| Prior delta-2 whole push budget | **OPEN — P2.** Claim/finish/health receive one AbortSignal, but the real Web Push operation ignores it and may continue after the bounded caller has returned. See `FRX-D4-004`. |
| Delta-3 cross-account in-memory workspace | **OPEN — P1.** The generic memory key is improved, but the broader repository surface still permits context rebinding and the Profitability auxiliary-cache race. |
| Delta-3 financial revoke does not bump epoch | **CLOSED in current SQL shape; database proof gap.** `can_view_financials` is included in the membership update trigger. |
| Delta-3 corrupt far-future fallback lease | **CLOSED for the reported corruption case.** Lease timestamps are finite/safe/horizon-limited and acquisition has a monotonic timeout. Absolute mid-task mutual exclusion after lease theft, clock movement, or timer throttling remains a residual proof gap. |
| Delta-3 database promises not cancelled | **Closed at client wiring level; end-to-end proof missing.** Supabase RPC builders now receive `.abortSignal(signal)`. Whether PostgREST/PostgreSQL actually stops a mutating statement after client abort was not independently demonstrated. The provider cancellation gap remains open separately. |

## 4. New release defects

### `FRX-D4-001` — P1 — Queued operations can be rebound from context A into context B

Affected save paths resolve context once to create the entry, then resolve it again inside `save()` without checking that the entry still matches:

- [QueuedEquipmentTasksRepository.ts](/C:/FarmRx/src/data/QueuedEquipmentTasksRepository.ts:31)
- [QueuedGrainRepository.ts](/C:/FarmRx/src/data/QueuedGrainRepository.ts:42)
- [QueuedInventoryRepository.ts](/C:/FarmRx/src/data/QueuedInventoryRepository.ts:56)
- [QueuedProfitabilityRepository.ts](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:89)

The corresponding live writers independently resolve the current farm again and often overwrite the entry’s `farm_id`:

- [SupabaseEquipmentTasksRepository.ts](/C:/FarmRx/src/data/SupabaseEquipmentTasksRepository.ts:39)
- [SupabaseGrainRepository.ts](/C:/FarmRx/src/data/SupabaseGrainRepository.ts:73)
- [SupabaseInventoryRepository.ts](/C:/FarmRx/src/data/SupabaseInventoryRepository.ts:46)
- [SupabaseProfitabilityRepository.ts](/C:/FarmRx/src/data/SupabaseProfitabilityRepository.ts:232)

Reachable scenario:

1. User/farm A begins an equipment, cash-bid, inventory-product, or budget save.
2. The account or selected farm changes before the second context lookup.
3. The operation is protected by B’s queue/fence, while carrying A’s business payload.
4. Online, the live writer normalizes that payload to farm B. Offline, an A entry is appended to B’s queue and blocks later replay.
5. Existing replay loops have the same problem when they capture queue A but the live writer resolves farm B before the RPC.

The epoch trigger validates the row actually written—B—against B’s current header and authentication. It does not know the operation was captured under A.

Impact: cross-farm or cross-account operational/financial data contamination, incorrect audit identity, and poisoned queues.

Smallest fix:

- Capture one immutable `{projectRef,userId,farmId,generation,token,serverEpoch}` operation context.
- Pass it through entry creation, queue selection, replay, live writer, and RPC.
- Never re-resolve `currentFarmContext()` inside an operation writer.
- Reject before provider/database I/O if an entry differs from the immutable context.
- Bind expected user/farm to the atomic server operation so an authentication transition cannot silently re-authorize stale work.

Required proof: pause every queued repository at each context boundary, switch user/farm, and prove zero RPCs, zero cross-context queue entries, and zero remote rows for both direct saves and replays.

### `FRX-D4-002` — P1 — Profitability can cache B’s financial workspace under A’s key

Evidence:

- A’s guard and cache scope are captured at [QueuedProfitabilityRepository.ts:50](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:50).
- `this.workspace` is assigned at line 57.
- A guard failure during the auxiliary `rawCostLines()` request is swallowed by the broad best-effort catch at [line 58](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:58).
- The cache write then uses mutable shared `this.workspace` and `this.rawCostLineCache` at [line 59](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:59).
- `writeWorkspaceCache` validates A’s revocation fence, not the repository memory guard, at [workspaceCache.ts:73](/C:/FarmRx/src/data/workspaceCache.ts:73).

Reachable scenario:

1. A loads its workspace and pauses during `rawCostLines()`.
2. B enters the singleton, clears A memory, and completes its own workspace/raw-cost load.
3. A’s raw request returns; A’s memory verification throws but is swallowed.
4. A writes the now-B-valued mutable fields into IndexedDB using A’s still-valid cache fence.
5. A later opens offline and receives B’s financial data.

Impact: cross-account or cross-farm disclosure of budgets, costs, allocations, and profitability information.

Smallest fix: keep workspace and raw cost lines in immutable locals; never swallow `WorkspaceMemoryChangedError`; verify the same memory guard immediately before cache construction and after persistence.

Required proof: two deferred concurrent Profitability loads for different users and farms, followed by direct IndexedDB inspection and offline reload.

### `FRX-D4-003` — P1 — Storage-object moves do not validate the old farm epoch

The public-table guard checks both old and new farms, but the storage guard selects only `NEW` for updates:

- [0040_farm_access_epoch_fencing.sql:224](/C:/FarmRx/supabase/migrations/0040_farm_access_epoch_fencing.sql:224)
- Only the resulting path’s farm is asserted at [line 233](/C:/FarmRx/supabase/migrations/0040_farm_access_epoch_fencing.sql:233).

The existing `farm-rx` storage UPDATE policy permits an update when both the old and new paths are currently editable.

Reachable scenario: a delayed request contains stale epoch A and current epoch B, access to A has since been revoked and regranted, and the request moves an object from `A/...` to `B/...`. RLS sees current access to both farms, while the trigger validates only B. The stale A operation succeeds.

Impact: stale removal from farm A and cross-farm placement into B despite the promised old/new epoch fence.

Smallest fix: for UPDATE, parse and validate both `OLD.bucket_id/name` and `NEW.bucket_id/name`; require current epochs for every protected old/new farm and reject protected-to-unprotected moves without the old check.

Required proof: disposable role-matrix attacks for A→B, A→unprotected bucket, malformed old/new paths, stale old epoch/current new epoch, and fresh epochs for both.

### `FRX-D4-004` — P2 — The Web Push request can outlive the absolute delivery deadline

The wrapper races provider completion against the deadline at [pushDeliveryLogic.ts:100](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:100), but the production provider ignores the supplied signal:

- [send-push/index.ts:65](/C:/FarmRx/supabase/functions/send-push/index.ts:65)
- It uses a fixed eight-second provider timeout at [line 67](/C:/FarmRx/supabase/functions/send-push/index.ts:67), regardless of the remaining whole-run budget.

A provider request beginning near the 20-second boundary can continue after `deliverClaimedPushTargets` has returned unhealthy. If it is accepted later, the target remains `sending`; reclaim can send it again.

Impact: late phone notification followed by a duplicate retry, with endpoint state disagreeing with provider reality.

Smallest fix: do not start sends without a completion reserve; cap each underlying request to the remaining absolute budget and use actual AbortSignal-capable provider transport. If acceptance cannot be disproven, persist an explicit ambiguous state that is not automatically resent.

Required proof: start a provider request immediately before the deadline, force it to ignore ordinary promise cancellation, and prove no network effect occurs after caller return—or that ambiguous delivery cannot be automatically resent.

### `FRX-D4-005` — P2 — Weather database work can mutate after push and handler completion

Evidence:

- The weather deadline controller covers fetches at [scheduledAlertOrchestrator.ts:66](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:66).
- `recordSprayWindow` receives no signal and is awaited at [line 88](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:88).
- At the deadline, worker settlement is detached with `void Promise.allSettled` at [line 117](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:117).
- Push runs immediately afterward at [line 122](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:122).
- The real scheduler database calls have no abort wiring at [scheduled-alert-sweep/index.ts:47](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:47).

Reachable scenario: weather fetch succeeds, but `record_scheduled_spray_window` hangs beyond the weather deadline. Push runs without the notification, the handler returns a partial failure, and the outstanding RPC later inserts the spray state/notification.

Impact: late state mutation, a spray notification missed by that push sweep, and an invocation result that no longer describes final database state.

Smallest fix: use one absolute scheduler deadline across database, weather, record, and push phases; propagate cancellation to every RPC; do not proceed to push until record operations have either durably completed or been confirmed cancelled.

Required proof: independently hang initial sweep, field listing, spray recording, and push; verify bounded return, real request termination, no post-return database mutation, and that push observes every committed notification.

No P0 was found.

## 5. Proof gaps

These are separate from the defects above:

- The claimed 36-program regression, TypeScript, build, audit, mutation drills, and 30/30 browser results were not independently rerun.
- Migrations 0039 and 0040 were not personally executed against disposable PostgreSQL during this review. Transaction behavior, ACLs, trigger ordering, locks, RLS, and storage moves therefore lack independent runtime proof.
- `.abortSignal(signal)` is visibly wired into Supabase RPC builders, but actual PostgREST/PostgreSQL statement cancellation and prevention of later mutation were not demonstrated.
- No real Deno Edge runtime, Web Push provider, Supabase project, Vercel preview, GitHub service, or physical device was accessed.
- No real multi-tab no-Web-Locks test covered timer throttling, clock movement, mid-task lease theft, or a continuously renewed valid lease.
- Actual CDN CSP/header matching and opaque-frame behavior remain preview-only proof gaps.
- Migration 0039’s safe rollout still depends on operationally pausing old workers before its preflight; that deployment-order condition was not exercised.

## 6. Residual risks distinct from defects

- A fully offline device cannot learn about a new server revocation until it reconnects.
- Web Push remains inherently at-least-once when provider acceptance and database completion cannot be transactional.
- The localStorage lease fallback is advisory under suspension and timer throttling; local writes call `verify`, but absolute cross-tab exclusion during remote I/O is not proven.
- Recovery records deliberately retain raw unsent payloads in the browser profile until exported or dismissed.

## 7. Verdict

**RELEASE BLOCKED**

## 8. No-mutation confirmation

Confirmed: no source, test, evidence, asset, migration, git state, Supabase, Vercel, GitHub, provider, email, push, deployment, or database state was changed. Nothing was staged, committed, pushed, deployed, applied, or sent.
