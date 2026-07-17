Verdict: **NO-GO** — 3 HIGH and 2 MEDIUM actionable findings.

## HIGH

### FS-01 — Capability profile is published before final authorization checks

- **File/line:** [farmContext.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:329), final checks at lines 332–335.
- **Reachable scenario:** Tab A writes the profile to shared `localStorage`, then waits on the final server-epoch and session-token requests. During that wait, another tab can consume the tentative profile, especially if connectivity drops.
- **Expected:** No capability-profile bytes become visible until user, farm, generation/token, server epoch, and session token have passed every final await.
- **Actual risk:** `target.setItem()` happens before both final awaits. Later cleanup cannot undo access or queued work already allowed in another tab.
- **Business impact:** A downgraded or replaced account can temporarily open cached modules or enqueue work using authorization that the originating validation ultimately rejects.
- **Proof:** An in-memory delayed-epoch probe returned `PROFILE_VISIBLE_BEFORE_FINAL_EPOCH=true`.
- **Smallest safe correction:** Complete the final epoch/session awaits and synchronous fence comparison first; only then write/read-back the profile, with no subsequent await before returning it.
- **Verifying regression:** Delay the final epoch call and assert the profile key remains absent. Repeat for token replacement, farm switch, and generation change.

### FS-02 — Ordinary navigation and reads still generate due work

- **File/line:** [App.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:244), also lines 315 and 324; consumers at [NotificationsModule.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/NotificationsModule.tsx:22) and [ProgramsModule.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/ProgramsModule.tsx:102).
- **Reachable scenario:** Any editable member navigates between normal pages. The always-mounted notification bell generates due items on every pathname refresh; entering Programs progress generates again.
- **Expected:** Due generation occurs only through the centrally authorized Farm Access replay/generation path. Ordinary reads remain mutation-free.
- **Actual risk:** App routing injects `generateDueProgramItems` into read components. The notification refresh starts generation concurrently with its read and reads again afterward.
- **Business impact:** Tasks/notifications can materialize merely from browsing, producing duplicate mutation requests and weakening the central replay boundary.
- **Proof:** Focused probe reported `ORDINARY_NOTIFICATION_REFRESH_READS=2 DUE_GENERATIONS=1`.
- **Smallest safe correction:** Stop passing the generator into notification/program read components. Make the central validated path await generation before publishing ready state or explicitly signal a later read.
- **Verifying regression:** Exercise notification refresh and Programs progress with a counter and require zero generation; separately require the central capability-gated path to generate exactly once after replay.

### FS-03 — Fields online/offline ingress disagrees on valid flex drafts and unknown keys

- **File/line:** [SupabaseFieldsRepository.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:139), echo comparison at line 184; [writeQueue.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/writeQueue.ts:34).
- **Reachable scenarios:**
  - A valid structured flex formula omits optional `min_rent_per_acre`, `max_rent_per_acre`, or `price_source_note`.
  - A runtime draft contains an unknown top-level, arrangement, crop, or legacy-flex key.
- **Expected:** One canonical allowlisted parser governs live and durable ingress; optional fields normalize consistently and unknown keys fail before a gateway call or queue write.
- **Actual risk:** Structured validation accepts omitted optional fields, but the queue requires all formula keys. Online save can commit, then echo mapping adds missing keys as `null`, causing exact echo confirmation to report failure after commit. Unknown top-level keys survive normalization and reach the live gateway.
- **Business impact:** The same legitimate save behaves differently online/offline, and farmers can receive a failed-save message after data committed.
- **Proof:** Focused probe returned `UNKNOWN_RETAINED=true` and `OPTIONAL_FLEX_QUEUE=rejected`.
- **Smallest safe correction:** Rebuild normalized drafts from explicit allowlists, canonicalize every structured-flex key to a defined value or `null`, and use that shared parser for both live and queue ingress.
- **Verifying regression:** Test omitted optional flex fields online/offline, unknown keys at every nesting level, gateway-call count zero on rejection, and exact successful echo after canonicalization.

## MEDIUM

### FS-04 — Consecutive offline Equipment edits cannot rebase

- **File/line:** [QueuedEquipmentTasksRepository.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:90); writer contract and implementations at [SupabaseEquipmentTasksRepository.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:77).
- **Reachable scenario:** A farmer edits the same machine, interval, or task twice while offline, then reconnects.
- **Expected:** FIFO replay replaces the second entry’s expected version with the first server save’s `updated_at`.
- **Actual risk:** Replay contains a rebase map, but all operation writers return `Promise<void>` and discard the mapped server row. The map never receives `updated_at`; the second valid edit becomes stale and is parked.
- **Business impact:** The farmer’s final offline change remains unsynced and needs manual attention.
- **Smallest safe correction:** Return the confirmed mapped entity from mutable operation writers and feed its `updated_at` into the existing rebase map.
- **Verifying regression:** Queue two edits of each mutable kind against one ID; assert both replay FIFO, the second receives the first server timestamp, and no needs-attention row remains.

### FS-05 — E2E mocks still contain permissive fallbacks

- **File/line:** [foundation-shell.spec.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:119), especially lines 123–124.
- **Reachable scenario:** A test using `emptyUnknownReads=true` issues a misspelled table request, extra query parameter, or unexpected GET. The capability-probe handler also accepts any method/body.
- **Expected:** Every request must match an explicit method/query/body contract; unknown requests must fail.
- **Actual risk:** Arbitrary GET tables receive `[]` or `null`, allowing request-shape regressions to stay green.
- **Business impact:** Browser proof can falsely certify broken production request contracts.
- **Smallest safe correction:** Replace the generic fallback with explicit handlers and validate the capability probe’s method and exact body.
- **Verifying regression:** Deliberately issue an unknown table, extra query parameter, wrong method, and wrong RPC body; each must enter `unexpected` and return failure.

## Scope and proof reconciliation

- Base and `HEAD`: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- Core tranche: exactly **20/20** declared and changed.
- Replay-containment tranche: exactly **10/10** declared and changed.
- Undeclared or missing code paths: **0**.
- Audit-only directory: **74** untracked artifacts; no other changed path.
- Option 2 SHA-256 matches its declaration.
- Routes: **18 before / 18 after**, with zero additions or removals.
- Credential scan: **104 files, 0 findings**.
- Static snapshot guards: **11/11 PASS**.
- Standalone E2E TypeScript, no emit: **PASS**.
- Focused regressions: Farm Access, queued-operation context, Fields, and Equipment **PASS**.
- `git diff --check`: **PASS**.

The global `npx` and direct `tsx` launchers initially hit sandbox permission errors; those attempts executed no tests. The focused regressions were rerun successfully using `node --import tsx`.

## Residual risk and execution identity

Playwright/browser execution was intentionally not run. Real-browser IndexedDB behavior, responsive UI, and the seeded role-suppression scenarios remain unexecuted residual risk. I also did not rerun the full 39-lane suite, emitting build, dependency audit, or production/live-service checks.

Requested profile was `gpt-5.6-sol / Extra High`; the runtime identifies itself only as Codex based on the GPT-5 family, without exposing an exact build or reasoning-effort telemetry.

**External mutation: no.**
