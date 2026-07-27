## Findings

- HIGH — Fresh online Equipment/Task saves bypass the new validator. [QueuedEquipmentTasksRepository.ts](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:87>) validates a new entry only when it is appended to the offline queue; an empty online queue calls the writer directly. [SupabaseEquipmentTasksRepository.ts](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:71>) then sends task linkage without equivalent preflight validation. Read-only probes proved that a manual task with forged interval linkage reached the writer, as did four 3-decimal Equipment values. PostgreSQL `numeric(...,2)` can round those values before the echo check, producing a committed change followed by a client failure. Smallest correction: validate every newly constructed entry with the same queue validator before selecting online versus queued execution, and assert the writer receives zero calls for invalid numeric/linkage inputs.

- HIGH — The canonical Fields parser accepts semantically malformed workspaces. [SupabaseFieldsRepository.ts](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:96>) checks broad ranges but omits arrangement-type rules, one-current-arrangement-per-field, and planted-acres-versus-field-acres validation. Probes confirmed it accepted both an `owned` arrangement containing cash rent and a crop assignment exceeding its field acreage. Such corrupted retained/IndexedDB data can therefore survive the claimed canonical parser. Smallest correction: add these database/business invariants to `validateWorkspace` and exercise them through live, retained, IndexedDB, nested Equipment, and post-overlay tests.

- HIGH — Equipment canonical validation still fails open for malformed rows and scouting linkage. [SupabaseEquipmentTasksRepository.ts](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:30>) converts every non-`true` `is_active` value to `false`; a cached string `"false"` was accepted. [The task relationship check](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:50>) also accepts `source: "scouting"` with no field, although the queue rejects that shape. Smallest correction: require an actual boolean and either fail closed on missing scouting linkage or canonicalize a DB-legal field-deletion orphan to manual history, analogous to service-interval orphan handling.

- MEDIUM — The capability profile is loaded and provided, but not enforced by production composition. [App.tsx](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:171>) ignores `profile`; navigation, routes, and reconnect replays remain unconditional even though the provider receives it at [line 482](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:482>). Named reps can therefore enter membership-only modules, and read-only users still receive editing routes/affordances. Smallest correction: filter navigation, routes, and replay work from the capability matrix and add non-owner production-composition tests.

## Verdict

`NO-GO`

The structural Fields checks, queue/canonical numeric boundaries, service-orphan normalization, clock rollback fencing, token/epoch races, exact membership/rep filters, helper RPC bodies, cold-cache side-effect checks, and pure-snapshot mutation tests are otherwise present and passed focused review. The three HIGH findings prevent release.

## Commands and results

- HEAD: exactly `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- TypeScript:
  - `tsc -p tsconfig.app.json --noEmit --incremental false` — PASS.
  - `tsc -p tsconfig.node.json --noEmit --incremental false` — PASS.
- Regressions with `TSX_DISABLE_CACHE=1`:
  - Farm access — PASS.
  - Fields — PASS.
  - Equipment/Tasks — PASS.
  - Queued operation context — PASS.
- `git diff --check <base>` — PASS; only Git ACL/CRLF warnings.
- Queue/canonical boundary probes:
  - `numeric(16,2)` representable upper value accepted; upper overflow and excess scale rejected.
  - `numeric(18,2)` representable upper value accepted; upper overflow rejected.
  - signed-int maximum accepted; maximum-plus-one rejected.
- Adversarial probes:
  - Invalid manual interval linkage reached the online writer: `writerCalls: 1`.
  - Four 3-decimal Equipment values all reached online writers.
  - Fields parser accepted `owned-with-rent` and `crop-over-field-acres`.
  - Equipment parser accepted nonboolean `is_active` and scouting without a field.
- Initial `tsx` execution attempted a temporary cache write and was denied; it was rerun successfully with caching disabled.
- No Playwright, browser, build, live-service, or database commands were run.

## 18-file reconciliation

Exact checkpoint confirmed: 17 modified tracked files plus new `src/data/deviceClockFence.ts`.

Production files: `App.tsx`, `FarmAccessContext.tsx`, `farmContext.ts`, both queued repositories, both Supabase repositories, Equipment service composition, `equipmentTasks.ts`, its write queue, `fields.ts`, `workspaceCache.ts`, and `deviceClockFence.ts`.

Test files: the four changed regression files and `tests/e2e/foundation-shell.spec.ts`.

The untracked audit directory, including `SCOPE-CORRECTION.md`, remains excluded. Final status was unchanged from the inspected checkpoint.

Residual risks: browser/E2E behavior, real IndexedDB behavior, build integration, and live PostgreSQL/PostgREST behavior remain unexecuted by explicit instruction.

External mutation: no
