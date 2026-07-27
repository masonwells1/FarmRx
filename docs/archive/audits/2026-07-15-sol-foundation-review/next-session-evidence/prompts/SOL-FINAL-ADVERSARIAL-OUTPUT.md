# Fresh-context Farm Rx release adversarial review

## 1. Actual model and effort

- **Model:** GPT-5 Codex. No Claude, Fable, or sub-agent was called.
- **Reasoning effort:** high, extended adversarial analysis. This runtime did not expose an auditable `extra-high` configuration flag, so I cannot honestly claim that exact label.
- **Verdict:** **RELEASE BLOCKED — 8 unresolved P1 findings and 2 P2 findings.**

## 2. Scope inspected and commands run

The working `HEAD` exactly matched base `49614e75140fdf4dee94d916e32b386bef922f1a`; the candidate consists of uncommitted modified and untracked files.

Inspected:

- Authorized context: [CLAUDE.md](/C:/FarmRx/CLAUDE.md), [farm-rx-handoff.md](/C:/FarmRx/docs/farm-rx-handoff.md), [GOAL.md](/C:/FarmRx/docs/GOAL.md), [REPAIR-ROADMAP.md](/C:/FarmRx/docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md), and [COMMAND-LOG.md](/C:/FarmRx/docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/COMMAND-LOG.md).
- The complete base-to-working-tree diff and all candidate application, auth, storage, service-worker, Edge Function, SQL migration, verification script, test, CSP, package, PWA, and icon files.
- All three PNG icons visually and structurally. Dimensions were 180×180, 192×192, and 512×512; no text/metadata chunks were present.
- The excluded `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` and prohibited Sol/Terra/Luna reports, ledger, implementation report, release results, pre-commit decision, and prompt files were not opened.

Diagnostics:

- `git rev-parse`, `git status --short`, `git diff --name-status`, `git diff --stat`, file-scoped full diffs, `git ls-files --others --exclude-standard`
- `git diff --check` — PASS
- PowerShell syntax parsing of four candidate scripts — PASS
- TypeScript syntax transpilation of 18 candidate TS/TSX files without emitting files — PASS
- Masked secret-like literal scan of candidate text — PASS, zero matches; no value was printed
- PNG IHDR/chunk/hash inspection and visual inspection — PASS
- `rg` trace of legacy and new push claim/finish RPCs
- Direct Node adversarial weather proof — malformed negative/decimal weather qualified as good
- Direct Node push ambiguity proof — a successful provider send followed by a finish failure caused a second provider send
- Docker database verification could not run because `docker` is not installed
- Candidate `tsx` regressions could not run because the read-only sandbox denied creation of tsx’s temporary cache directory
- Final `git status` was unchanged

## 3. Findings

### FRX-FRESH-001 — P1 — Revocation quarantine has no cross-tab generation fence

- **Exact code:** [farmContext.ts:50](/C:/FarmRx/src/auth/farmContext.ts:50), [revokedFarmRecovery.ts:116](/C:/FarmRx/src/data/revokedFarmRecovery.ts:116), [workspaceCache.ts:40](/C:/FarmRx/src/data/workspaceCache.ts:40)
- **Reachable scenario:** Tab A detects that Farm X was revoked, performs its one-time storage scan, deletes the queues/cache, and publishes the new access snapshot. Tab B already captured the old context and completes an in-flight offline save or cache write after that scan. When Farm X is later regranted, it is newly added—not “removed”—so the late queue is never quarantined and can replay automatically.
- **Expected:** Revocation permanently separates all pre-regrant work, including late writes from stale tabs.
- **Actual risk:** There is no durable revocation epoch/tombstone checked by queue writers, replayers, or IndexedDB writers. The E2E test uses one tab and cannot falsify this race.
- **Business impact:** Old field, financial, inventory, or compliance work can unexpectedly apply after access is restored, overwriting newer farm decisions.
- **Proof status:** Static race trace; unresolved. No test covers stale writer versus revocation.
- **Smallest fix direction:** Add a project/user/farm revocation generation persisted before scanning. Every queue/cache write and replay must carry and validate that generation. Bump it on revocation; quarantine older generations on regrant.
- **Verification:** Two-page test that pauses a save after context capture, completes revocation in the other page, resumes the stale write, regrants access, and proves no RPC is made and no readable cache returns.

