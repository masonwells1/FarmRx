# Sol Read-Only Reconnaissance — Orchestrator Report

## 1. Actual model and effort

- Model identity exposed to me: **GPT-5 Codex**
- Reasoning effort: **High**
- This was not a claimed `gpt-5.6-sol` session.

## Executive verdict

The smallest safe architecture is a client-side, read-only `TodayReadService` composed from existing repository interfaces, guarded by one outer account/farm/access-epoch fence. It should return independent operational, alert, weather, and private-financial lanes so one failed module cannot blank the whole screen.

Role-shaped navigation should use a single database-derived access profile based on `farm_memberships` and the existing permission helpers. It must not trust auth metadata, route state, or locally invented roles.

No new domain tables are needed. One narrow read-only database function is recommended to return the effective access profile atomically.

## 2. Files read and commands run

### Files inspected

Authority and design:

- `CLAUDE.md`
- `docs/farm-rx-handoff.md`
- `docs/design/01-brand.md`
- `docs/design/02-experience-principles.md`
- `docs/design/03-components.md`
- `docs/design/04-page-patterns.md`
- `docs/audits/2026-07-16-farmer-simplicity-loop/GOAL-AND-LOOP.md`
- No repository `AGENTS.md` exists.

Shell and routing:

- `src/App.tsx`
- `src/main.tsx`
- `package.json`
- `tests/e2e/foundation-shell.spec.ts`

Authentication and farm access:

- `src/auth/AuthProvider.tsx`
- `src/auth/RequireSession.tsx`
- `src/auth/FarmAccessContext.tsx`
- `src/auth/farmContext.ts`
- `src/auth/farmAccessEpoch.ts`
- `src/auth/bootstrapFarm.ts`
- `src/auth/farmContext.regression.ts`

Repositories, safety, sync, and cache:

- `src/data/index.ts`
- `src/data/fields.ts`
- `src/data/grain.ts`
- `src/data/grainPosition.ts`
- `src/data/profitability.ts`
- `src/data/inventory.ts`
- `src/data/equipmentTasks.ts`
- `src/data/fieldLog.ts`
- `src/data/scouting.ts`
- `src/data/harvest.ts`
- `src/data/programs.ts`
- `src/data/notifications.ts`
- Relevant `Supabase*Repository.ts`, `Supabase*DataGateway.ts`, `Queued*Repository.ts`, and `createSupabase*Services.ts` implementations
- `src/data/workspaceCache.ts`
- `src/data/writeQueue.ts`
- `src/data/syncStatus.ts`
- `src/data/farmOperationContext.ts`
- `src/data/queuedOperationGuard.ts`
- `src/data/queueTransaction.ts`
- `src/data/revokedFarmRecovery.ts`
- `src/data/weatherService.ts`
- `src/data/queuedOperationContext.regression.ts`
- `src/data/revokedFarmRecovery.regression.ts`
- `src/data/roundSevenSweep.regression.ts`

Representative module surfaces:

- `src/FieldsModule.tsx`
- `src/GrainModule.tsx`
- `src/InventoryModule.tsx`
- `src/EquipmentTasksModule.tsx`
- `src/FieldLogModule.tsx`
- `src/ScoutingModule.tsx`
- `src/HarvestModule.tsx`
- `src/ProgramsModule.tsx`
- `src/NotificationsModule.tsx`
- `src/WeatherModule.tsx`

Relevant migrations:

- `0001_module1_fields.sql`
- `0002_module1_rls.sql`
- `0008_employee_privacy.sql`
- `0011_module3_rls.sql`
- `0016_equipment_tasks.sql`
- `0018_field_location.sql`
- `0019_field_log.sql`
- `0020_scouting.sql`
- `0023_reminders.sql`
- `0024_programs.sql`
- `0035_operational_integrity.sql`
- `0040_farm_access_epoch_fencing.sql`
- `0041_unscoped_authenticated_write_fencing.sql`

### Commands run

Read-only commands only:

- `git status --short --branch`
- `git rev-parse HEAD`
- `git diff --stat`
- `git diff --check`
- `rg --files` with scoped path filters
- `rg -n` searches for routes, roles, RLS helpers, repository reads, caches, queue fencing, tests, recovery, and form entry points
- `Get-Content` and `Select-Object` for complete files or relevant bounded sections
- A memory registry search for Farm Rx simplicity terms returned no relevant hits and was not used.

A few initial `rg` wildcard/quoting attempts failed harmlessly under PowerShell; they were repeated with `-g` or simpler patterns.

