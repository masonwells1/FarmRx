- **HIGH — Offline authorization and snapshot age can still be extended by clock rollback.** [farmContext.ts:279](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:279), [farmContext.ts:411](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:411), [QueuedFieldsRepository.ts:94](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:94), [QueuedEquipmentTasksRepository.ts:67](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:67), [workspaceCache.ts:137](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/workspaceCache.ts:137).
  Failure scenario: I validated on July 15, successfully reopened offline on July 21, then rolled the clock back to July 15. The profile and retained Fields snapshot were accepted again; `clockHighWaterAt` remained July 15. Repeating this can defeat the intended seven-day limit. The general access cache has no high-water value at all. Expired caches also remain stored.
  Smallest correction: centrally track the highest observed time—persist it during access/profile validation and track it in memory for write-free snapshots—then reject any rollback beyond skew. Remove expired/invalid authorization records. Add the exact “day six, then rollback” regression.

- **MEDIUM — Profile publication is not session-fenced after the cache write.** [farmContext.ts:294](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:294), [farmContext.ts:299](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:299).
  Failure scenario: an injected storage interleaving changed the token during `setItem`. The function returned an `owner` profile and retained its cache with token B active; only two session checks occurred. The new regression covers a fence change during publication, but not token/account replacement during publication.
  Smallest correction: after write/readback, re-check the exact session token and fence before returning; remove the cache on either mismatch.

- **MEDIUM — Equipment queue validation remains weaker than the database contract.** [equipmentTasksWriteQueue.ts:24](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:24), [QueuedEquipmentTasksRepository.ts:36](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:36).
  Failure scenario: an adversarial probe showed all five value kinds accepted malformed records: empty required text, 1800 model year, negative prices/readings/intervals, impossible `2026-02-31` dates, a service `reading_id` with no meter reading, a rule-less interval, and inconsistent task links. Several are expressly rejected by the database constraints. These records can enter overlays before being parked during replay.
  Smallest correction: mirror the authoritative trim/length/range/calendar and cross-field rules, require `value.farm_id === entry.farmId`, and validate foreign-reference/source invariants after overlay.

- **MEDIUM — Equipment retained/IndexedDB fallback lacks payload validation.** [QueuedEquipmentTasksRepository.ts:60](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:60), [QueuedEquipmentTasksRepository.ts:68](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:68), [workspaceCache.ts:128](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/workspaceCache.ts:128).
  Failure scenario: the cache envelope verifies account/farm/fence metadata, but not its nested Equipment workspace. A corrupt or older cache with cross-farm rows, dangling equipment/interval/member references, or malformed viewer data can be returned. Fields performs an explicit farm check; Equipment does not.
  Smallest correction: extract the Equipment workspace validator and run it on live, retained-memory, IndexedDB, and post-overlay results before retention or return.

- **LOW — Regression proof does not cover the new production surface end-to-end.** [foundation-shell.spec.ts:40](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:40), [foundation-shell.spec.ts:70](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:70).
  The E2E mocks now support a happy-path owner profile, but do not exercise malformed/denied/rep/read-only/publication-race cases. Source search found no production caller of either new `getSnapshot`; calls exist only in implementations and regressions. Cold IndexedDB `readWorkspaceCachePure` behavior is also untested. Add negative profile scenarios and real-browser cold-cache/no-create/no-notice checks.

Gate verdict: **FAIL — one HIGH finding remains.**

The requested snapshot mutation checklist otherwise passes by source tracing: Fields and Equipment/Tasks `getSnapshot` do not resolve `currentFarmContext`, `loadFarmAccess`, or injected `getContext`; do not replay or lock queues; do not generate tasks or IDs; do not change sync status; do not write caches; and perform no remote mutation. Pure IndexedDB fallback uses `openExisting`, publishes no notice, and fails closed when the database/store/API is unavailable. The repositories do retain private in-memory snapshot state.

Verification:

- Baseline and `HEAD`: exact `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- Tracked delta: exactly **17 files**, 718 additions and 64 deletions. The pre-existing untracked audit directory was excluded and untouched.
- No-emit TypeScript, app and Node configs: pass.
- Complete 39-entry regression suite through `TSX_DISABLE_CACHE=1 node --import tsx`: pass.
- Four focused access/Fields/Equipment/context regressions: pass.
- `git diff --check`: pass.
- The normal npm regression wrapper was blocked because TSX attempted to create a temporary IPC directory; the exact suite was rerun successfully through the permitted invocation.
- Playwright E2E was not run because its configured command builds into `dist` and writes test artifacts, contrary to this read-only gate.
- Live services, browser, refs, database, files, commits, pushes, and deployments: untouched.

External mutation: **no**.
