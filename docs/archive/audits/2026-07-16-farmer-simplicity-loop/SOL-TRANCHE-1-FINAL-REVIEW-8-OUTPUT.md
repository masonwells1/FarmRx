## Findings

1. MEDIUM — A newer validation does not synchronously cancel an in-flight older replay.

   The validation gate only increments its own counter ([farmContext.ts:100](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:100)), while replay authorization is separate global state ([farmContext.ts:117](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:117)). A reconnect starts a new generation and then awaits access loading ([App.tsx:489](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:489)), but an older replay checks generation only before and after each whole repository action ([App.tsx:423](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:423)).

   Reachable failure: replay A enters a repository and awaits; reconnect B begins, superseding A’s validation generation; before B loads a profile and replaces the global replay grant, A resumes under its still-current grant and can invoke a writer or drain a queue. Only after that action finishes does `isCurrent()` reject A.

   Smallest correction: validation `begin()` and cleanup must install a rejecting replay-cancellation epoch/tombstone that is observed by both already-captured and newly captured replay guards. Add an executable held-writer test proving no writer or queue mutation occurs after the newer validation begins.

2. MEDIUM — Replay identity-guard errors are swallowed, and the new regression accepts that behavior.

   `currentUserId()` correctly captures its guard before the first await and applies it to both online and offline identities ([farmContext.ts:426](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:426)); `currentFarmContext()` similarly captures before awaiting ([farmContext.ts:539](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:539)). However, replay entrypoints convert a rejected context lookup into successful completion, including:

   - [QueuedEquipmentTasksRepository.ts:90](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:90)
   - [QueuedFieldsRepository.ts:149](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:149)
   - [QueuedProgramsRepository.ts:89](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedProgramsRepository.ts:89)
   - [QueuedScoutingRepository.ts:187](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedScoutingRepository.ts:187)
   - [fieldLocation.ts:30](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/fieldLocation.ts:30)

   The same `catch { return }` exists across all eleven replay surfaces. The regression directly tests a captured guard rejection, but then deliberately awaits the actual repository replay as a successful resolution ([queuedOperationContext.regression.ts:307](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:307), [queuedOperationContext.regression.ts:316](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:316)).

   Reachable failure: session A becomes B while A’s split identity lookup is delayed; the pre-await guard rejects correctly; the repository swallows it; central replay sees a fulfilled step. If React has not yet committed B’s new validation, A’s authorization and generation still verify, allowing the stale A access/profile to reach ready temporarily.

   Smallest correction: use a typed replay-context error and rethrow it through every replay catch, while retaining best-effort handling only for genuine transport failures. The regression must assert that the actual delayed replay rejects, not merely that its writer count stays zero.

3. MEDIUM — Field-location success echoes are not exact.

   `mapFieldLocationEcho` verifies only farm/field identity and that returned coordinates/source are valid—not that they equal the requested values ([fieldLocation.ts:23](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/fieldLocation.ts:23)). `send()` passes only farm and field as expectations ([fieldLocation.ts:27](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/fieldLocation.ts:27)).

   A local probe confirmed that a request expectation can accept an unrelated valid `39, -89, gps` response. The online path then reports success and retains no queue entry.

   Smallest correction: include latitude, longitude, and source in the expected echo and compare all five fields exactly; add wrong-coordinate and wrong-source regressions.

4. MEDIUM — Equipment service completion accepts partial nested echoes before removing the FIFO head.

   The service log is checked exactly, but its generated meter reading omits checks for `farm_id`, `read_on`, and `notes`; the interval omits `farm_id` and `equipment_id` checks ([SupabaseEquipmentTasksRepository.ts:93](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:93)). Existing regressions vary only the reading ID and completion date ([SupabaseEquipmentTasksRepository.regression.ts:216](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.regression.ts:216)). Once accepted, replay removes the confirmed queue head ([QueuedEquipmentTasksRepository.ts:90](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:90)).

   Smallest correction: compare every deterministic nested reading/interval field to the operation and farm context before confirming the operation, with wrong-farm, wrong-equipment, wrong-date, and wrong-source regressions.

Other spot checks were clean: percent-of-revenue validation, capability-shaped navigation/direct routes, pure snapshot/cache/clock paths, Equipment FIFO/link/delete overlays, strict queue parsing, removal of constructor/read/event replay, 18/18 route preservation, and the Option 2 SHA-256 match.

**Verdict:** `NO-GO`
**Model and reasoning effort:** `gpt-5.6-sol`, Extra High
**Scope reconciliation:** Base and `HEAD` are both `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`; working-tree code scope is exactly 30/30 manifest files—20 core plus 10 replay-containment—with no code outside the manifest. Audit evidence was excluded.
**Commands/probes run:** Git revision/status/diff and manifest reconciliation; targeted `rg` and line-level source inspection; route comparison; Option 2 SHA-256 comparison; hidden-replay scan; focused queued-context regression via `node --import tsx` — PASS; mismatched field-location echo probe — accepted, confirming finding 3; `git diff --check` — PASS apart from line-ending notices. A direct `tsx.cmd` attempt was sandbox-blocked before execution because it tried to create a temporary IPC directory; no workspace change resulted.
**Residual limits:** Browser/Playwright, live Supabase, deployment, database, full build/typecheck/regression suite, and dependency audit were intentionally not rerun. The supplied fresh proof for those lanes was considered, but it cannot override the source-level reachable failures above.
