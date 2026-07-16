## Runtime identity

- Model shown to this reviewer: `Codex, based on GPT-5`
- Reasoning effort: not exposed in the agent-visible runtime header. I cannot truthfully provide a more specific tier.
- No Claude, Fable, sub-agent, other agent, or other model was used.

## Checks personally completed

- Confirmed `HEAD` equals base `49614e75140fdf4dee94d916e32b386bef922f1a`.
- Ran:
  - `git rev-parse HEAD`
  - `git rev-parse --show-toplevel`
  - `git status --short --untracked-files=all`
  - `git diff --stat 49614e... --`
  - `git diff --name-status 49614e... --`
  - `git ls-files --others --exclude-standard`
- Read the six permitted requirements/prior-review files.
- Inspected current queue transactions, access epochs, revocation fences, workspace caches, Supabase request headers, authentication transitions, the four affected queued repositories, their live writers/service wiring, and the current operation-context regression.
- Traced current references to migration 0040’s old/new storage checks and scheduler `.abortSignal` wiring.
- No supplied test/build/database/browser result was counted as independent proof.
- No additional runtime test was executed after the request to stop using tools.

## Confirmed findings

### FRX-D4-001 — P1 — Operation identity remains farm-only at the live-writer boundary

Category: correctness and audit privacy.

Reachable scenario:

1. User A creates or begins replaying an operation for a farm shared with User B.
2. The repository’s second context lookup returns User A and the expected farm.
3. Authentication changes to User B before the live writer resolves its context or initiates gateway I/O.
4. The live writer checks only the optional expected farm. Because both users selected the same farm, the check succeeds.
5. The Supabase request uses the active User B session and User B access-epoch header. User A’s queue fence remains unchanged, so post-write queue verification can also succeed.

The result can be a stale User A operation committed using User B’s authorization and audit identity. Several direct Grain and Profitability operations omit even the expected-farm argument.

Evidence:

- Queue writers re-resolve context but pass only `farmId`: [QueuedEquipmentTasksRepository.ts:23](/C:/FarmRx/src/data/QueuedEquipmentTasksRepository.ts:23), [QueuedGrainRepository.ts:28](/C:/FarmRx/src/data/QueuedGrainRepository.ts:28), [QueuedInventoryRepository.ts:28](/C:/FarmRx/src/data/QueuedInventoryRepository.ts:28), [QueuedProfitabilityRepository.ts:77](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:77).
- Live-writer contracts make expected farm optional and carry no expected user, token, generation, or server epoch: [SupabaseEquipmentTasksRepository.ts:32](/C:/FarmRx/src/data/SupabaseEquipmentTasksRepository.ts:32), [SupabaseGrainRepository.ts:47](/C:/FarmRx/src/data/SupabaseGrainRepository.ts:47), [SupabaseInventoryRepository.ts:39](/C:/FarmRx/src/data/SupabaseInventoryRepository.ts:39), [SupabaseProfitabilityRepository.ts:116](/C:/FarmRx/src/data/SupabaseProfitabilityRepository.ts:116).
- Direct paths omit expected context: [QueuedGrainRepository.ts:45](/C:/FarmRx/src/data/QueuedGrainRepository.ts:45), [QueuedProfitabilityRepository.ts:108](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:108).
- Request epochs are taken from the currently active account, not the operation: [supabaseClient.ts:18](/C:/FarmRx/src/lib/supabaseClient.ts:18).
- The regression switches both user and farm, so it does not cover two users sharing one farm: [queuedOperationContext.regression.ts:21](/C:/FarmRx/src/data/queuedOperationContext.regression.ts:21), [queuedOperationContext.regression.ts:46](/C:/FarmRx/src/data/queuedOperationContext.regression.ts:46).

Smallest safe fix:

- Capture immutable `{projectRef,userId,farmId,generation,token,serverEpoch}` context when the operation is created.
- Make that complete context mandatory—not optional—through queue selection, dispatch, live writer, and server operation.
- Atomically compare `auth.uid()`, expected user, farm, and epoch inside the database mutation.
- Route direct Grain and Profitability operations through the same context-bound path.

Required proof:

- Cover User A→User B on the same farm and different farms, every operation kind, direct saves, replay, delayed reads, and transport fallback.
- Pause at each context boundary and require zero gateway calls, zero new queue entries, zero remote rows, and zero audit identity changes.

### FRX-D5-001 — P1 — A completed B workspace can still be returned to an older A request

Category: financial-data privacy and correctness.

Reachable scenario:

1. Profitability or Grain request A completes its remote load, persistence, and last memory verification.
2. A then waits to acquire its queue transaction.
3. Request B enters the singleton repository and replaces retained memory with B’s workspace.
4. A’s eventual queue callback dereferences mutable `this.workspace` without rechecking A’s memory guard.
5. A can receive B’s workspace, potentially overlaid with A’s pending queue entries.

The delta-4 fix correctly uses immutable locals during Profitability persistence and rethrows `WorkspaceMemoryChangedError`, but the final return step reintroduces shared mutable state after the last verification.

Evidence:

- Profitability’s last verification is followed by an asynchronous lock whose callback reads `this.workspace`: [QueuedProfitabilityRepository.ts:49](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:49), [QueuedProfitabilityRepository.ts:60](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:60), [QueuedProfitabilityRepository.ts:65](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:65).
- Grain has the same final locked dereference: [QueuedGrainRepository.ts:26](/C:/FarmRx/src/data/QueuedGrainRepository.ts:26).
- Context entry clears shared memory when its key changes: [workspaceCache.ts:46](/C:/FarmRx/src/data/workspaceCache.ts:46).
- Queue acquisition is asynchronous and may wait behind existing work: [queueTransaction.ts:22](/C:/FarmRx/src/data/queueTransaction.ts:22).

Smallest safe fix:

- Overlay and return the immutable local workspace rather than `this.workspace`.
- Recheck the captured `WorkspaceMemoryGuard` inside the queue callback and immediately before returning.
- Reject the older call with `WorkspaceMemoryChangedError` if B entered during any finalization step.

Required proof:

- Hold A’s queue lock after its post-persistence verification, complete B’s load, release A, and require A to reject.
- Confirm B remains the retained singleton value, B does not appear under A’s IndexedDB key, and A entries are never overlaid onto B data.
- Repeat for Grain and Profitability.

No new P0 or P2 was confirmed.

## Closure matrix

| Finding | Delta-5 assessment |
|---|---|
| FRX-FRESH-001 | **OPEN — P1.** Operation identity and final workspace-return races remain. |
| FRX-FRESH-002 | No contrary defect confirmed; migration 0039 refusal and mixed-version rollout were not independently executed. |
| FRX-FRESH-003 | No new contrary defect identified; current weather-domain behavior was not independently rerun. |
| FRX-FRESH-004 | No new contrary defect identified; monotonic PostgreSQL behavior remains a runtime proof gap. |
| FRX-FRESH-005 | No new contrary defect identified; first-good behavior remains a runtime proof gap. |
| FRX-FRESH-006 | No new target-accounting defect identified; disposable database health behavior was not rerun. |
| FRX-FRESH-007 | No new sequencing defect confirmed; complete deadline execution was not independently rerun. |
| FRX-FRESH-008 | No new handler-status defect confirmed; deployed Edge behavior remains unverified. |
| FRX-FRESH-009 | No new defect confirmed; service-worker runtime cases were not independently rerun. |
| FRX-FRESH-010 | No new defect confirmed; recovery behavior was not independently rerun. |
| Delta-2 push budget | Closure not established. Underlying provider and database termination remain unproven. |
| Delta-3 cross-account workspace | **OPEN — P1**, through FRX-D5-001 and the remaining operation-identity gap. |
| Delta-3 financial revocation epoch | No contrary SQL defect confirmed; disposable trigger proof remains required. |
| Delta-3 corrupt fallback lease | **Closed in inspected code shape.** Timestamp horizon and acquisition timeout are present; real multi-tab proof remains. |
| Delta-3 database cancellation | Client `.abortSignal` wiring was observed for scheduler RPCs; server-side statement termination remains unproven. |
| FRX-D4-001 | **OPEN — P1.** Same-farm cross-user and direct-save paths remain incompletely bound. |
| FRX-D4-002 | Original mutable persistence construction improved, but the full privacy guarantee remains **OPEN — P1** through FRX-D5-001. |
| FRX-D4-003 | Static references show both old- and new-path checks; disposable storage UPDATE scenarios were not personally rerun. |
| FRX-D4-004 | Closure not established without real provider-termination and ambiguous-acceptance proof. |
| FRX-D4-005 | Scheduler RPC cancellation wiring is present; actual cancellation, late-mutation prevention, and bounded handler completion remain unproven. |

## Proof gaps

- The complete candidate inventory was established, but not every changed and untracked file received a completed line-by-line review before tool use stopped.
- TypeScript, regressions, production build, audit, static guards, browser tests, and mutation drills were not personally rerun.
- Migrations 0033–0040 and the RLS role matrix were not personally executed against disposable PostgreSQL.
- No real PostgREST statement-cancellation, Deno Edge runtime, Web Push transport, preview deployment, or physical-device result was obtained.
- Migration 0040’s storage trigger still needs all specified old/new bucket, malformed-path, stale/fresh epoch, and service-role cases executed.
- Provider acceptance followed by completion uncertainty remains inherently difficult to distinguish from a retryable failure.
- The runtime did not expose a specific model version or named reasoning-effort tier beyond “Codex, based on GPT-5.”

## Residual risks distinct from defects

- A fully offline device cannot learn of a new server-side revocation until it reconnects.
- Web Push remains at-least-once when provider acceptance and database completion cannot be transactional.
- The localStorage lease fallback remains advisory during browser suspension or severe timer throttling.
- Recovery records retain unsent payloads in the local browser profile until exported or dismissed.

## Verdict

**RELEASE BLOCKED**

Two reachable P1 boundaries remain: operation authentication can change after the last user check, and an older financial workspace request can return a newer account’s singleton data.

No external mutation occurred. I did not edit source, tests, evidence, assets, migrations, or git state; stage, commit, push, deploy, apply migrations, send providers, or mutate Supabase, Vercel, GitHub, email, push, or any other external service.
