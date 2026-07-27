## 1. Actual model and effort evidence

The authoritative CLI startup header captured by the parent launcher proves:

- Model: `gpt-5.6-sol`
- Reasoning effort: `xhigh`
- Sandbox: `read-only`
- Session: `019f6b68-eb8f-7851-9f7f-51ec2ecc3711`

Generic in-session model self-identification is not authoritative for this pin.

## 2. Orchestrator verdict

The smallest safe direction is:

- A side-effect-free `Today` projection over existing farm data—not a new table, persisted dashboard, or combined cache.
- Initial Today lanes: setup progress, due work, existing alerts, and a capability-gated whole-farm grain snapshot.
- No Today weather initially.
- Quick Record launches Terra’s six field-work workflows; it never saves independently.
- First-week setup derives from three canonical field signals.
- Equipment “Add/Edit machine” is the first Basic / More details rollout.
- Role-shaped navigation uses existing database helpers and access epochs. No access-profile migration is required initially.

No implementation begins until Mason selects visual option `1`, `2`, or `3`.

## 3. Gate status

Blocked:

- All implementation writing under the current ledger, including data foundations.
- Today layout, card hierarchy, Quick Record presentation, responsive styling, and default-route integration.
- Any attempt to choose or blend the three visual directions.

Read-only preparation complete:

- All required artifacts were read fully.
- Disagreements were checked against current source.
- HEAD remains `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- The branch remains `codex/farmrx-farmer-simplicity`; only the pre-existing audit directory is untracked.
- Data contracts, slice order, proof, stop conditions, and file budgets are reconciled.

The Product Design workflow reinforces the same gate: exactly one visual target must be selected before building.

## 4. Reconciled decisions

| Topic | Disposition | Reason |
|---|---|---|
| Access-profile migration | **Decided: no migration initially** | Existing membership/rep RLS, permission helpers, and access epochs contain the required truth. Navigation is usability; RLS remains authorization. |
| Existing repository composition | **Decided: unsafe as-is** | Fields, Grain, Notifications, Programs, and Equipment/Tasks reads can replay queued writes; Equipment/Tasks also generates due tasks. Dedicated pure snapshot methods are required. [Evidence](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:44>) |
| Weather on Today | **Deferred and excluded initially** | No canonical farm weather location; cache keys omit account/farm/field scope; the handoff still lists weather/spray alerts out of scope. [Cache evidence](</C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/weatherService.ts:26>) |
| Quick Record list | **Decided: Terra’s six** | Rain, field note, scouting note, spray record, harvest entry, task. Add Field belongs in setup; grain sales and inventory receipts carry privacy, money, or ledger risk. |
| First-week checklist | **Decided: three actionable items** | First field, current-year crop assignment, expected yield. Farm/entity creation is already a prerequisite; location, tasks, programs, inventory, price, and private Grain estimates are not universal setup requirements. |
| Basic / More details pilot | **Decided: Equipment Add/Edit machine** | It is genuinely dense but uses one existing write path. Inventory is ledger/compliance-sensitive; Scouting can add photos, location, tasks, and notifications. |
| File budget | **Decided** | Eight files per slice and twenty unique tracked files per commit candidate. Crossing either limit stops the tranche. |
| Visual direction | **Requires Mason decision** | Only Mason may select option `1`, `2`, or `3`. |

## 5. Serialized slices

One writer only; each tranche ends with full review before the next begins.

### Tranche A — access and pure-read foundations

1. **Access profile — Sol High**

   Files: new `src/auth/farmUiAccessProfile.ts`, `farmContext.ts`, `FarmAccessContext.tsx`, new focused regression, `package.json`.

   Proof: owner/manager/worker/financial-worker/read-only/named-rep/disabled-rep/share-off/cross-farm matrix; access epoch unchanged before and after profile loading; account replacement cannot publish stale access.

   Stop if existing helpers cannot distinguish membership from named-rep access, an epoch race remains, or a migration appears necessary.

2. **Operational snapshots — Sol High**

   Files: `fields.ts`, `QueuedFieldsRepository.ts`, `equipmentTasks.ts`, `SupabaseEquipmentTasksRepository.ts`, `QueuedEquipmentTasksRepository.ts`, focused existing regressions.

   Proof: pure snapshots overlay current queues without replaying them, generating tasks, creating IDs, or writing caches; all returned rows match the captured farm.

   Stop on any mutation request, mixed-farm result, or context-fence escape.

3. **Private and alert snapshots — Sol High**

   Files: `grain.ts`, `SupabaseGrainRepository.ts`, `QueuedGrainRepository.ts`, `notifications.ts`, `QueuedNotificationsRepository.ts`, focused regressions.

   Proof: Grain is never queried without capability; private denial is `forbidden`, never zero; no queue replay, mark-read operation, alert transition, notification creation, or cache write.

   Stop if Grain indirectly calls the mutating Fields read or if operational retention reaches financial data.

### Tranche B — selected Today experience

4. **Today service and checklist — Sol High**

   Files: new `src/data/today.ts`, `data/index.ts`, `workspaceCache.ts`, new Today regression, `package.json`.

   Proof: one outer context fence; independent settled lanes; no combined cache; three canonical checklist signals; pending local setup is labelled separately from server-confirmed completion.

   Stop if an optional failure blanks healthy lanes or stale/private data loses its source and timestamp.

5. **Selected Today UI and routes — Terra Medium**

   Files: new `TodayModule.tsx`, `App.tsx`, `RequireSession.tsx`, `app.css`, foundation E2E spec.

   Proof: all default entry points land on `/today`; explicit deep links survive login; selected visual is matched at desktop and 320/375/390/430px; old-farm content clears immediately during switching.

   Stop on visual drift, horizontal overflow, sub-48px actions, or a remaining accidental `/fields` default.

6. **Quick Record — Terra Medium**

   Files: one launcher/registry component, `TodayModule.tsx`, Field Log, Scouting, Inventory, Harvest, Equipment/Tasks, E2E spec.

   Proof: all six actions reach the correct open form in two taps; opening causes no write; destination forms retain sole ownership of IDs, validation, submit locks, queues, and receipts.

   Stop if a draft is erased, an unauthorized action appears, or the launcher imports a repository.

7. **Basic / More details — Terra Medium**

   Files: new shared disclosure component, `EquipmentTasksModule.tsx`, `app.css`, E2E spec.

   Basic: name, category, make, model, meter, status. More details: year, serial/VIN, purchase date/price, warranty, notes.

   Proof: fields remain mounted; collapsed and expanded saves preserve the existing payload; validation opens hidden errors; offline receipt, focus, keyboard, and accessible naming remain intact.

### Tranche C — access-shaped shell and help

8. **Role-shaped navigation — Sol High**

   Files: new navigation registry, `App.tsx`, access context/profile, Quick Record launcher, access regression, E2E spec.

   Proof: capability matrix, read-only direct routes, offline epoch behavior, mobile More menu, and named-rep compatibility assertions.

   Stop if role comes from metadata/path/email, hidden navigation is treated as authorization, or a named rep is exposed to a membership-dependent module.

9. **Help/account/recovery — Terra Medium**

   Files: Help and Account modules, `App.tsx`, existing Needs Attention and revoked-work components, `app.css`, E2E spec.

   Proof: always reachable after sign-in; no private values in help; quarantined work is never auto-replayed; no invented support address or auth behavior.

   Password reset remains outside this slice until its redirect, email delivery, and account-enumeration contract are separately decided.

## 6. Role/access architecture decision

**No migration.**

The client profile should use the existing database-owned answers:

- `can_edit_farm`
- `can_manage_farm`
- `has_explicit_rep_access`
- `can_read_private_financials`
- The caller’s RLS-filtered membership/own rep grant
- `get_current_farm_access_epochs`

Load only for the already-accessible selected farm. Capture the epoch, load capabilities, read the epoch again, and publish only if user, farm, session, and epoch still match.

Named-rep implications:

- `accessKind = rep`, no invented member role, no write capability.
- Quick Record is hidden.
- Today, Fields, Grain, or Profitability appear only after their rep-read path is proven.
- Equipment/Tasks, Field Log, Scouting, Harvest, and Programs currently expect a membership row and must remain hidden for reps until repaired.

RLS remains the final boundary. Navigation never grants access.

Offline profiles stay bound to project, user, farm, validation time, and server epoch. Missing or mismatched profiles fail closed. Operational access retains the existing seven-day ceiling; private financial caches retain 24 hours. A remote revocation cannot be detected while fully offline, but reconnection must invalidate the profile, reject stale writes, and quarantine affected queued work.

No migration file or live apply is planned or authorized. If the existing-helper approach fails its race or named-rep matrix, stop and return for a new Mason decision.

## 7. Today purity contract

Today must not initiate:

- Queue replay or mutation.
- Due-task/program generation.
- Grain alert transition recording or delivery.
- Notification creation or mark-read.
- Geolocation or weather requests.
- ID creation, checklist persistence, save receipts, or draft creation.
- LocalStorage/IndexedDB writes or a combined Today cache.

It may read existing live data, fenced module caches, and queued overlays through dedicated snapshot methods.

All lanes receive one captured user/farm/generation/token/server-epoch context. Fields is the anchor. Every row is farm-checked; the context is reverified before each result is accepted and before the final model publishes. Any context change discards the entire old result.

Lane behavior:

- Operational stale limit: seven days.
- Financial stale limit: 24 hours.
- Stale data always shows its source/time and cannot claim “current” or “all clear.”
- Permission denial is `forbidden`, not an empty or zero position.
- Unavailable checklist data is unknown, not incomplete.
- Old-farm content disappears while a new farm loads.

The existing app-wide sync coordinator may independently replay already-saved user work after access validation. That process must remain separate from Today and be isolated in mutation-spy proof; Today itself may not invoke it.

## 8. Quick Record product decision boundary

The initial actions are settled:

1. Add rain
2. Add field note
3. New scouting note
4. Log spray
5. Enter harvest
6. Add task

The following remain dependent on visual selection:

- Trigger location and prominence.
- Bottom sheet, panel, or card presentation.
- Action ordering and grouping.
- Labels/icons and how the launcher fits the selected first viewport.
- Whether the selected mock’s weather area must be replaced with a permitted non-weather status.

The launcher remains navigation-only regardless of visual choice.

## 9. Verification and adversarial loop

After each slice:

- Focused regression or mocked browser proof.
- Mutation spy where purity matters.
- `git diff --check`.
- Changed-file and untracked-file reconciliation.
- Preserve failures rather than hiding them behind aggregate scripts.

At each twenty-file checkpoint:

- `npx tsc -b --force`
- `npm run regression`
- `npm run build`
- `npm audit --audit-level=high`
- Foundation verification script
- Focused Playwright desktop and phone flows
- Offline, weak-signal, double-tap, farm-switch, account-replacement, role, private-data, and revoked-access checks

Then freeze writers:

- Fresh-context Sol Extra High receives requirements, diff, and proof only—no implementation rationale—and first tries to disprove the guarantees without fixing.
- Terra independently operates the farmer journeys and checks readability, visual fidelity, two-tap reach, and save/recovery language.
- Luna independently checks scope, changed files, proof quality, accessibility, secret-like material, and artifact consistency.

Every finding needs ID, severity, evidence, disposition, owner, and verifying proof. BLOCKER/P0/P1 must be fixed. P2 requires a fix or explicit Mason acceptance. P3 needs a named owner and regression expectation.

Any fix reruns focused proof. Auth, farm fencing, private data, queues, shared navigation, or snapshot changes also rerun all full gates and receive a fresh Sol delta review.

## 10. Changed-file budget and scope guardrails

- Maximum eight changed tracked files per slice.
- Maximum twenty unique tracked files per commit candidate, including tests and evidence.
- The ninth or twenty-first file is an automatic stop—not an informal exception.
- Declare the file manifest before each writer starts; reconcile it afterward with `git diff --name-only`.
- Any added file must replace or defer another declared file.
- No dependencies, migration, new service, broad stylesheet redesign, module-wide cleanup, or unrelated refactor.
- Generated browser artifacts, temporary evidence, and secrets never enter the change set.
- Each tranche reaches the hard pre-commit barrier before the next tranche starts; no commit is currently authorized.

## 11. Residual decisions/risks

Blockers first:

1. Mason has not selected visual option `1`, `2`, or `3`.
2. If the selected option depends materially on weather, the initial design needs a non-weather substitution or a separate Mason product decision. Weather is presently excluded.
3. Named-rep module compatibility is incomplete; several repositories fail when no membership row exists.
4. The support channel, account-recovery flow, and reset redirect are unspecified. No email address or reset behavior should be invented.
5. Current app startup performs global queue replay and program-due generation. Proof must distinguish those existing background actions from Today service purity.
6. Read-only users still encounter write controls inside some direct module routes; role navigation cannot substitute for route-level UX correction.
7. Weather later requires both a canonical location rule and scoped cache keys such as project/user/farm/field—not coordinates alone.

## 12. Mutation statement

No repository file, Git ref, package, browser, database, service, deployment, or external state was mutated. Only read-only file inspection, searches, and Git status/HEAD checks were performed.

Next action: Mason selects visual option `1`, `2`, or `3`; only then may Slice 1 begin.