### FRX-FRESH-002 — P1 — Two incompatible push-delivery state machines remain executable

- **Exact code:** [0038 migration:36](/C:/FarmRx/supabase/migrations/0038_modern_postgrest_service_role_claims.sql:36), [0038 migration:196](/C:/FarmRx/supabase/migrations/0038_modern_postgrest_service_role_claims.sql:196), [0039 migration:157](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:157), [0039 migration:306](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:306)
- **Reachable scenario:** Migration 0039 is applied while the previously deployed `send-push` still uses `claim_push_deliveries` and `finish_push_delivery`. Device A succeeds and device B fails, leaving the parent failed. After the new function deploys, it snapshots both devices and resends A. Conversely, legacy `finish_push_delivery(..., true)` can mark a parent sent while new targets remain unfinished.
- **Expected:** Exactly one authoritative delivery protocol throughout migration and deployment.
- **Actual risk:** 0039 adds target RPCs but leaves the legacy parent-level RPCs granted to `service_role`; `verify-0035` explicitly requires those legacy grants. No regression attacks interaction between the two writers.
- **Business impact:** Duplicate or permanently skipped phone alerts during rollout or from a stale worker.
- **Proof status:** Static-proven dual-writer contract; database reproduction blocked by missing Docker.
- **Smallest fix direction:** Make the legacy RPCs delegate safely to the target state machine or disable them as part of an explicitly scheduler-paused rollout. Do not leave both independently writable.
- **Verification:** Apply 0039, run legacy claim/finish against a two-device delivery, then run target claim/finish and prove no completed device is resent and no unfinished target is hidden by a sent parent.

### FRX-FRESH-003 — P1 — Malformed negative weather values can qualify as a safe spray window

- **Exact code:** [scheduledAlertLogic.ts:48](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.ts:48), [scheduledAlertLogic.ts:121](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.ts:121)
- **Reachable scenario:** An HTTP-200 provider response contains `wind_gusts_10m: -9`, `precipitation_probability: -1`, and fractional `weather_code: 1.5`, with otherwise ordinary values.
- **Expected:** Physically impossible or non-contract values fail closed.
- **Actual risk:** Parsing checks only finiteness. Negative gusts and probabilities pass the upper-bound checks, and fractional weather codes pass `0 <= code <= 3`.
- **Business impact:** A corrupt provider response can produce “good for spraying” advice under untrustworthy conditions.
- **Proof status:** **Runtime-proven:** `NEGATIVE_DECIMAL_WEATHER_QUALIFIED=true`.
- **Smallest fix direction:** Validate complete domains: probability/humidity 0–100, wind/gust ≥0, weather code a supported integer, precipitation/rain ≥0, and reasonable temperature/offset bounds.
- **Verification:** Add negative, fractional, and out-of-range cases for every provider field; each must throw or return non-good.

### FRX-FRESH-004 — P1 — Overlapping sweeps can let an older forecast overwrite a newer one

- **Exact code:** [0039 migration:70](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:70), [scheduled-alert-sweep/index.ts:44](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:44), [0038 migration:173](/C:/FarmRx/supabase/migrations/0038_modern_postgrest_service_role_claims.sql:173)
- **Reachable scenario:** Sweep A completes the database RPC and starts a slow weather request. Sweep B starts after the transaction-level advisory lock is released, obtains a newer unsafe observation, and records it. Sweep A then records an older good observation.
- **Expected:** State changes are monotonic by `observed_at`; an older observation can never change state or fire.
- **Actual risk:** The global advisory lock covers only the database alert RPC, not the weather loop. The per-field function locks writes but unconditionally overwrites state without comparing timestamps.
- **Business impact:** A farmer can receive “spray window is good” after newer conditions have already become unsafe.
- **Proof status:** Static concurrency proof; no ordering regression exists.
- **Smallest fix direction:** Reject/ignore observations whose timestamp is not newer than stored state, and consider a lease covering the full Edge invocation.
- **Verification:** Two concurrent SQL sessions record newer-bad then older-good; assert no alert and that the newer state remains. Repeat in the opposite arrival order.

### FRX-FRESH-005 — P1 — A day whose first observation is good never produces a spray alert