No build, test, package, browser, Supabase, or network command was run because those could create artifacts or contact external systems.

Repository evidence at close:

- HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`
- Branch: `codex/farmrx-farmer-simplicity`
- Existing untracked path remained: `docs/audits/2026-07-16-farmer-simplicity-loop/`
- No diff was created.

## 3. Current-state architecture map

```text
AuthProvider
  └─ Supabase session restoration/sign-in/sign-out
      └─ RequireSession
          └─ FarmAccessGate
              ├─ Reads RLS-filtered farms
              ├─ Reads per-user/farm access epochs
              ├─ Caches validated farm access for offline use
              ├─ Quarantines revoked-farm queues
              └─ FarmAccessProvider
                  └─ AppLayout
                      ├─ Static desktop/mobile navigation
                      ├─ Global sync/offline notices
                      ├─ Revoked-work recovery
                      └─ Module routes

data/index.ts composition root
  ├─ Fields repository
  ├─ Inventory → Fields
  ├─ Equipment/Tasks → Fields
  ├─ Harvest → Fields
  ├─ Grain → Fields + Profitability
  ├─ Programs
  ├─ Scouting / Field Log / Notifications
  └─ Queued wrappers
      ├─ localStorage queues scoped project:user:farm
      ├─ IndexedDB workspaces scoped project:user:farm:module
      ├─ access-generation/token/server-epoch fences
      └─ global sync-status aggregation

Supabase
  ├─ RLS is the final authorization boundary
  ├─ active member roles: owner/manager/worker/read_only
  ├─ per-member can_view_financials
  ├─ named-rep grant + farm share toggle
  └─ access epochs invalidate stale device state and writes
```

Important current facts:

- Navigation is static, and `/fields` is the current login, wildcard, farm-choice, and farm-switch default. See [App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:87) and [App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:248).
- `FarmAccess` carries farms, selection, validation time, and live/offline source—but no role or financial capability. See [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:10).
- Offline farm access is accepted for up to seven days if its access-epoch fence remains valid.
- Operational caches expire after seven days; financial caches after 24 hours. They are properly scoped and fenced. See [workspaceCache.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/workspaceCache.ts:4).
- Several operational repositories independently query `farm_memberships.role`; this duplicates role discovery and does not work cleanly for named reps without membership rows.
- Grain performs an explicit `can_read_private_financials` check before loading private rows. See [SupabaseGrainDataGateway.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseGrainDataGateway.ts:22).
- Opening Grain is not a pure read: its UI evaluates alert transitions and may write transition state, update rules, or request notification delivery. Today must never reuse `GrainPage` or its refresh function. See [GrainModule.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/GrainModule.tsx:291).
- `EquipmentTasksRepository.getWorkspace()` currently calls `generate_due_service_tasks` before reading. A Today-specific read must suppress that behavior. See [SupabaseEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:38).
- Weather cache keys contain rounded coordinates but are not scoped by account or farm. See [weatherService.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/weatherService.ts:26).

## 4. Recommended Today read model

Create a pure orchestration layer—not another module repository and not a server-precomputed dashboard table.

Recommended contract:

```ts
type TodayLane<T> =
  | { state: "ready"; data: T; cachedAt: string | null }
  | { state: "unavailable"; message: string }
  | { state: "forbidden" };

interface TodayReadModel {
  scope: {
    userId: string;
    farmId: string;
    serverEpoch: number;
    localDate: string;
  };
  access: FarmUiAccessProfile;
  setup: SetupChecklistItem[];
  work: TodayLane<TodayWorkSummary>;
  alerts: TodayLane<TodayAlertSummary>;
  grain: TodayLane<TodayGrainSummary>;
  weather: TodayLane<TodayWeatherSummary>;
}
```

Safe loading rules:

1. Capture one `FarmOperationContext` before any lane starts.
2. Load Fields as the required anchor.
3. Load work, notifications, grain, and weather as independent settled lanes.
4. Verify the original context after every awaited lane and again before publishing.
5. Reject the entire result if account, farm, generation, token, or server epoch changed.
6. Validate every returned farm-scoped row against the captured farm.
7. Never translate permission denial into zero totals.
8. Never call the Grain UI alert evaluator.
9. Never generate identifiers, submit records, mark notifications read, or persist checklist state.
10. Background queue replay remains an app-level durability concern; Today itself creates no write.

Data sources:

- Setup: Fields repository—farm, entity, field, current-year crop assignment, expected yield.
- Work: Equipment/Tasks repository with `generateDerivedTasks: false`, plus Programs for due-pass detail.
- Alerts: Notifications repository, read only.
- Grain: Grain repository only when the trusted profile says private financial reads are allowed.
- Weather: defer the one-line forecast until the cache is farm-scoped or a canonical field/location rule is approved.

Do not create a combined Today cache. Recompute from existing module workspaces so:

- Pending offline writes remain visible through queue overlays.
- Operational data retains the seven-day limit.
- Grain retains the stricter 24-hour limit.
- One stale financial cache cannot inherit the operational retention period.

`WorkspaceCacheNotice` should be expanded from `{module,cachedAt}` to include the exact project/user/farm scope. The present module-only notice map can misattribute freshness after a farm switch.

### Trusted source for role-shaped navigation

Use a new read-only function, proposed as migration `0042_farm_ui_access_profile.sql`:

```text
get_current_farm_ui_access_profiles()
  → farm_id
  → access_epoch
  → access_kind: member | rep
  → member_role: owner | manager | worker | read_only | null
  → can_edit_farm
  → can_manage_farm
  → can_read_private_financials
