# Farm Rx delta-6 review

## Runtime

- Model: `gpt-5.6-sol`
- Reasoning effort: `xhigh`
- Review mode: independent, local, read-only

## Checks completed

- Confirmed `HEAD` and merge base against `49614e75140fdf4dee94d916e32b386bef922f1a`.
- Inventoried all tracked changes and untracked candidate files.
- Ran `git diff --check`: passed, with line-ending warnings only.
- Read the permitted requirements, prior Sol findings, current implementation, migrations, and focused tests.
- Traced operation capture through queues, gateways, PostgREST headers, JWT identity, migration 0040 triggers, Storage paths, service-role handling, retry, confirmation, and recovery.
- Inspected installed PostgREST builder behavior to confirm bound headers are retained when requests execute.
- Ran direct TypeScript checking with `--noEmit --incremental false`: passed.
- Ran three controlled in-memory reproductions described below.
- Attempted the complete regression command. It could not start because the read-only sandbox denied `tsx` creation of its temporary IPC directory.

## Reproduced findings

### FRX-D6-001 — P1: work can acquire a new epoch after it was authored

Affected code:

- [QueuedEquipmentTasksRepository.ts](/C:/FarmRx/src/data/QueuedEquipmentTasksRepository.ts:22), save path at [line 32](/C:/FarmRx/src/data/QueuedEquipmentTasksRepository.ts:32)
- [QueuedGrainRepository.ts](/C:/FarmRx/src/data/QueuedGrainRepository.ts:28), save path at [line 43](/C:/FarmRx/src/data/QueuedGrainRepository.ts:43)
- [QueuedInventoryRepository.ts](/C:/FarmRx/src/data/QueuedInventoryRepository.ts:28), save path at [line 57](/C:/FarmRx/src/data/QueuedInventoryRepository.ts:57)
- [QueuedProfitabilityRepository.ts](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:79), save path at [line 98](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:98)

Ordinary sequence: a user begins an operation, their farm access is revoked and regranted while the operation is awaiting, and the save path captures the newly issued epoch before writing.

Reproduction: all four repositories reached their writer once using epoch `2`, although the payload had been constructed under epoch `1`.

Impact: stale work from an earlier access period can be submitted as newly authorized work. Header and SQL fencing correctly validate the second context, but cannot know the payload predates it.

Smallest safe correction: capture the complete nonsecret operation identity and epoch before constructing the entry, carry those immutable values through save, queue, replay, and confirmation, and reject or quarantine on any mismatch. Never recapture a current epoch to authorize an already-created payload.

Required regression: pause each repository after initial capture, revoke/regrant the same user and farm, then prove no writer or queue mutation occurs. Repeat after persistence and reload.

### FRX-D6-002 — P1: delayed queue overlay can modify the newer user’s retained workspace

Affected code:

- [QueuedGrainRepository.ts](/C:/FarmRx/src/data/QueuedGrainRepository.ts:43)
- [QueuedProfitabilityRepository.ts](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:98)

Ordinary sequence: User A starts a save while the queue lock is occupied; User B on the same farm signs in and loads a workspace; the connection becomes unavailable; A’s delayed callback resumes.

Reproduction:

- Grain’s retained B workspace acquired A’s pending entry.
- Profitability’s retained B workspace acquired A’s pending deletion.

Impact: an older user operation can displace or contaminate the newer user’s in-memory view. The repaired final-read guards do not cover these enqueue callbacks.

Smallest safe correction: capture an immutable workspace, verify the original `WorkspaceMemoryScope` inside the final queue lock before every singleton dereference or mutation, and avoid eagerly overlaying queued A state onto the shared singleton.

Required regression: pause A at each queue-lock await, complete same-farm B, then resume A in online and offline modes. Assert B’s retained and returned workspace is byte-for-byte unchanged.

### FRX-D6-003 — P1: confirmation can remove A’s queued work using B’s workspace

Affected code:

- Equipment confirmation at [QueuedEquipmentTasksRepository.ts:30](/C:/FarmRx/src/data/QueuedEquipmentTasksRepository.ts:30), invoked at [line 39](/C:/FarmRx/src/data/QueuedEquipmentTasksRepository.ts:39)
- Analogous Grain confirmation at [QueuedGrainRepository.ts:33](/C:/FarmRx/src/data/QueuedGrainRepository.ts:33), invoked at [line 61](/C:/FarmRx/src/data/QueuedGrainRepository.ts:61)
- General confirmation behavior in [optimisticSave.ts](/C:/FarmRx/src/data/optimisticSave.ts:27)

Ordinary sequence: A has an offline deletion queued. During replay, the active account changes to B. The write fails, but confirmation reads B’s workspace, does not find A’s record, interprets that absence as successful deletion, and removes A’s queue entry.