- **Exact code:** [0038 migration:176](/C:/FarmRx/supabase/migrations/0038_modern_postgrest_service_role_claims.sql:176)
- **Reachable scenario:** The first complete forecast of the local day is good and conditions remain good throughout the day.
- **Expected:** The app-closed/dawn scheduler produces one deduped good-window notification.
- **Actual risk:** A missing state row is inserted and immediately returns `fired:false`, regardless of `p_is_good`. Later true-to-true observations also do not fire.
- **Business impact:** The most ordinary “already good at first check” day produces no phone reminder at all.
- **Proof status:** Deterministic static proof. Existing SQL tests initialize with false and therefore miss this case.
- **Smallest fix direction:** Treat the first complete good observation of the local date as eligible for the one-per-day deduped notification, or establish an earlier durable baseline.
- **Verification:** First call with good conditions must create exactly one notification and push row; identical replays must remain one.

### FRX-FRESH-006 — P1 — Exhausted push targets become permanently failed while later sweeps report success

- **Exact code:** [0039 migration:226](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:226), [0039 migration:290](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:290), [send-push/index.ts:46](/C:/FarmRx/supabase/functions/send-push/index.ts:46)
- **Reachable scenario:** A device fails ten provider attempts. Attempt ten returns 503, but every subsequent sweep claims zero targets and returns `{failed:0}`/HTTP 200 while the parent remains failed.
- **Expected:** Terminal failures remain visibly unhealthy until acknowledged, repaired, or dead-lettered.
- **Actual risk:** `attempts < 10` excludes the target, while response counts include only the current claim batch.
- **Business impact:** Monitoring turns green while a customer’s reminder is permanently lost.
- **Proof status:** Static-proven state transition; the disposable test stops before exhaustion.
- **Smallest fix direction:** Return/query terminal-failure counts on every sweep and keep the endpoint unhealthy until an explicit operator action resolves them.
- **Verification:** Fail one target ten times, then run an eleventh sweep and require a non-success health result with `terminal_failed:1`.

### FRX-FRESH-007 — P1 — Sequential weather timeouts can starve every queued push

- **Exact code:** [scheduled-alert-sweep/index.ts:19](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:19), [scheduledAlertOrchestrator.ts:53](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:53), [scheduledAlertOrchestrator.ts:73](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:73)
- **Reachable scenario:** Open-Meteo hangs for many fields. Each field can consume eight seconds sequentially; push delivery is invoked only after the last field.
- **Expected:** One provider outage cannot prevent marketing/program notifications already queued in the database from being pushed.
- **Actual risk:** Runtime grows as `8 seconds × field count`. Under any finite Edge timeout, enough affected fields prevent `runPushSweep` from running at all.
- **Business impact:** A weather outage can indefinitely block unrelated grain, task, and service reminders.
- **Proof status:** Static timing proof. The orchestrator regression uses immediate failures, not actual timeout accumulation.
- **Smallest fix direction:** Use bounded concurrency plus a whole-run deadline, and guarantee the push sweep executes in a finalization path even when weather work exceeds its budget.
- **Verification:** Fake 50 hanging field requests and prove push executes once within the global deadline while all unfinished fields are reported failed.

### FRX-FRESH-008 — P1 — Farm-local and weather failures still produce HTTP 200 “complete”

- **Exact code:** [0039 migration:140](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:140), [scheduledAlertOrchestrator.ts:66](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:66), [scheduled-alert-sweep/index.ts:78](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:78)
- **Reachable scenario:** One farm’s notification trigger fails every run, or all of its weather fields fail parsing. Other farms continue successfully.
- **Expected:** Healthy farms continue and pushes run, but the invocation finishes with a machine-visible partial-failure status.
- **Actual risk:** Counts appear in the JSON body, but the handler logs `scheduled_alert_sweep_complete` and returns HTTP 200 without inspecting `farm_failure_count` or `weatherFailed`.
- **Business impact:** Status-only cron monitoring can miss a persistent one-farm alert outage.
- **Proof status:** Static-proven. `verify-0039` proves containment but does not exercise the HTTP status.
- **Smallest fix direction:** Complete healthy work and the push sweep, then return non-2xx/explicit partial failure and emit an error-level summary when either count is nonzero.
- **Verification:** Force one farm failure and one weather failure; healthy farm rows must commit, push must run, and the HTTP handler must report failure.

### FRX-FRESH-009 — P2 — Service-worker link validation permits a backslash cross-origin navigation

