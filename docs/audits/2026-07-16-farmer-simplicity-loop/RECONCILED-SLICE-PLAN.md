## 1. Actual launch evidence delegated to parent

The parent launcher owns the authoritative model check. It must capture a CLI header proving:

- Model: `gpt-5.6-sol`
- Reasoning effort: `xhigh`
- Sandbox: `read-only`

Generic worker self-identification and the session ID recorded in the earlier orchestration artifact are not evidence for this validation run. The parent must reject this result if its captured header does not match.

## 2. Final orchestrator verdict

**VALID WITH CORRECTIONS. Implementation is currently NO-GO.**

The reconciled architecture is sound:

- Today is a side-effect-free projection over existing data.
- Quick Record only opens existing workflows.
- Setup progress is derived from canonical records.
- RLS remains the authorization boundary.
- Weather is excluded initially.
- No migration is planned initially.

Source inspection confirmed why Today needs dedicated snapshot methods: existing reads can replay queues or write caches, while Equipment/Tasks additionally generates due tasks. Examples include [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:39), [QueuedGrainRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedGrainRepository.ts:28), [QueuedProgramsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedProgramsRepository.ts:26), [QueuedNotificationsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedNotificationsRepository.ts:16), and [SupabaseEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:38).

Corrections to the proposed orchestration plan:

- Add a pure Programs snapshot so Today can show existing planned passes without replay or generation.
- Scope Today alerts to the captured farm at query time. The current notifications gateway loads alerts across all accessible farms.
- Do not describe an alert as “urgent” unless existing data provides that classification. Today may show a deterministic existing unread alert but must not invent severity or run an alert evaluator.
- Treat the no-migration access profile as conditional on its race, member, and named-rep proofs.
- Apply the twenty-file limit per independently reviewed pre-commit tranche. The complete approved scope cannot credibly fit within twenty files.
- Distinguish Today-owned purity from the existing app-wide post-access coordinator in [App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:403).

Verified current state:

- Branch: `codex/farmrx-farmer-simplicity`
- HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`
- No tracked diff
- The pre-existing audit directory remains untracked

## 3. Current gate

**Gate closed: Mason has not selected visual option 1, 2, or 3.**

Until that selection:

- No source, test, style, migration, package, or evidence-file implementation may begin.
- No data-foundation slice may begin.
- Nobody may blend the options or choose on Mason’s behalf.
- The selected option becomes the authoritative layout reference, subject to the purity, privacy, accessibility, and scope rules below.

## 4. Reconciled product decisions

| Topic | Final decision |
|---|---|
| Today content | Setup progress, existing due tasks, existing planned passes, selected-farm alerts, and a capability-gated whole-farm grain snapshot. |
| Weather | Excluded initially. No geolocation, weather request, or weather cache access. A weather region in the selected visual must use a permitted work/sync/freshness status instead. |
| Alerts | Selected-farm existing notifications only. No transition evaluation, delivery, creation, mark-read, or invented urgency. |
| Grain | Whole-farm snapshot. Permission denial is `forbidden`, never zero. No private values in operational caches, URLs, logs, or notifications. |
| Quick Record | Add rain, add field note, new scouting note, log spray, enter harvest, add task. All require edit capability. |
| Setup checklist | First field, current-year crop assignment, expected yield. Farm creation is already a prerequisite; no separate completion flag. |
| Offline checklist state | Pending local overlays may appear as “saved on this device,” but must remain distinguishable from server-confirmed completion. |
| Basic / More details pilot | Equipment Add/Edit machine. Basic: name, category, make, model, meter, status. More: year, serial/VIN, purchase, warranty, notes. |
| Access profile | Use existing membership/grant rows, permission helpers, and access epochs initially. No migration unless focused proof shows this cannot fail closed. |
| Navigation | Capability-shaped usability only. Hidden navigation never grants or revokes authorization; direct routes remain RLS-protected. |
| Help/account | Reuse existing recovery and save-state infrastructure. No invented support address or password-reset behavior. |

## 5. Serialized implementation slices with owner, file/surface budget, proof, and stop conditions

Only one writer may work at a time.

### Slice 1 — Access profile

- **Owner:** Sol High
- **Budget:** Maximum six files: access profile/context, access-provider integration, focused regression, and test registration only if required. No migration.
- **Proof:** Owner, manager, worker, financial worker, read-only, named rep, disabled rep, share-off, dual member/rep, and cross-farm matrix. Read the access epoch before and after capability loading; publish only if account, session, farm, and epoch still match.
- **Stop:** Ambiguous member/rep result, stale profile publication, arbitrary-farm probing, metadata-derived role, or need for schema work.

### Slice 2 — Fields and Equipment/Tasks pure snapshots

- **Owner:** Sol High
- **Budget:** Maximum eight files across interfaces, queued/live implementations, and focused regressions.
- **Proof:** Read existing live data, fenced cache, and queued overlays without replay, due-task generation, ID creation, cache write, transaction-lock write, or mutation request. Pending overlays appear exactly once.
- **Stop:** Any storage write, RPC mutation, mixed-farm row, context escape, or generated task.

### Slice 3 — Programs pure snapshot

- **Owner:** Sol High
- **Budget:** Maximum four files.
- **Proof:** Existing planned passes load for the captured farm without queue replay, program-due generation, cache write, or ID creation.
- **Stop:** Any generated task/program item, write-capable repository path, or membership-dependent crash that is not safely classified as unavailable.

### Slice 4 — Farm-scoped alert snapshot

- **Owner:** Sol High
- **Budget:** Maximum seven files covering the contract, gateway, repository/wrapper, and regressions.
- **Proof:** Query is constrained to the captured farm before mapping. No other-farm notification enters memory. No mark-read, notification creation, subscription change, replay, cache write, or alert transition occurs.
- **Stop:** Fetch-all-and-filter-later behavior, cross-farm result, invented severity, or any mutation.

### Slice 5 — Private grain snapshot

- **Owner:** Sol High
- **Budget:** Maximum six files.
- **Proof:** Grain is never queried without `can_read_private_financials`; denial is `forbidden`; queued overlays do not replay; Fields dependency uses its pure snapshot; the 24-hour financial freshness ceiling remains separate.
- **Stop:** Private denial rendered as zero, financial values entering operational storage, alert evaluation, queue replay, or mixed farm/entity scope.

### Slice 6 — Today read service and checklist

- **Owner:** Sol High
- **Budget:** Maximum six files.
- **Proof:** One captured user/farm/generation/token/server-epoch context; independent settled lanes; three canonical checklist signals; local pending state clearly labelled; no combined Today cache. Optional lane failure does not erase healthy lanes.
- **Stop:** Stale result publication, optional failure blanking Today, unknown checklist data shown as incomplete, or any side effect.

### Slice 7 — Selected Today UI and default routes

- **Owner:** Terra Medium
- **Budget:** Maximum five files: Today module, routing/session surfaces, scoped styling, and E2E coverage.
- **Proof:** Login, signed-in `/login`, wildcard, farm selection, and farm switch land on `/today`; explicit deep links survive login. Verify desktop and 320/375/390/430px layouts, 48px targets, 18px load-bearing text, and immediate old-farm clearing.
- **Stop:** Visual drift, horizontal overflow, accidental `/fields` default, stale farm display, or Today failure blocking healthy module navigation.

### Slice 8 — Quick Record

- **Owner:** Terra Medium
- **Budget:** Maximum eight files: one launcher/registry, five existing destination modules, Today integration, and E2E proof.
- **Proof:** Each of the six approved actions opens its existing form in two taps. Opening creates no ID or write. The destination retains sole ownership of validation, submit locks, queueing, and save receipts. One double-tapped submit creates one operation.
- **Stop:** Repository import in the launcher, unauthorized action, erased draft, duplicate write path, or any write on open.

### Slice 9 — Basic / More details

- **Owner:** Terra Medium
- **Budget:** Maximum four files.
- **Proof:** Collapsed fields remain mounted and enabled; basic and expanded saves preserve the current payload and repository path; hidden validation opens the section; keyboard, focus, accessible names, offline receipt, and retry behavior remain correct.
- **Stop:** Dropped `FormData`, changed write contract, inaccessible hidden error, or new draft storage.

### Slice 10 — Role-shaped navigation

- **Owner:** Sol High
- **Budget:** Maximum seven files.
- **Proof:** Capability matrix for owner, manager, worker, financial worker, read-only, and named rep; epoch-fenced offline behavior; direct-route RLS checks; mobile More-menu behavior; Quick Record absent without edit capability.
- **Stop:** Role inferred from email, metadata, or route; navigation treated as authorization; read-only write shortcuts; or rep exposure to a membership-dependent module.

### Slice 11 — Help, account, and recovery

- **Owner:** Terra Medium
- **Budget:** Maximum seven files.
- **Proof:** Help/account are reachable after sign-in; existing sync, receipt, attention, and revoked-work language is reused; no private farm values enter support content; quarantined work is never deleted or replayed.
- **Stop:** Authentication change, password-reset implementation without its separate contract, invented support destination, private-data disclosure, or recovery queue mutation.

## 6. Today purity and access/privacy contract

Today-owned code must never initiate or indirectly invoke:

- Queue replay
- Task, service-task, program, or planned-pass generation
- Alert transition recording or delivery
- Notification creation or mark-read
- Geolocation or weather access
- ID, receipt, draft, or checklist creation
- LocalStorage or IndexedDB writes, including lock/lease writes
- Combined Today caching
- Any database mutation

Today may read:

- Live RLS-filtered data
- Existing correctly fenced module caches
- Existing queued overlays through dedicated non-mutating snapshots

Every lane receives the same captured user, farm, generation, token, and server epoch. Every returned farm-scoped row must match that farm. Recheck the context after each asynchronous lane and before publication; any change discards the complete old model.

Additional rules:

- Operational freshness remains at most seven days.
- Financial freshness remains at most 24 hours.
- Stale data shows source and time and cannot support “current” or “all clear.”
- Unavailable data is unknown, not zero or incomplete.
- Private denial is `forbidden`.
- Old-farm content disappears immediately during a farm switch.
- RLS remains authoritative even when navigation hides a destination.

The existing post-access coordinator may independently replay previously saved work after validating access. Today must neither call nor await that coordinator, and mutation-spy proof must attribute those existing app-level actions separately.

## 7. Verification and adversarial loop

After every slice:

- Run its focused regression or mocked browser workflow.
- Use mutation spies for every purity-sensitive path.
- Run `git diff --check`.
- Reconcile declared files against actual changed and untracked files.
- Preserve individual failure results; aggregate scripts may not hide them.

At each pre-commit tranche boundary:

- `npx tsc -b --force`
- `npm run regression`
- `npm run build`
- `npm audit --audit-level=high`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-foundation.ps1`
- Focused Playwright desktop and phone workflows
- Offline, weak-signal, double-tap, farm-switch, account-replacement, stale-session, role, rep, private-data, and revoked-access checks

