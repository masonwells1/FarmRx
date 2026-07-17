## Findings

No HIGH findings. Seven MEDIUM blockers remain.

1. **Interval deletion fails against intentionally preserved ambiguous history.**
   Evidence: the interval FK uses `ON DELETE SET NULL` in [0016_equipment_tasks.sql](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0016_equipment_tasks.sql:94); the new migration preserves unlinked ambiguous logs at [20260717023021_repair_service_log_meter_provenance.sql](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/20260717023021_repair_service_log_meter_provenance.sql:14), then validates every log update at [line 157](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/20260717023021_repair_service_log_meter_provenance.sql:157).

   - Sequence: manager deletes an interval referenced by an ambiguous metered log → FK sets only `interval_id` to null → deferred UPDATE trigger rejects the still-unlinked log.
   - Impact: ordinary interval deletion is permanently blocked.
   - Correction: skip UPDATE validation when provenance-defining fields are unchanged.
   - Proof: delete an interval attached to ambiguous history; assert interval removed, log/readings intact, `interval_id` null, while a provenance-field mutation still fails.

2. **Backdated/offline service replay can regress reminder completion.**
   [0016_equipment_tasks.sql](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0016_equipment_tasks.sql:219) stamps the interval unconditionally from the arriving log. The UI permits arbitrary service dates at [EquipmentTasksModule.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/EquipmentTasksModule.tsx:649), and due calculations consume those fields at [0016_equipment_tasks.sql](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0016_equipment_tasks.sql:339).

   - Sequence: July 16 / meter 1000 saves first; an offline July 15 / meter 900 entry arrives later; interval becomes July 15 / 900.
   - Impact: false overdue reminders and duplicate maintenance.
   - Correction: recompute from the latest log ordered by `service_date DESC, created_at DESC, id DESC`; update the echo check at [SupabaseEquipmentTasksRepository.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:93).
   - Proof: commit newer service, then older in another transaction; both pairs survive and the interval remains at 1000.

3. **A stale edit URL can create duplicate “owned” ground.**
   [FieldsModule.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/FieldsModule.tsx:1953) treats a missing route field like `/fields/new`, builds blank IDs and an owned agreement at [lines 1994–2031](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/FieldsModule.tsx:1994); normalization allocates new IDs at [SupabaseFieldsRepository.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:183).

   - Sequence: visit `/fields/<deleted-id>/edit`, enter values, save.
   - Impact: duplicate acres and fabricated ownership enter reporting.
   - Correction: if a route ID exists but the field is absent, render Not Found; render Missing Agreement when appropriate. Only `/fields/new` may default to owned.
   - Proof: mounted stale-ID and missing-agreement tests must produce zero writer/queue calls.

4. **A failed farm switch strands old-farm replay and leaks a rejection.**
   The selector discards the promise at [App.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:234). `selectFarm` installs the cancellation tombstone before its fallible access refresh at [farmContext.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:553).

   - Sequence: switch A→B → refresh fails → UI remains on A, promise is unhandled, and A’s retry authorization rejects against the tombstone.
   - Impact: pending work cannot retry without a guessed reload.
   - Correction: catch the switch failure, show an alert, and revalidate/reinstall Farm A authorization.
   - Proof: force refresh failure; assert no unhandled rejection, exact queue preservation, visible recovery, and one successful A retry.

5. **Startup/reconnect late due-generation failure has no recovery action.**
   Startup awaits every replay/generation step at [App.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:438), including Equipment’s replay-plus-generation factory at [createSupabaseEquipmentTasksServices.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/createSupabaseEquipmentTasksServices.ts:8). Retry actions are installed only afterward at [App.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:497); the blocked view at [line 557](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:557) has no Try again button.

   - Impact: a transient auxiliary RPC failure makes the whole farm inaccessible.
   - Correction: provide a submit-locked gate retry or publish ready and surface the error through `SyncNotice`.
   - Proof: mounted startup late-failure test must retry successfully without duplicate writes or unhandled rejection.

6. **The 0042 proof is non-vacuous only in part.**
   [verify-0042-disposable.ps1](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:42) uses one lookalike that is simultaneously noted and older; its combined assertion at [line 69](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:69) stays green if either hardened predicate is removed. Scalar checks at [line 63](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:63) use `<>`, where no row produces NULL rather than failure. The direct attack also runs as `postgres`, not `authenticated`.

   - Impact: a broken anti-lookalike or authenticated-core path can receive misleading proof.
   - Correction: separate noted/same-timestamp and unnoted/older fixtures, use `IS DISTINCT FROM`, and attack the private core/direct DELETE under `SET LOCAL ROLE authenticated`.
   - Proof: removing either predicate or disabling the deferred trigger must turn the probe red.

7. **Queue-lock cancellation checks the wrong receipt.**
   The queued operation uses value ID `id(87)` at [queuedOperationContext.regression.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:343), but the test preserves unrelated `id(85)` at [line 346](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:346). Production uses the queued value ID at [QueuedEquipmentTasksRepository.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:80).

   - Correction: derive the receipt ID from the queued head.
   - Proof: mutate the real receipt during cancellation and require test failure.

## Verdict

**NO-GO**

The exact provenance predicates, direct service-log DELETE revoke, fail-closed reversal, shared farm lock, exact Equipment overlay behavior, eleven post-lock replay gates, mounted post-ready `SyncNotice`, capability routes, pure snapshots, strict parsers, and field-location echoes inspected clean. They do not offset the MEDIUM blockers above.

## Scope and proof

- Base and HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- Scope: exact 40/40 implementation/configuration files; no missing or extra paths. Audit directory excluded.
- Routes: unchanged exact ordered sequence, 18/18.
- Option 2 SHA-256: `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.
- Read-only app/Node TypeScript: PASS.
- Standalone E2E TypeScript: PASS.
- Regression lanes: 39/39 PASS.
- Targeted guards: 11/11 PASS.
- Foundation static guards: PASS.
- Credential scan: 40 files, 0 findings.
- `git diff --check`: PASS apart from stated line-ending/global-ignore notices.

Not freshly rerun:

- Exact forced `tsc -b --force` and production build, because they write artifacts.
- Dependency audit, because it requires a live registry call.
- Controlled mutation drills, because they create temporary files.
- Nine PostgreSQL 17 probes: Docker CLI is unavailable in this environment.
- Browser, Playwright, and phone lanes, as explicitly excluded.

LOW follow-ups: add 0042 to the durable foundation orchestrator/static guard, and strengthen trigger metadata assertions to bind the exact trigger function/events/owner.

Actual runner model: `gpt-5.6-sol`
Reasoning effort: `xhigh` / Extra High
External mutation: no
