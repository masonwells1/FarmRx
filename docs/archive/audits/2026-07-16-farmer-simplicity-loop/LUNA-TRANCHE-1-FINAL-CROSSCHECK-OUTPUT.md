## Findings

**BLOCKER B-001 — Exact tranche manifest exceeded.**

The corrected manifest permits 13 tracked files, with an automatic stop for edits outside it ([SCOPE-CORRECTION.md:3-11](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/docs/audits/2026-07-16-farmer-simplicity-loop/SCOPE-CORRECTION.md:3)).

Current diff has 17 tracked files. Four are outside the manifest:

- `src/data/workspaceCache.ts`
- `src/data/equipmentTasksWriteQueue.ts`
- `src/data/queuedOperationContext.regression.ts`
- `tests/e2e/foundation-shell.spec.ts`

Correction: reduce the tranche to the approved 13-file manifest, or explicitly re-authorize the four-file delta before review.

**HIGH H-001 — Equipment queue validation still admits malformed semantic values.**

The parser accepts:

- `saveTask` with `source: "program"` but no program-pass identifiers.
- Equipment with an empty name, model year `0`, and purchase price `-1`.

Evidence: [equipmentTasksWriteQueue.ts:27-33](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:27).

Executable probe accepted both malformed records:

```text
saveTask ACCEPTED
saveEquipment ACCEPTED
```

Correction: enforce the same semantic invariants as the live mappers and add negative tests for each queue operation plus post-overlay validation.

**MEDIUM M-001 — Cold-cache restart proof is missing.**

The regressions test retained in-memory snapshots, not a fresh repository instance reading an existing IndexedDB cache. Fields calls `getData()` before its offline snapshot test ([SupabaseFieldsRepository.regression.ts:77-87](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.regression.ts:77)); Equipment follows the same pattern.

Correction: add a fresh-instance, pre-existing-cache test proving no IndexedDB creation/upgrade, notice publication, or stale-cache display.

**MEDIUM M-002 — Clock rollback proof is incomplete.**

The implementation checks the stored clock high-water value ([farmContext.ts:279-284](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:279)), but the regression suite has future and expiry cases, not a deterministic clock rollback sequence.

Correction: add rollback beyond the skew allowance and rollback within the allowance, verifying fail-closed behavior and unchanged cache bytes.

## Reconciliation

The 13 manifest files are tranche-relevant:

- Access: `farmContext.ts`, `FarmAccessContext.tsx`, `farmContext.regression.ts`, `App.tsx`
- Fields snapshots: `fields.ts`, `SupabaseFieldsRepository.ts`, `QueuedFieldsRepository.ts`, `SupabaseFieldsRepository.regression.ts`
- Equipment/Tasks snapshots: `equipmentTasks.ts`, `SupabaseEquipmentTasksRepository.ts`, `QueuedEquipmentTasksRepository.ts`, `SupabaseEquipmentTasksRepository.regression.ts`, `createSupabaseEquipmentTasksServices.ts`

The four additional tracked files are technically related to proof hardening, but remain unauthorized under the declared manifest.

Tracked count: **17**, numerically below the 20-file ceiling. Manifest compliance: **failed**.

Untracked count: **39**, all under the audit directory: 29 Markdown files, 8 shell scripts, and 2 selected visual PNGs. No browser-generated artifact or actual secret value was found. They are outside the tracked ceiling but must remain excluded from any tranche commit unless explicitly authorized.

## Evidence matrix

| Acceptance condition | Result |
|---|---|
| Access capability matrix | Passed regression |
| Account/session/farm/epoch fencing | Passed regression |
| Malformed profile cache | Passed regression |
| Profile publication race | Passed regression |
| Fields live pure snapshot | Passed regression |
| Fields queued overlay exactly once | Passed regression |
| Equipment pure snapshot, no due-task generation | Passed regression |
| Equipment requires pure Fields snapshot | Passed regression |
| Queue malformed `{}` values | Passed, but semantic malformed values remain accepted |
| Cold-cache restart | Not proven |
| Clock rollback | Not fully proven |
| TypeScript compilation | Passed no-emit check |
| `git diff --check` | Passed, with CRLF warnings |
| Playwright browser lane | Intentionally unrun; not treated as a code defect |
| Live services/database | Not called |

## Commands and results

- Direct auth regression via `node --import tsx`: **passed**
- Direct Fields regression: **passed**
- Direct Equipment/Tasks regression: **passed**
- `npx tsc -p tsconfig.app.json --noEmit --incremental false`: **passed**
- `git diff --check`: **passed**
- Secret-like scan: **no actual leaked secret found**
- Playwright/build/live-service lanes: **not run by scope/instruction**

Verdict: **NO-GO** until the four out-of-manifest edits are resolved and H-001 is corrected.

External mutation: **no**.