- **Exact code:** [sw.ts:14](/C:/FarmRx/src/sw.ts:14), [sw.ts:30](/C:/FarmRx/src/sw.ts:30)
- **Reachable scenario:** A malformed push contains `link: "/\\evil.example"`.
- **Expected:** Notification clicks remain on the Farm Rx origin.
- **Actual risk:** The string starts with `/` and not `//`, so it passes. URL parsing normalizes the backslash and resolves it to `https://evil.example/`.
- **Business impact:** A malformed or compromised server notification can send a farmer to an external/phishing page.
- **Proof status:** **Runtime-proven:** URL resolution returned `https://evil.example/`.
- **Smallest fix direction:** Resolve against `self.location.origin`, require exact same origin, reject backslashes/control characters, and retain only path/query/hash.
- **Verification:** Service-worker click tests for backslash, encoded separators, absolute URLs, protocol-relative URLs, and valid internal paths.

### FRX-FRESH-010 — P2 — Empty queues are presented as unsent recovery work

- **Exact code:** [revokedFarmRecovery.ts:121](/C:/FarmRx/src/data/revokedFarmRecovery.ts:121), [revokedFarmRecovery.regression.ts:22](/C:/FarmRx/src/data/revokedFarmRecovery.regression.ts:22)
- **Reachable scenario:** Synced modules have persisted `{version:1, entries:[]}` queue envelopes when farm access is removed.
- **Expected:** Only actual unsent or needs-attention records appear.
- **Actual risk:** Every matching queue is copied regardless of entry count. The regression explicitly expects all eleven empty queues to become recovery records.
- **Business impact:** Farmers can see a long, alarming “unsent changes” list when no work exists, weakening trust in the recovery warning.
- **Proof status:** Static-proven and encoded into the current regression expectation.
- **Smallest fix direction:** Skip empty queue and empty needs-attention envelopes; retain only nonempty cleanup partitions.
- **Verification:** Revoke with eleven empty queues and assert no recovery UI; add one real entry and assert exactly one record.

## 4. Proof gaps

- The command log claims PostgreSQL 17 migration probes, regression, build, and 26/26 browser tests passed ([COMMAND-LOG.md:51](/C:/FarmRx/docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/COMMAND-LOG.md:51), [COMMAND-LOG.md:63](/C:/FarmRx/docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/COMMAND-LOG.md:63)). Those are claimed prior results, not independently rerun here.
- Docker was unavailable, so modern JWT behavior, real ACLs, RLS, schema application, concurrent SQL sessions, and migration 0038/0039 interaction were not executed.
- The read-only sandbox blocked tsx’s temporary cache, so the candidate regression executables could not be rerun. Syntax transpilation passed, but that is not a substitute for typecheck/build/runtime.
- No preview deployment was authorized. Actual Vercel rule matching, CDN CSP headers, frame CSP hash behavior, and opaque-frame behavior remain unverified against the revised configuration.
- No live Open-Meteo or Web Push provider call was made.
- No real iOS/Android installation, safe-area, offline reopen, Apple icon, notification replacement, click, storage-quota, or corrupt-storage test was run.
- The restricted reading scope did not permit auditing unchanged queue owners or module permission gates. Completeness beyond the eleven explicitly registered queue families, especially financial-cache handling after role-only downgrades, remains unproven.
- No rollback/deployment-order drill was performed for migrations plus old/new Edge Function versions.

## 5. Residual risks distinct from defects

- Revocation cannot be learned while a device is offline. Current cached farm access remains usable for up to seven days; this is an unavoidable offline-security tradeoff unless the retention window changes.
- Web Push is fundamentally at-least-once around an ambiguous “provider accepted, database finish failed” outcome. The service-worker tag reduces duplicate visible notifications but cannot eliminate a later reappearance after dismissal. The direct proof produced two provider sends.
- Recovery records retain raw unsent payloads in browser storage until dismissed. Device-level encryption and physical access remain outside this candidate.
- Scheduled spray guidance is product-agnostic and cannot replace product-label restrictions, inversion assessment, or applicator judgment.

## 6. External mutations

**None.** No Supabase, Vercel, GitHub, provider, email, push, secret, commit, stage, branch, deployment, migration, or data mutation occurred. Git status remained unchanged, and the excluded untracked file was preserved.
