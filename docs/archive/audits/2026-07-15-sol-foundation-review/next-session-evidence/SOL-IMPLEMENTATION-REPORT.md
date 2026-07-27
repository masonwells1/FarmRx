## Reconnaissance verdict

Gate 2 is not ready for a non-production apply, and Gate 3 is blocked. The most serious defect is that service-role authorization checks use a legacy PostgREST JWT setting that current PostgREST no longer supplies in that form. The local disposable tests manually create that legacy setting, masking the deployment failure.

No repository files or external services were changed.

### 1. Actual model and effort

- Runtime identity exposed to this worker: GPT-5-based Codex.
- Requested identity: `gpt-5.6-sol`.
- The runtime did not expose a verifiable model identifier or reasoning-effort setting, so I cannot honestly claim `gpt-5.6-sol` or a configured “High” setting.
- Audit depth performed: high-effort, adversarial static reconnaissance.

Branch/head verified locally:

- Branch: `codex/farmrx-release-gate-proof`
- HEAD: `49614e75140fdf4dee94d916e32b386bef922f1a`
- Parent: `3edab12aa67bc0075d47249074d5b32517911f3b`

## 2. Dependency and attack map

### Gate 2 — migrations 0036–0037

```text
Authenticated browser
  -> Supabase Data API / PostgREST
  -> save_field_bundle_versioned / save_crop_harvest_versioned
     -> auth.uid() + can_edit_farm()
     -> operation-ID advisory lock
     -> repository_write_receipts replay check
     -> field-level advisory lock
     -> field/arrangement/complete crop-set version comparison
     -> legacy save_field_bundle / save_crop_harvest
     -> RLS-protected farm tables
```

Important controls:

- Both versioned functions require a real caller and editable farm membership: [0036:16](/C:/FarmRx/supabase/migrations/0036_optimistic_concurrency.sql:16), [0036:108](/C:/FarmRx/supabase/migrations/0036_optimistic_concurrency.sql:108).
- Existing field, active arrangement, and complete crop-child set are compared before saving: [0036:47](/C:/FarmRx/supabase/migrations/0036_optimistic_concurrency.sql:47).
- Legacy authenticated RPC access is revoked and versioned RPC access granted: [0036:144](/C:/FarmRx/supabase/migrations/0036_optimistic_concurrency.sql:144).
- Client gateways call only the new RPCs: [SupabaseFieldsDataGateway.ts:36](/C:/FarmRx/src/data/SupabaseFieldsDataGateway.ts:36), [SupabaseHarvestDataGateway.ts:14](/C:/FarmRx/src/data/SupabaseHarvestDataGateway.ts:14).

Highest-risk attacks: wrong farm, stranger/read-only role, stale editor, added/deleted child rows, legacy RPC bypass, lost-response replay, operation-ID reuse, malformed versions, and PostgREST privilege drift.

### Gate 3 — scheduler/Edge/push

```text
GitHub 15-minute schedule
  -> Edge gateway JWT check
  -> x-scheduler-key check
  -> scheduled-alert-sweep
     -> service-role RPC run_scheduled_alert_sweep
        -> every farm
        -> Program due generator
        -> marketing rules
        -> notifications
        -> notification trigger
        -> push_deliveries
     -> service-role Data API SELECT fields
     -> Open-Meteo per field
     -> record_scheduled_spray_window RPC
     -> send-push Edge Function
        -> claim_push_deliveries RPC
        -> notification + subscriptions
        -> Web Push provider
        -> finish_push_delivery RPC
```

The service-role JWT check is on every critical database leg. Direct service-role table grants are also required for the `.from(...)` calls.

## 3. Findings

### P0 — Current PostgREST likely rejects every server-owned RPC

The functions check only:

```sql
current_setting('request.jwt.claim.role', true) = 'service_role'
```

Evidence:

- Scheduler sweep: [0037:49](/C:/FarmRx/supabase/migrations/0037_scheduled_alert_foundation.sql:49)
- Spray recorder: [0037:106](/C:/FarmRx/supabase/migrations/0037_scheduled_alert_foundation.sql:106)
- Push claim/finish: [0035:47](/C:/FarmRx/supabase/migrations/0035_operational_integrity.sql:47), [0035:64](/C:/FarmRx/supabase/migrations/0035_operational_integrity.sql:64)
- Program generator repeats the same convention: [0035:85](/C:/FarmRx/supabase/migrations/0035_operational_integrity.sql:85)