Then freeze all writers:

1. Fresh Sol Extra High receives requirements, current diff, and proof only. Its first pass is adversarial and may not fix.
2. Terra independently operates the farmer journeys and validates visual fidelity, readability, two-tap reach, and save/recovery language.
3. Luna independently checks scope, changed files, proof quality, accessibility, secret-like material without printing values, and evidence consistency.

Every finding needs an ID, severity, evidence, disposition, owner, and verifying proof. Fixes rerun focused proof; auth, fencing, privacy, queues, navigation, or snapshot fixes also rerun full gates and receive a fresh Sol delta review.

No pre-commit packet may be issued with an unresolved BLOCKER, P0, or P1. P2 requires a fix or explicit Mason acceptance. P3 requires a named owner and regression expectation.

## 8. Scope budget and authority boundaries

- Maximum eight changed tracked files per slice.
- Maximum twenty unique tracked files per independently reviewed pre-commit tranche.
- The ninth slice file or twenty-first tranche file is an automatic stop.
- Because the full feature exceeds twenty files, use multiple independently reviewed commit candidates:
  - Access plus Fields/Equipment snapshots
  - Programs, alerts, and grain snapshots
  - Today service/UI plus Quick Record
  - Progressive disclosure, role navigation, and help/account
- If Mason does not approve an intermediate local commit, stop rather than accumulating past twenty files.
- Declare the exact file manifest before each writer begins.
- No dependency, migration, new external service, broad stylesheet redesign, unrelated cleanup, or generated browser artifact.
- No silent worker-model substitution.
- No commit occurs without Mason approving its completed pre-commit packet.
- No live migration, deployment, push, PR, merge, force-push, customer communication, secret change, permission change, or live-data change is authorized.

## 9. Residual decisions/risks

- Visual option selection is the only current decision gate.
- A weather-heavy visual must use permitted work/sync/freshness content unless Mason later separately authorizes weather design work.
- Named-rep compatibility remains incomplete in several membership-dependent modules; those destinations stay hidden until proven.
- Current notification records do not provide a trustworthy generic urgency classification.
- Read-only users still encounter write controls on some direct module routes. Navigation cannot substitute for correcting that UX.
- Support channel, password-reset redirect, delivery behavior, and account-enumeration contract remain unspecified and excluded.
- Crop-year calculations must reuse the farm-local date authority.
- Mixed live/stale lanes require explicit wording.
- Existing global replay/generation must remain technically and testably separate from Today-owned behavior.

## 10. Mutation statement

No repository file, Git ref, package, browser state, service, database, deployment, or external system was mutated. Only read-only artifact, source, branch, HEAD, and status inspection was performed.

**Next action: Mason selects visual option 1, 2, or 3.**