Reproduction: the Equipment queue contained one entry before replay and zero afterward, despite no successful write.

Impact: pending operational work can be silently discarded and reported as already applied.

Smallest safe correction: do not reconcile identity, epoch, authentication, authorization, or validation failures. Permit confirmation only after genuine transport ambiguity, bind the read to the original context, and reverify identity and epoch before dequeueing.

Required regression: switch account/farm during every confirmation await and prove the original queue remains unchanged. Cover deletes, immutable append operations, and optimistic insert/update confirmation.

## Prior-finding closure matrix

| Prior finding | Delta-6 status |
|---|---|
| Delta-5 P1 #1, same-farm A→B writer reauthoring | Direct A→B mutation is fenced by user binding, but closure is incomplete because FRX-D6-001 can reauthorize stale work after regrant and FRX-D6-003 uses a newer identity during confirmation. |
| Delta-5 P1 #2, Grain/Profitability final callbacks | The repaired final-read paths use guarded local snapshots. Still not closed because FRX-D6-002 remains in the enqueue/overlay callbacks. |
| FRX-FRESH-001, stale work after revocation | Open through FRX-D6-001. |
| FRX-FRESH-002, incompatible push protocols | Implemented: migration 0039 performs preflight refusal and retires legacy paths. Disposable rollout not rerun. |
| FRX-FRESH-003, malformed weather domain | Implemented with full-domain validation; focused test source inspected. |
| FRX-FRESH-004, older weather observation overwrite | Monotonic SQL ordering implemented; disposable PostgreSQL proof not rerun. |
| FRX-FRESH-005, first-good notification | Transition logic corrected; disposable PostgreSQL proof not rerun. |
| FRX-FRESH-006, exhausted targets later appear green | Still open as a prior P1: a target left `sending` with `attempts = 10` is no longer claimable but is absent from terminal and retryable health counts in [0039_scheduler_weather_push_semantics.sql:299](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:299) and [line 379](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:379). |
| FRX-FRESH-007, sequential weather starvation | Bounded concurrency and push scheduling implemented; test source inspected. |
| FRX-FRESH-008, partial scheduler failure returns 200 | Failure aggregation and non-200 response implemented; deployed Edge execution not rerun. |
| FRX-FRESH-009, backslash notification navigation | Canonical same-origin validation is used by push and click handlers. |
| FRX-FRESH-010, empty recovery queues | Empty queues are skipped or removed; recovery exposes export/dismiss rather than unsafe retry. |
| Delta-2 push absolute budget | Absolute deadline now covers claims, provider sends, completion, and health. Actual provider termination remains unproved here. |
| Delta-3 cross-account workspace disclosure | Not closed; FRX-D6-002 reproduces the remaining overlay form. |
| Delta-3 financial-permission epoch transition | Migration 0040 includes `can_view_financials`; database trigger execution not rerun. |
| Delta-3 corrupt fallback lease | Finite lease validation and expiry handling implemented. |
| Delta-3 uncancelled database promises | Abort signals are wired through client calls; actual server-side cancellation remains a proof gap. |
| FRX-D4-001, queued A→B rebind | Direct user rebind is fixed; the broader immutable-authorization requirement remains open through FRX-D6-001. |
| FRX-D4-002, Profitability cache identity mix | Final-read cache path corrected, but same-family mutable overlay remains through FRX-D6-002. |
| FRX-D4-003, Storage validates only NEW path | Migration 0040 validates OLD and NEW object paths; disposable Storage/PostgreSQL proof not rerun. |
| FRX-D4-004, push exceeds absolute deadline | Deadline and remaining-budget calculations implemented; provider-level termination remains unproved. |
| FRX-D4-005, scheduler work continues after response | Cancellation and worker draining are implemented; real PostgREST/PostgreSQL cancellation remains unproved. |

## Proof gaps and residual risks

These are separate from the confirmed defects:

- The 36-program regression command was blocked before its first program by an `EPERM` error creating the `tsx` temporary directory.
- PostgreSQL 0033–0040, the RLS role matrix, and Storage transaction checks were not executed because they require writable disposable infrastructure.
- Vite/PWA build and Playwright browser suites were not rerun because they create output and report artifacts.
- Provider timeout enforcement and server-side cancellation were verified only through source wiring, not real provider/PostgreSQL execution.
- The complete candidate inventory was inspected, but changed verification scripts and image/browser behavior were not all executed.
- No production, Supabase, Vercel, GitHub, email, push provider, or other external service was contacted or changed.

## Verdict

`RELEASE BLOCKED`

No source, tests, evidence, git state, database, deployment, or external service was mutated during this review.