```

The function should derive its results only from:

- `auth.uid()`
- `farm_memberships`
- `farm_rep_access`
- `farms.share_with_rep`
- Existing `is_active_farm_member`, `can_edit_farm`, `can_manage_farm`, `has_explicit_rep_access`, and `can_read_private_financials` helpers.

It should accept no arbitrary farm ID, return only the caller’s currently accessible farms, use a fixed search path, and be granted only to `authenticated`.

Cache the returned profile inside the existing offline access envelope and bind it to the same server epoch. Role and `can_view_financials` changes already bump the epoch in migration 0040.

Navigation hiding remains usability—not authorization. RLS remains authoritative.

## 5. Required risk assessment

| Risk | Current evidence | Required containment |
|---|---|---|
| Cross-farm/user leakage | Repository caches and queues are strongly scoped, but a new aggregator could combine late results from different selections. | One outer context fence; verify after each await; key Today by user/farm/generation; discard all late results. |
| Private financial exposure | Grain and Profitability have database-enforced private reads. `FarmAccess` currently lacks that capability. | Gate financial loading with the DB profile and still rely on RLS; separate financial lane/cache; render `forbidden`, never zero; no private values in URLs, notifications, logs, or operational caches. |
| Stale/offline aggregates | Module caches have different retention periods; current cache notices lack farm scope. | Preserve per-lane timestamps; never combine into one long-lived cache; suppress “urgent/current” wording for stale data; fix notice scoping. |
| Duplicated writes | Quick Record could accidentally create another submit path. Grain and Weather page loads already contain side effects. | Launcher only navigates; destination owns UUID, submit lock, queue, validation, and save receipt; Today imports no UI modules and never evaluates alert transitions. |
| Route/default regressions | `/fields` is hard-coded in wildcard, login restoration, login submit, farm selection, and farm switching. | Update every default atomically; preserve explicit deep links and expired-session return paths; add browser coverage for all entry cases. |
| Circular module coupling | Grain already depends on Fields and Profitability; adding module-to-module imports would deepen the graph. | `TodayReadService` imports repository interfaces and pure selectors only; `data/index.ts` wires implementations; existing modules never import Today. |

Additional material risk: the weather cache exposes rounded field coordinates in unscoped localStorage keys and survives normal workspace-cache cleanup. Do not add weather to Today until this is scoped or deliberately accepted.

## 6. Serialized implementation plan

Only one writer should work at a time.

### Slice 0 — Atomic access profile

Bounded scope:

- New `supabase/migrations/0042_farm_ui_access_profile.sql`
- New `src/auth/farmAccessProfile.ts`
- `src/auth/farmContext.ts`
- `src/auth/FarmAccessContext.tsx`
- New `src/auth/farmAccessProfile.regression.ts`
- `src/auth/farmContext.regression.ts`
- `tests/e2e/foundation-shell.spec.ts`
- `package.json` only to register the focused regression

Proof:

- Local transactional SQL matrix: owner, manager, worker, worker financial override, read-only, named rep, disabled rep, share toggle off, cross-farm caller.
- Account replacement during profile loading cannot persist the old profile.
- Offline profile survives only with the matching access epoch.
- Existing farm selection and revocation browser tests remain green.

Stop if:

- The RPC can probe an arbitrary farm.
- Any result is derived from app metadata.
- Role/financial changes fail to invalidate the cached profile.
- Named-rep behavior is ambiguous.

### Slice 1 — Today read model and pure route foundation

Bounded scope:

- New `src/data/today.ts`
- New `src/data/TodayReadService.ts`
- `src/data/index.ts`
- `src/data/equipmentTasks.ts`
- `src/data/SupabaseEquipmentTasksRepository.ts`
- `src/data/QueuedEquipmentTasksRepository.ts`
- `src/data/workspaceCache.ts`
- New `src/data/today.regression.ts`
- Relevant repository regressions and `package.json`

Change `getWorkspace` to accept a read option that suppresses due-task generation when Today loads it. Existing Equipment/Tasks pages retain current default behavior.

Proof:

- `npx tsx src/data/today.regression.ts`
- Financial repository spy is never called when permission is false.
- A failed optional lane does not erase healthy lanes.
- A delayed old-farm lane cannot publish.
- Scope-mismatched rows fail closed.
- An empty-queue Today read sends no mutation request.
- Existing queued overlays are represented once, not duplicated.
- Financial and operational freshness remain distinct.

Stop if:

- Today imports a module component.
- Reading Today creates alerts, tasks, notifications, IDs, or checklist rows.
- A context switch can produce a mixed model.
- Private denial is shown as zero.

### Slice 2 — Today UI and default-route integration

Bounded scope:

- New `src/TodayModule.tsx`
- `src/App.tsx`
- `src/auth/RequireSession.tsx`
- `src/styles/app.css`
- `tests/e2e/foundation-shell.spec.ts`

Proof:

- Login success defaults to `/today`.
- Signed-in `/login` defaults to `/today`.
- Wildcard defaults to `/today`.
- Farm choice and farm switch default to `/today`.
- Explicit deep links still return after login.
- Desktop and 320/375/390/430px phone layouts have no overflow.
- Offline Today loads only appropriately fenced data.
- Permission-denied Grain card is absent or explicitly private.

Stop if:

- Any default remains accidentally tied to `/fields`.
- Old-farm content stays visible during switching.
- Today failure blocks navigation to healthy modules.

### Slice 3 — Quick Record as navigation only

Bounded scope:

- New `src/quickRecord.ts`
- New `src/components/QuickRecordLauncher.tsx`
- `src/TodayModule.tsx`
- Query-driven entry handling in:
  - `src/InventoryModule.tsx`
  - `src/FieldLogModule.tsx`
  - `src/ScoutingModule.tsx`
  - `src/EquipmentTasksModule.tsx`
  - `src/GrainModule.tsx`
- `tests/e2e/foundation-shell.spec.ts`

Recommended first actions: add field, log rain, scouting note, spray record, add task, record grain sale. Financial actions must be capability-filtered.

Proof:

- Today → Quick Record → selected open form is two taps.
- Opening the launcher or form causes no database write.
- One submit creates exactly one repository call/queue entry.
- Double tap cannot create duplicates.
- Offline save shows the existing device-save receipt.

Stop if:

- The launcher imports or calls a repository.
- It creates IDs or duplicates validation.
- A role sees an action it cannot submit.
- Opening a destination erases an existing draft.

### Slice 4 — Derived first-week checklist

Bounded scope:

- `src/data/today.ts`
- `src/data/TodayReadService.ts`
- `src/TodayModule.tsx`
- `src/data/today.regression.ts`
- Focused browser assertions

Initial completion signals should come only from canonical state:

- Farm/entity exists.
- First active field exists.
- Current-year crop assignment exists.
- Expected yield exists for at least one current-year crop.

Proof:

- Completion changes only when canonical module data changes.
- Offline queued Field changes overlay correctly.
- No checklist row or local completion preference is written.
- Missing or unavailable data is not incorrectly shown as incomplete.

Stop if:

- The design requires a second source of truth.
- “Done” can drift from the underlying records.
- A stale lane silently changes completion status.

### Slice 5 — Shared Basic / More details component

Bounded scope:

- New `src/components/ProgressiveDetails.tsx`
- `src/styles/app.css`
- Representative rollout in `src/ScoutingModule.tsx`
- Focused browser proof

Recommended representative split:

- Basic: date, category, observation.
- More details: location, photos, follow-up task.

Proof:

- Collapsed controls remain mounted and enabled.
- Basic and expanded submissions produce the same payload shape.
- Existing values survive close/reopen.
- Keyboard, focus, screen-reader name, and 48px controls pass.
- Offline queue and save-receipt behavior are unchanged.

Stop if:

- Collapsing disables fields and drops them from `FormData`.
- Hidden validation traps the user without opening the section.
- The existing write contract changes.

### Slice 6 — Role-shaped navigation

Bounded scope:

- New `src/navigation.tsx`
- `src/App.tsx`
- `src/quickRecord.ts`
- `src/auth/FarmAccessContext.tsx`
- Access-profile regression and browser role fixtures

Rules:

- Navigation is generated from capabilities, not a duplicated role enum.
- Quick Record requires edit capability.
- Grain/Profitability require private-financial capability.
- Named-rep destinations are exposed only after each destination proves it can render that access kind.
- Direct routes remain RLS-protected even if hidden.

Proof:

- Owner, manager, worker, financial worker, read-only, and named-rep screenshots/assertions.
- Offline cached role matches the fenced epoch.
- Direct URL access cannot bypass RLS.
- Mobile still has five non-overlapping primary targets and a complete More menu.

Stop if:

- Any role is inferred from email, metadata, or pathname.
- Hiding navigation is treated as authorization.
- A named rep is sent to a module that requires a membership row and crashes.
- Read-only users see write shortcuts.

### Slice 7 — Recovery, help, and account paths

Bounded scope:

- New `src/HelpModule.tsx`
- New `src/AccountModule.tsx`
- `src/App.tsx`
- `src/auth/AuthProvider.tsx`
- `src/styles/app.css`
- Focused browser proof

Reuse:

- `SyncNotice`
- `SaveReceipt`
- `NeedsAttentionList`
- `RevokedFarmRecovery`

Do not create another draft store.

Proof:

- Help and account routes are always reachable after sign-in.
- Password-reset response does not reveal whether an email exists.
- Reset email is sent only after an explicit user action.
- Sign-out still clears readable workspace caches.
- Recovery exports never return revoked work to an active queue.
- The configured reset redirect is proven before calling recovery complete.

Stop if:

- Recovery weakens authentication.
- It deletes or auto-replays quarantined work.
- Support content exposes private farm values.
- Reset redirect/email configuration cannot be verified.

### Full gate after all slices

- `npx tsc -b --force`
- `npm run regression`
- `npm run build`
- `npm audit --audit-level=high`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-foundation.ps1`
- Focused Playwright desktop and phone workflows
- Offline, weak-signal, double-tap, account replacement, farm switch, role, financial privacy, and revoked-access checks