Current PostgREST stores JWT claims as JSON in `request.jwt.claims`; the legacy per-claim convention was superseded for PostgreSQL 14+. [Supabase’s migration notice](https://supabase.com/changelog/19695-platform-updates-30-nov-2021), [PostgREST 14 transaction context](https://docs.postgrest.org/en/stable/references/transactions.html).

The local proof manually sets the obsolete setting, creating false confidence: [verify-0037-disposable.ps1:65](/C:/FarmRx/scripts/verify-0037-disposable.ps1:65).

Expected deployed failure: `server scheduler only` or `server delivery only`, even when called with the real service role.

### P1 — Required fixed-clock and failure-injection Edge proof is not executable

The roadmap requires two deployed invocations at a fixed time plus injected weather and push failures: [REPAIR-ROADMAP.md:22](/C:/FarmRx/docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md:22).

The Edge Function:

- Ignores the request body.
- Always sends `new Date().toISOString()` to the database: [scheduled-alert-sweep/index.ts:16](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:16).
- Hardcodes the Open-Meteo endpoint: [index.ts:24](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:24).
- Hardcodes the nested `send-push` endpoint: [index.ts:33](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:33).

There is no safe test-clock or provider-failure seam. The mandatory Gate 3 proof cannot currently be reproduced through the deployed Edge path.

### P1 conditional — Service-role Data API table access may be denied

Farm Rx was created July 11, 2026: [GOAL.md:34](/C:/FarmRx/docs/GOAL.md:34). Supabase began making explicit table/function grants the default for new projects after May 30, 2026. [Supabase breaking-change notice](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

The migrations explicitly grant application tables to `authenticated`, but repository search found no table grants to `service_role`; for example [0002:153](/C:/FarmRx/supabase/migrations/0002_module1_rls.sql:153). Nevertheless, Edge code directly queries:

- `fields`: [scheduled-alert-sweep/index.ts:18](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:18)
- `push_deliveries`, `notifications`, `push_subscriptions`: [send-push/index.ts:29](/C:/FarmRx/supabase/functions/send-push/index.ts:29)
- Membership, farm, marketing, bid and production tables throughout `deliver-grain-alert`.

RLS bypass does not replace object privileges. Grants determine whether the Data API can reach an object; RLS applies afterward. [Supabase API security documentation](https://supabase.com/docs/guides/api/securing-your-api).

This remains conditional because the production default-privilege setting and live ACLs were not accessible.

### P1 — Partial multi-device push failure causes duplicate notifications

`push_deliveries` stores one delivery row per notification: [0035:7](/C:/FarmRx/supabase/migrations/0035_operational_integrity.sql:7). `send-push` then sends sequentially to every subscription inside a single try/catch: [send-push/index.ts:41](/C:/FarmRx/supabase/functions/send-push/index.ts:41).

Attack:

1. Device A receives the push.
2. Device B returns a transient provider error.
3. The whole delivery row becomes `failed`.
4. After backoff, the row is reclaimed.
5. Device A receives the same push again.

The current proof counts database delivery rows, not provider sends: [verify-0037-disposable.ps1:69](/C:/FarmRx/scripts/verify-0037-disposable.ps1:69). This violates Gate 3’s exactly-once user-visible requirement.

### P1 — Stale or malformed weather can generate a false “good to spray” alert

The scheduler trusts the provider’s local timestamp and does not compare it with current time:

- Fetch and conversion: [scheduled-alert-sweep/index.ts:23](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:23)
- Local-date validation only checks string shape: [scheduledAlertLogic.ts:14](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.ts:14)
- A missing/misaligned hourly precipitation probability becomes `null`, which the evaluator treats as acceptable: [scheduledAlertLogic.ts:10](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.ts:10)
- There is no minimum temperature or upcoming-rain window.
- The database accepts any supplied local date and observation time from service role: [0037:106](/C:/FarmRx/supabase/migrations/0037_scheduled_alert_foundation.sql:106).

The regression covers wind, heat, current rain and weather code, but not stale/future observations, extreme cold, hourly-array mismatch, or rain beginning shortly afterward: [scheduledAlertLogic.regression.ts:4](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.regression.ts:4).

### P2 — `SECURITY DEFINER` hardening is below current Supabase guidance

The new functions are `SECURITY DEFINER` in the exposed `public` schema and use `search_path = public, pg_temp`: [0036:12](/C:/FarmRx/supabase/migrations/0036_optimistic_concurrency.sql:12), [0037:28](/C:/FarmRx/supabase/migrations/0037_scheduled_alert_foundation.sql:28).

Explicit grants and internal identity checks substantially reduce exposure, but current guidance recommends invoker by default, an empty search path for definers, and keeping internal definers outside exposed schemas. [Supabase database-functions guidance](https://supabase.com/docs/guides/database/functions?example-view=sql&language=sql&queryGroups=example-view&queryGroups=language).

No immediate exploit is proven without live `public` schema CREATE privileges, owner identities and advisor output.

### P2 — One database error aborts alerts for every farm

`run_scheduled_alert_sweep` processes all farms inside one transaction with no per-farm exception boundary: [0037:51](/C:/FarmRx/supabase/migrations/0037_scheduled_alert_foundation.sql:51). One Program/marketing error rolls back every farm and returns a generic 503 from Edge.

Weather errors are isolated per field, but database evaluation errors are global. The disposable proof uses only one farm.

### P2 — Scheduler authentication depends on legacy API-key behavior

The workflow puts the anon key in both `Authorization: Bearer` and `apikey`: [scheduled-alert-sweep.yml:24](/C:/FarmRx/.github/workflows/scheduled-alert-sweep.yml:24). There is no checked-in `supabase/config.toml`, so JWT verification defaults to enabled.

This works only while the secret is a legacy JWT-style anon key. New `sb_publishable_...` and `sb_secret_...` keys are not JWTs and must go in `apikey`, not Bearer authorization. [Supabase authorization-header documentation](https://supabase.com/docs/guides/functions/auth-headers).

### P3 — Minor residual surfaces

- `valid_time_zone(text)` is created in `public` without an explicit EXECUTE revoke: [0037:7](/C:/FarmRx/supabase/migrations/0037_scheduled_alert_foundation.sql:7). It is low-impact but unnecessary API surface under permissive function defaults.
- Receipt replay checks user identity but not a request fingerprint. Same-user reuse of an operation ID with a different payload returns the first result: [0036:31](/C:/FarmRx/supabase/migrations/0036_optimistic_concurrency.sql:31). UUID collision is improbable, but a queue defect would be silently masked.
- The 0036 grant proof checks authenticated legacy denial but not a full anon/PUBLIC/service-role PostgREST matrix: [verify-0036-disposable.ps1:50](/C:/FarmRx/scripts/verify-0036-disposable.ps1:50).

## 4. Recommended executable proof slices

Authority classes:

- `R0`: local or production metadata read-only.
- `D1`: disposable local database mutation only.
- `N1`: named non-production database mutation.
- `N2`: named non-production Edge/workflow/provider mutation.
- `P1`: production migration/deploy/configuration; separately authorized and forbidden in this run.

| Slice | Authority | Proof | Stop/rollback |
|---|---|---|---|
| Live ACL/catalog inventory | R0 | Read only `pg_proc`, `proacl`, `information_schema.routine_privileges`, `table_privileges`, `pg_policies`, `relrowsecurity`, default privileges, migration high-water and Edge configuration. No business rows. | Stop on project-ref mismatch or any non-SELECT operation. No rollback. |
| Fresh-default migration rehearsal | D1 | Revoke automatic table/function grants before applying 0001–0037, matching a post-May-30 project. Confirm every client and service-role dependency has explicit privileges. | Destroy disposable container/database. |
| Real PostgREST claim test | N1 | Call service RPCs with a real service credential and current `request.jwt.claims`; verify service succeeds while anon/authenticated fail. Do not rely on manually setting `request.jwt.claim.role`. | Stop immediately on legacy-GUC rejection. Recreate non-production DB if needed. |
| 0036 role/session attack | N1 | Through PostgREST: owner/manager/worker success as intended; read-only/rep/stranger/wrong-farm denial; legacy RPC denial; stale field/harvest; added/deleted child; lost-response replay; malformed versions. | Stop on any unauthorized success or stale overwrite. Restore test snapshot/recreate environment. |
| Edge fixed-clock proof | N2 | First add a non-production-only clock seam or equivalent controlled deployment. Invoke twice at one fixed time and verify one notification and one delivery row. | Stop if the deployed function can target production or accepts test controls in production mode. Redeploy prior test function. |
| Weather adversarial proof | N2 | Inject stale/future time, missing hourly alignment, extreme cold, imminent rain, malformed 200 response, timeout and rate limit. Other fields must continue; uncertainty must never produce “good.” | Stop on the first false positive. Disable scheduler and restore prior test function. |
| Multi-device push partial failure | N2 | Two subscriptions: make device A succeed and B transiently fail, then retry. Assert A receives exactly once and B remains retryable. | Stop on duplicate delivery. Disable sweep; restore provider test setup/function version. |
| Workflow auth compatibility | N2 | Prove the configured credential type, explicit `verify_jwt` behavior, custom scheduler-secret rejection, and no key/value leakage in logs. | Stop on 401, permissive unauthenticated access, or secret output. Remove test secrets and disable workflow. |
| Production rollout | P1 | Only after all above are green: metadata recheck, reviewed migration order, prior Edge versions captured, scheduler disabled until post-migration smoke completes. | Stop on drift or any unresolved P0/P1. Database rollback should be a reviewed forward correction, not blind down-migration. |

## 5. Files read

Detailed reads included:

- `CLAUDE.md`
- `docs/farm-rx-handoff.md`
- `docs/GOAL.md`
- `docs/build-notes/task-foundation-design.md`
- `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`
- `REPAIR-ROADMAP.md`
- `FINDINGS.md`
- `FOUNDATION-VERDICT.md`
- `TEST-AND-PROOF-GAPS.md`
- `WORKFLOW-COVERAGE-MATRIX.md`
- Migrations `0002`, relevant portions of `0009`, `0014`, `0022`, `0023`, `0027`, `0035`, and all of `0036–0037`; all migration files were dependency-searched.
- `scheduled-alert-sweep`, `scheduledAlertLogic`, its regression, `send-push`, `deliver-grain-alert`
- `.github/workflows/scheduled-alert-sweep.yml`
- 0036/0037 disposable proof scripts
- Fields/Harvest gateways and repositories
- Weather evaluator/service code
- Supabase skill instructions and security/RLS references
- Current official Supabase changelog, Data API, function-security, Edge-auth and scheduling documentation.

`C:\FarmRx\AGENTS.md` was attempted but does not exist.

## 6. Commands/tool calls and exact failures

Successful actions were limited to read-only `Get-Content`, `rg`, `git status/rev-parse/show/diff`, directory inventory, and official-document web searches/opens.

Exact failures:

- `Get-Content -Raw 'AGENTS.md'`

  `Cannot find path 'C:\FarmRx\AGENTS.md' because it does not exist.`

- `gh pr view 1 --json number,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup,url`

  `failed to read configuration: open C:\Users\mason\AppData\Roaming\GitHub CLI\config.yml: Access is denied.`

- Initial Windows glob:

  `rg ... supabase/migrations/*.sql`

  `The filename, directory name, or volume label syntax is incorrect. (os error 123)`

  Repeated successfully using `-g '*.sql' supabase/migrations`.

- `supabase --version` and `supabase db query --help`

  `Program 'supabase.exe' failed to run ... 'C:\WINDOWS\system32\supabase.exe' ... Access is denied.`

- Initial direct official-document opens:

  - `https://supabase.com/changelog.md`: `URL ... is not safe to open`
  - Several `.md` documentation URLs: `Failed to fetch ... (400) OK`

  Official search results and normal HTML documentation pages then opened successfully.

- One web-call wrapper failed before execution:

  `SyntaxError: Unexpected string`

  The corrected call succeeded.

- Git repeatedly warned:

  `warning: unable to access 'C:\Users\mason/.config/git/ignore': Permission denied`

No tests that create containers/databases were run because this worker was restricted to reconnaissance.

## 7. Residual risks

- Production migration high-water, live ACLs, RLS policies, default privileges, RPC definitions, Edge versions/configuration, advisors and logs were not independently verified.
- PR #1 remote state/checks could not be refreshed because GitHub CLI configuration was inaccessible.
- No deployed PostgREST, Edge, weather, email or push path was invoked.
- The exact production Data API auto-exposure setting remains unknown.
- Scheduler scale, GitHub default-branch schedule behavior and provider rate limits remain runtime concerns.
- Existing local audit/evidence files were searched for references but were not treated as independent proof.

## 8. Mutation statement

- Files changed by this worker: **none**
- External mutations: **none**
- Functions invoked: **none**
- User/business data queried: **none**
- Branches created/switched: **none**
- Migrations applied: **none**
- Deployments/settings/secrets changed: **none**
- Claude/Fable calls: **none**

The final Git state remained at `49614e75140fdf4dee94d916e32b386bef922f1a`. Pre-existing untracked items remained:

- `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`
- `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/`

---

## 9. Serialized repair: modern PostgREST service-role claims

### 9.1 Outcome and scope

The source repair is implemented locally as a forward migration after `0037`. No historical migration was edited. No database, Supabase project, deployment, secret, setting, notification provider, or other external service was queried or mutated during this repair.

The exact files changed in this slice are:

- `supabase/migrations/0038_modern_postgrest_service_role_claims.sql` — new forward migration.
- `scripts/verify-0035-disposable.ps1` — PostgreSQL 17, modern `auth.uid()` fixture, Program/push claim matrix, conflicting-claim proof, legacy fallback proof, malformed-JSON fail-closed proof, and grant checks.
- `scripts/verify-0037-disposable.ps1` — PostgreSQL 17, explicit before-0038 rejection proof, then 0038 apply, grant matrix, authenticated/anon denial, scheduled sweep, Program generation through the sweep, and spray-transition proof.
- `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/SOL-IMPLEMENTATION-REPORT.md` — this retained reconnaissance report plus the serialized repair record.

Pre-existing untracked audit artifacts were preserved. Nothing was staged, committed, pushed, deployed, or applied to a service.

### 9.2 Actual model and effort visible to this worker

- Requested by Mason: `gpt-5.6-sol`, High effort.
- Runtime identity actually exposed in this session: Codex based on GPT-5.
- The runtime did not expose a verifiable leaf model identifier or a reasoning-effort selector, so this report cannot honestly attest that the underlying identifier was exactly `gpt-5.6-sol` or that the UI/runtime recorded “High.”
- No Claude, Fable, subagent, or other model was called.

### 9.3 Current contract refreshed

The current [PostgREST 14 transaction-context documentation](https://docs.postgrest.org/en/stable/references/transactions.html#request-headers-cookies-and-jwt-claims) states that JWT claims are stored as JSON in `request.jwt.claims`, with individual values read through JSON operators. The Supabase changelog was refreshed and contained no newer breaking change that restores the legacy per-claim GUC. The older [Supabase PostgreSQL 14 migration notice](https://supabase.com/changelog/19695-platform-updates-30-nov-2021) remains the directly relevant compatibility notice.

The repair deliberately gives a present, non-empty modern JSON setting precedence over the legacy setting. That differs from a simple legacy-first `coalesce`: `{"role":"authenticated"}` plus legacy `service_role` must remain authenticated and be denied. If modern claims are absent/empty, the legacy `request.jwt.claim.role` remains a compatibility fallback. Malformed modern JSON fails closed and does not fall back.

### 9.4 Before state

Source evidence before `0038` was exact:

- `claim_push_deliveries`, `finish_push_delivery`, and `generate_due_program_notifications` in `0035` inspected only `request.jwt.claim.role`.
- `run_scheduled_alert_sweep` and `record_scheduled_spray_window` in `0037` inspected only `request.jwt.claim.role`.
- The original disposable proof manually set that legacy setting, masking the PostgREST JSON-only request shape.

`scripts/verify-0037-disposable.ps1` now encodes a focused before-state proof: it applies only migrations below `0038`, sets only `request.jwt.claims = '{"role":"service_role"}'`, leaves the legacy role empty, and requires the existing sweep to fail with exactly `server scheduler only`. Only after that controlled rejection does it apply `0038` and run the after-state matrix.

The required SQL execution could not be captured on this workstation. The initial attempt and the later narrow runs stopped before container creation because no Docker command was available:

```text
docker : The term 'docker' is not recognized as the name of a cmdlet, function, script file, or operable program.
```

The scripts now fail earlier and more clearly with:

```text
Docker CLI is required for the disposable 0035 proof but is not available on PATH.
Docker CLI is required for the disposable 0037 proof but is not available on PATH.
```

Therefore the before-state defect is confirmed by the supplied live catalog/PostgreSQL facts and direct source trace, and the executable regression is present, but this worker did **not** obtain a database-produced before-state failure. Installing or starting database/container infrastructure was outside the authorized repair slice.

### 9.5 Repair design

`0038_modern_postgrest_service_role_claims.sql` adds `public.request_uses_service_role()` and immediately revokes direct execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`. Existing `SECURITY DEFINER` RPCs call it as their owner.

The helper behavior is deterministic:

1. A non-empty `request.jwt.claims` value is parsed as JSON and its `role` is authoritative.
2. Missing role, a non-object JSON value, or malformed JSON returns false.
3. Only an absent/empty modern setting permits the legacy `request.jwt.claim.role` fallback.

The migration uses `CREATE OR REPLACE FUNCTION` for the five affected RPCs. A mechanical comparison reported `UNCHANGED_EXCEPT_AUTH` for all five:

- `claim_push_deliveries`
- `finish_push_delivery`
- `generate_due_program_notifications`
- `run_scheduled_alert_sweep`
- `record_scheduled_spray_window`

No catalog-table update, dynamic function-body rewrite, table privilege change, RLS change, or public grant was used. Existing grants are explicitly reasserted: Program generation remains executable by `authenticated`; push claim/finish, sweep, and spray recording remain executable only by `service_role` among the Data API roles.

### 9.6 After-state proof encoded

The disposable proofs now cover:

- Modern JSON-only `service_role` succeeds for Program generation, push claim, push finish, scheduled sweep, nested Program generation from the sweep, and scheduled spray recording.
- Modern `authenticated` and `anon` claims fail the push claim/finish and scheduler/spray server gates.
- Program generation retains its intended authenticated owner path, while anonymous/no-user calls fail.
- Modern `authenticated` plus conflicting legacy `service_role` cannot elevate push, Program, sweep, or spray calls.
- Modern `service_role` plus conflicting legacy `authenticated` succeeds, proving modern precedence in the opposite direction.
- Malformed modern JSON fails closed.
- Legacy-only `service_role` remains a fallback when the modern setting is absent/empty.
- The internal helper is not directly executable by `anon`, `authenticated`, or `service_role`.
- Existing RPC grant boundaries remain unchanged.
- Scheduled sweep replay and spray false-to-true deduplication remain in the existing behavior proof.

Execution status: **BLOCKED by missing local container/database runtime**, not passed. PowerShell parsing and static body/grant review passed; PostgreSQL execution did not occur.

### 9.7 Commands and results

Commands/actions run in this repair slice:

```text
Get-Content / rg / git status / git rev-parse / git diff
  PASS (read-only inspection; recurring Git global-ignore permission warning noted below)

Official Supabase changelog search/open and PostgREST 14 transaction docs open
  PASS after the direct changelog.md open returned the tool's safe-URL error

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-0037-disposable.ps1
  FIRST ATTEMPT BLOCKED before SQL: docker command not found; cleanup surfaced the same error

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-0035-disposable.ps1
  BLOCKED: Docker CLI is required for the disposable 0035 proof but is not available on PATH.

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-0037-disposable.ps1
  BLOCKED: Docker CLI is required for the disposable 0037 proof but is not available on PATH.

PowerShell AST parse of both disposable scripts
  PASS

Mechanical old/new function-body comparison after normalizing only the authorization predicate
  PASS: all five functions reported UNCHANGED_EXCEPT_AUTH

git diff --check
  PASS

Trailing-whitespace scan for the new untracked migration and retained untracked report
  PASS
```

Other exact failures/warnings:

- `C:\FarmRx\AGENTS.md` does not exist; repository guidance was read from `CLAUDE.md`.
- Direct web open of `https://supabase.com/changelog.md` returned the browsing tool's safe-URL/internal error; official changelog search results and normal pages were then read successfully.
- Git repeatedly warned: `warning: unable to access 'C:\Users\mason/.config/git/ignore': Permission denied`.
- No Docker, Podman, Nerdctl, WSL distribution, local `psql`, or local PostgreSQL executable was found in the available commands/common install paths.

### 9.8 Residual risk and release status

This slice is **source-complete but not database-proof-complete**. Before commit or any database apply, run both disposable scripts on a workstation/CI runner with Docker and PostgreSQL 17 available. They must emit the before-0038 PASS line and their final PASS lines with no SQL errors.

Remaining risks:

- The new migration has not been parsed or executed by PostgreSQL 17 in this session; static review cannot replace that proof.
- No real PostgREST request was invoked, so deployed transaction-setting behavior is supported by current official documentation and the supplied production facts, not a new deployed-path test.
- Production reportedly has only the `0035` server RPCs. Normal ordered migration application would create `0036`, `0037`, then repair them with `0038`; that release sequence was not exercised here and no environment was changed.
- The broader `SECURITY DEFINER` placement/search-path concerns and other Phase 1 findings remain outside this narrow claims repair.

Mutation statement for this repair:

- External mutations: **none**
- Production/non-production queries: **none by this worker**
- Migrations applied: **none**
- Notifications invoked: **none**
- Secrets/settings changed: **none**
- Files staged/committed/pushed: **none**
- Deployments: **none**

---

## 10. Serialized implementation slice: scheduler, weather, and push semantics

### 10.1 Outcome and scope

The smallest forward repair after `0038` is implemented locally. Historical migrations `0035` through `0038` were not rewritten or weakened. Migration `0039_scheduler_weather_push_semantics.sql` adds per-farm scheduler containment and per-subscription delivery targets while retaining the global scheduler advisory lock, notification dedupe keys, and modern `request.jwt.claims` authorization through `public.request_uses_service_role()`.

No Supabase, Vercel, GitHub, email, weather, or push provider was called or mutated. No business rows were queried. No file was staged, committed, pushed, merged, or deployed. No `.env` or secret file was read or edited.

Files changed by this serialized slice:

- `supabase/migrations/0039_scheduler_weather_push_semantics.sql` — forward database repair, target table, per-farm containment, atomic target claim/finish RPCs, RLS, indexes, and ACLs.
- `supabase/functions/_shared/scheduledAlertLogic.ts` — strict provider-envelope parser, explicit thresholds, aligned current-plus-four-hour assessment, and fail-closed spray decision.
- `supabase/functions/_shared/scheduledAlertLogic.regression.ts` — 19 adversarial weather cases.
- `supabase/functions/_shared/scheduledAlertOrchestrator.ts` — injected clock, database adapter, weather provider, push provider, per-field continuation, and honest push-failure propagation.
- `supabase/functions/_shared/scheduledAlertOrchestrator.regression.ts` — fixed-clock replay, per-field timeout/non-OK/malformed continuation, and final push failure proof.
- `supabase/functions/_shared/pushDeliveryLogic.ts` — injected per-target database/provider delivery loop with sanitized retry outcomes and `notification_id` payloads.
- `supabase/functions/_shared/pushDeliveryLogic.regression.ts` — exact device A success/device B transient failure/device B-only retry sequence plus 410 completion.
- `supabase/functions/scheduled-alert-sweep/index.ts` — thin production HTTP entry point and concrete Supabase/Open-Meteo/send-push adapters; no test controls in the HTTP surface.
- `supabase/functions/send-push/index.ts` — RLS-bound caller ownership check plus server-only atomic target RPC use and honest HTTP 503 on retryable provider failures.
- `src/sw.ts` — stable `farm-rx-notification-<notification_id>` notification tag.
- `scripts/verify-0039-disposable.ps1` — PostgreSQL 17 fresh-migration proof for per-farm rollback boundaries, replay, ACLs, atomic claims, partial retry, and gone subscriptions.
- `scripts/verify-foundation.ps1` — runs the new disposable `0039` proof after `0037`.
- `package.json` — includes the three focused pure regressions in `npm run regression`.
- `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/SOL-IMPLEMENTATION-REPORT.md` — this appended evidence.

Pre-existing dirty changes were preserved: `scripts/verify-0035-disposable.ps1`, `scripts/verify-0037-disposable.ps1`, migration `0038`, and the existing untracked audit/evidence files were not overwritten or reverted.

### 10.2 Before and after failure semantics

**Database scheduler**

- Before: all farms ran inside one PL/pgSQL transaction body. Any Program or marketing exception aborted the RPC and rolled back every farm.
- After: the global non-blocking advisory lock still guards the sweep, but each farm runs inside its own PL/pgSQL exception block/subtransaction. A failed farm rolls back only its own writes. The result returns `farm_failure_count`, `failed_farm_ids`, and `processed_farm_count` without returning SQL messages or row contents. Per-farm counters are merged only after that farm succeeds, so rolled-back work is not falsely counted.

**Edge orchestration**

- Before: the deployed handler owned clock, fetch, database calls, parsing, field iteration, and push invocation in one function. Weather errors were counted, but deterministic fixed-clock replay required a deployed test seam. A non-OK final push response failed, while an HTTP-200 body reporting provider failures could be logged as success.
- After: pure orchestration receives the clock, database adapter, weather fetcher, and push sweep as dependencies. The deployed handler supplies only production adapters and accepts no test clock, provider, bypass, or secret override from HTTP. Each field failure contributes a farm/field identity and a non-sensitive error class, then later fields continue. Any thrown push error or push result with `failed > 0` becomes HTTP 503.

**Weather**

- Before: only a current provider object plus one optional precipitation probability was considered. Missing/null probability was treated as acceptable, and there was no freshness, future-date, complete-hourly, alignment, cold, or four-hour safety proof.
- After: qualification requires a finite current point and four finite consecutive hourly points. All arrays must exist and have equal length; current time must align to its containing hourly bucket. Current observations older than 90 minutes or more than 10 minutes in the future fail closed. Every point must be 40-85 F, wind 3-10 mph, gust at most 15 mph, zero precipitation and rain, precipitation probability below 40%, and weather code 0-3. Missing/null/non-finite data, stale/future time, malformed HTTP-200 bodies, array gaps/misalignment, freezing/extreme cold, rain, unsafe wind/gust/heat/code, timeout, and provider non-OK all produce no `p_is_good=true` write. The existing notification still says to follow the product label and applicator judgment.

**Push delivery**

- Before: one `push_deliveries` row represented every device. A transient failure on device B after device A succeeded failed the parent row, and retry looped over both subscriptions again. Caller and sweep paths could also read a delivery then send without one shared per-target atomic claim.
- After: `push_delivery_targets` records status/attempts for the subscription set snapshotted once per notification. `claim_push_delivery_targets` initializes and claims targets under row locks with `FOR UPDATE SKIP LOCKED`; both caller and sweep paths use it. Device A can remain `sent` while B becomes `failed`, then only B is reclaimable after backoff. 404/410 marks the target `gone`, removes that subscription, and does not block parent completion. Payloads include `notification_id`; the service worker uses a stable tag as a final visible dedupe guard. Provider error text is not stored; only a stable status/failure label is persisted.

### 10.3 ACL and security surface

- `public.push_delivery_targets` has RLS enabled and all direct privileges revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- No client policy was added to the target table.
- `claim_push_delivery_targets(uuid,integer)` and `finish_push_delivery_target(uuid,text,text)` are `SECURITY DEFINER`, use fixed `search_path = pg_catalog`, fully qualify application relations, verify `public.request_uses_service_role()`, revoke default/client execution, and grant only `service_role` execution.
- `run_scheduled_alert_sweep(timestamptz)` now also uses `search_path = pg_catalog`; its prior service-only ACL is explicitly reasserted.
- Existing authenticated `push_subscriptions` ownership policies and business contract were not broadened. A caller-triggered send proves notification ownership with the caller's RLS-bound client before the privileged client invokes a server-only RPC.
- No raw provider secret, endpoint, key, SQL error, or provider response body is written to logs or test artifacts.

### 10.4 Proof added

`npm run regression` now includes:

- exact missing/null precipitation, stale, future, malformed 200, missing array, unequal array, time-gap, freezing, extreme-cold, current rain, imminent rain, imminent probability, unsafe wind, gust, heat, weather code, and non-finite cases;
- a complete five-hour good case;
- fixed-clock two-run replay with one spray transition only;
- timeout, provider non-OK, and malformed field failures followed by a successful later field;
- final push failure propagation;
- device A success, device B transient 503, retry skipping A, retrying B, and 410-gone completion;
- assertion that every push payload contains `notification_id`.

`scripts/verify-0039-disposable.ps1` applies all migrations from zero to PostgreSQL 17 and is designed to prove:

- one farm's notification trigger raises inside Program generation while a second farm completes;
- failed-farm count/UUID honesty and farm-local rollback;
- same fixed-clock replay creates no second successful-farm notification;
- target table and function ACLs;
- conflicting legacy `service_role` cannot override modern authenticated claims;
- two devices are atomically claimed once;
- A succeeds, B fails, immediate retry is backed off, only B is reclaimed later, A remains at one attempt, and the parent completes after B succeeds;
- a 410 target removes the subscription and does not block completion.

### 10.5 Commands and exact results

```text
npx tsx supabase/functions/_shared/scheduledAlertLogic.regression.ts
npx tsx supabase/functions/_shared/scheduledAlertOrchestrator.regression.ts
npx tsx supabase/functions/_shared/pushDeliveryLogic.regression.ts
  PASS — weather 19 cases; fixed clock/replay/field isolation/push failure; exact partial device retry and gone target

npm run regression
  PASS — complete existing regression chain plus the three new suites

node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM <six shared source/regression files>
  PASS

node node_modules/typescript/bin/tsc -b --force
  PASS

npm run build
  PASS — application and injectManifest service worker built; existing large-chunk warning only

npm audit --audit-level=high
  PASS — found 0 vulnerabilities

node scripts/foundation-static-guards.mjs
  PASS

node scripts/verify-foundation-mutations.mjs
  PASS — 4/4 controlled mutations turned the gate red

TypeScript transpileModule syntax check of both Edge index files
  PASS

PowerShell AST parse of scripts/verify-0039-disposable.ps1
  PASS

git diff --check
  PASS — line-ending conversion warnings only

Trailing-whitespace scan including untracked repair files
  PASS

Secret-literal scan for service-role, VAPID-private, and scheduler-secret assignments
  PASS

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-0039-disposable.ps1
  BLOCKED before container creation — Docker CLI is required for the disposable 0039 proof but is not available on PATH.

deno --version
  BLOCKED — deno is not recognized on this workstation.
```

The npm/npx commands emitted the existing Windows warning that access to Mason's roaming global npm CLI path was denied, but each command used the available local installation and exited 0. Git emitted the existing global-ignore permission warning during status operations.

### 10.6 Residual risks and release status

This slice is **source-complete and locally regression/build complete, but PostgreSQL-execution blocked on this worker**. The new `0039` script must run to its final `PROBE 0039 scheduler/weather/push semantics: PASS` line on the unrestricted Docker/PostgreSQL 17 runner before commit or release. Deno is unavailable, so the Edge entry files received syntax transpilation and their pure production logic was executed with `tsx`, but no `deno check` or local Edge serve occurred.

Web Push cannot provide mathematical exactly-once delivery across an ambiguous network timeout: a provider may accept a message while the sender loses the response before recording `sent`. That target must remain retryable and may be sent again. Durable target receipts prevent known successful targets from being resent; the stable service-worker tag reduces user-visible duplication, but neither mechanism proves provider-level exactly-once behavior.

The weather limits are intentionally conservative and product-agnostic. They can suppress a genuinely usable window when data is uncertain; they must never replace a product label or applicator judgment. No real provider, device, deployed Edge function, PostgREST request, or live scheduler was exercised in this slice.

Mutation statement:

- External mutations: **none**
- Business/live rows queried: **none**
- Migrations applied: **none**
- Real notifications/provider calls: **none**
- Secrets/settings changed: **none**
- Files staged/committed/pushed/merged: **none**
- Deployments: **none**