## 7. Navigation-only versus new writes/schema

| Idea | Classification |
|---|---|
| Today dashboard | Read-only composition. No domain writes or new table. |
| Quick Record | Navigation-only. Existing destination performs the only write. |
| Setup checklist | Derived read-only state. No checklist persistence or schema. |
| Basic / More details | UI state only. Existing form submit remains unchanged. |
| Role-shaped navigation | Read-only, but the recommended atomic access-profile function is a new database function migration. No table or data migration. |
| Help/support page | Navigation/content only. |
| Password reset | Explicit Supabase Auth side effect after user action; no application-table schema. |
| Draft confidence | Reuse existing queue, receipt, attention, and recovery systems. No new writes. |
| Persisted checklist dismissal/order | Not recommended initially; would require preference storage. |
| Canonical “home weather location” | Would require a product rule and possibly a farm-setting column. Defer. |
| Server-precomputed Today aggregate | Not recommended initially; would require a new view/RPC and duplicate business logic. |

## 8. Residual questions and risks

1. The exact initial Quick Record action list is not approved.
2. The product-level role/module matrix is incomplete, especially named-rep access.
3. Several modules query membership role directly even though RLS permits named-rep reads. Those destinations need compatibility proof before role navigation exposes them.
4. Fields and Inventory do not consistently hide write controls for read-only users; RLS prevents the write, but the UX would be misleading.
5. Today’s grain scope needs a decision: whole farm only, selected entity, or per-commodity cards.
6. There is no canonical farm/home weather location. Selecting the alphabetically first field would be arbitrary and potentially misleading.
7. Weather localStorage keys expose rounded coordinates and are not cleared with farm workspace caches.
8. Checklist crop-year authority must use the existing farm-local date helper, not UTC or an independently chosen year.
9. Help channel, support address, and password-reset redirect URL are not specified.
10. Today needs clear wording for mixed freshness—for example, live tasks with a 12-hour-old grain cache.
11. Current cache notices are module-only and can be stale across farm switches until made scope-aware.
12. `EquipmentTasksRepository.getWorkspace()` must gain a no-generation read mode before Today consumes it.

## 9. Mutation statement

No filesystem file, Git ref, service, database, browser state, or external system was mutated. The pre-existing untracked simplicity-loop folder remained unchanged, and the worktree ended with the same status observed at the start.
