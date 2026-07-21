# Farm Rx 2027 season-readiness ledger

This file is append-only. Add corrections and later events as new entries; never edit, reorder, or delete an earlier entry. Canonical initiative status meanings live only in [`../GOAL.md`](../GOAL.md).

## SR-000 — Initiative opened and governance tranche authorized

- **Date:** 2026-07-18 (`America/Chicago`)
- **Owner:** Mason Wells
- **Orchestrator:** Sol
- **Worktree:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- **Branch:** `codex/farmrx-2027-season-ready`
- **Base and HEAD at entry start:** `7e19be18daa3b4d5d6228ad70ee245d2f37ee756`
- **Base ref at entry start:** `origin/main`
- **Initial worktree state:** clean; branch based exactly on the SHA above

### Owner direction recorded

- No real farmer use until 2027.
- Earlier rollout timing is superseded; prior commit/merge/deployment/live-verification history remains factual.
- Build from the completed Farmer Simplicity layer and existing Farm Rx modules.
- No new standalone modules, vendors, broad redesigns, speculative features, or proof-only `run_id` schema.
- Missing integrations remain negative assertions/out of scope unless a required scenario exposes a defect in existing behavior.

### Authorized tranche

Documentation/governance only, limited to:

- `docs/GOAL.md`
- `docs/archive/goals/2026-07-11-first-customer-ship.md`
- `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`
- `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`
- `docs/season-readiness/LEDGER.md`
- `AGENTS.md`
- `CLAUDE.md`

Authorized actions: isolated local edits, read-only inspection, local verification, and one local commit named `docs: establish 2027 season-readiness goal`.

Not authorized: touching `C:\FarmRx`; code/schema/package changes; live services; push; pull request; merge; deployment; live migration/data; secret/auth/permission change; customer account or communication; destructive action; or any external mutation.

### Baseline facts and carried gates

- The current first-customer goal is archived verbatim before replacement. Required equality source: `git show origin/main:docs/GOAL.md`.
- Initial tracked goal blob: `9ed0964b3207eba6576052cf0bb567e25e8babd1`.
- Farmer Simplicity (`Today`, `Quick Record`, guided setup/forms, role-shaped navigation, recovery) is the foundation, not a new tranche to redesign.
- Custom SMTP remains unproven/unconfigured for real customer onboarding.
- Two physical-phone customer-zero journeys remain unperformed.
- No 2027 season scenario, disposable proof harness, physical-device proof, or new outward action is claimed by this governance entry.

### Next gate

Verify archive equality, exact allowlist, links/paths, content contract, secret hygiene, and `git diff --check`; create the one authorized local commit; then report the exact SHA and remaining work. Initiative status is evaluated only against `docs/GOAL.md`.

---

## Append-only entry template

Copy this template below the last entry. Do not replace the template or modify a prior entry.

```markdown
## SR-NNN — Short event title

- **Date/time:** YYYY-MM-DDTHH:MM:SS-05:00 or -06:00 (`America/Chicago`)
- **Actor/model/effort:**
- **Worktree/branch:**
- **Commit or state SHA:**
- **Parent/base SHA:**
- **Authority used:**
- **Files/systems in scope:**
- **Scenario steps / fixture-manifest hash:**
- **Expected writes:**
- **Expected non-writes:**
- **Proof and exit codes:**
- **Browser/local DB evidence paths:**
- **Review verdict/findings:**
- **External actions actually performed:** none, or exact Mason-approved action and result
- **Remaining risk / next approval:**
- **Canonical status:** link to docs/GOAL.md; do not redefine it here
```

## SR-001 — Governance adversarial review chain accepted

- **Date/time:** 2026-07-18T15:24:11-05:00 (`America/Chicago`)
- **Actor/model/effort:** Sol orchestrator; fresh-context, read-only `gpt-5.6-sol` reviewers at `xhigh` effort
- **Worktree/branch:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` / `codex/farmrx-2027-season-ready`
- **Commit or state SHA:** `381306e2824619921f8eab1235158c9b482c188b`
- **Parent/base SHA:** governance-chain base `7e19be18daa3b4d5d6228ad70ee245d2f37ee756` (`origin/main` at tranche start); reviewed commit parent `1b7f435b9bc672f027464365e2fb67f783f34c54`
- **Authority used:** Documentation/governance-only local authority from SR-000 and [`../GOAL.md`](../GOAL.md). No push, pull request, merge, deployment, live service, migration/data, secret/auth/permission, customer, communication, or other outward authority was granted.
- **Files/systems in scope:** The exact approved documentation allowlist for each commit in the review chain and this append-only `docs/season-readiness/LEDGER.md` correction. No code, schema, package, backend, browser, live system, external service, or `C:\FarmRx` mutation was in scope.
- **Scenario steps / fixture-manifest hash:** Accepted scenario document and its 81-entry deterministic UUID manifest are pinned by Git blob `1109915956d976c1fd4a8f54ebaa982e4a4667e2` at the accepted SHA. All 81 UUIDs are valid and unique; both Cedar provider-shaped JSON blocks parse.
- **Expected writes:** One append-only SR-001 ledger entry and one local documentation commit.
- **Expected non-writes:** SR-000 and the ledger template remain byte-identical and in their original order. No scenario, goal, runbook, archive, application code, schema, package, backend, browser, live/external system, customer state, or evidence claim changes.
- **Proof and exit codes:** Archive equality passed: `docs/archive/goals/2026-07-11-first-customer-ship.md` and `origin/main:docs/GOAL.md` both have Git blob `9ed0964b3207eba6576052cf0bb567e25e8babd1`. Every review-chain commit matched its exact approved documentation allowlist and passed `git diff --check` (exit `0`). The accepted packet retained 81 valid unique fixture UUIDs, two valid Cedar JSON blocks, working Markdown links, and clean placeholder/secret/route/authority checks. Focused regressions passed: weather service (9 coverage groups), `SupabaseGrainRepository`, and `grainRepair`.
- **Browser/local DB evidence paths:** none. No deterministic season harness, disposable-backend proof, or browser proof exists yet.
- **Review verdict/findings:**
  - `92390fa498ab82d3ce3b21f3190c60cc8ac7c0d5` — **BLOCK:** deterministic placeholders + disposable-backend wording.
  - `aa741a68cca6c4b4291e711c882a6f3abafbdcd3` — **BLOCK:** Cedar manual-copy gap + impossible 3-hour stale cache.
  - `33a7a3eff8cab38d0808fad744d2391a7ca9cde6` — **BLOCK:** nonexistent Quick Record routes.
  - `58976d6afb2155cf7a1c6f643897fef73bd0bf58` — **BLOCK:** Program commodity input, receipt reference, planting-date editor inventions.
  - `1b7f435b9bc672f027464365e2fb67f783f34c54` — **BLOCK:** missing FirstEstimate step before Grain reconciliation.
  - `381306e2824619921f8eab1235158c9b482c188b` — **PASS:** no findings; source-real deterministic governance accepted.
- **Append-only correction to SR-000:** SR-000 named `Today` and `Quick Record`, but exact source has no such UI. Active source truth is direct existing module routes plus guided Fields/forms, role-shaped navigation, and recovery/offline/farm-access hardening, as corrected in [`../GOAL.md`](../GOAL.md) and [`WORKFLOWS-AND-SCENARIOS.md`](WORKFLOWS-AND-SCENARIOS.md). This correction does not rewrite history.
- **External actions actually performed:** none. No live or external action was taken.
- **Remaining risk / next approval:** The governance packet is accepted for beginning the deterministic harness tranche, but no season, backend, or browser proof exists yet. Custom SMTP remains unproven/unconfigured, and the physical iPhone/Safari and Android/Chrome customer-zero journeys remain unperformed. No outward action is authorized by this entry.
- **Canonical status:** defer to [`docs/GOAL.md`](../GOAL.md); no canonical status claim is made here.

## SR-002 — Correct Cedar JSON provenance wording

- **Date/time:** 2026-07-18T15:33:43-05:00 (`America/Chicago`)
- **Actor/model/effort:** Sol orchestrator; fresh-context, read-only `gpt-5.6-sol` reviewer at `xhigh` effort
- **Commit or state SHA:** `a4da8f94c19f9a878e48516904258168cdf1a661`
- **Correction:** SR-001 said `both Cedar provider-shaped JSON blocks parse`; this is inaccurate. Both Cedar JSON blocks parse, but only the fresh-response block is provider-shaped. The stale-path block is the service-normalized `CacheEnvelope`, as specified by the [`Cedar browser seam`](WORKFLOWS-AND-SCENARIOS.md#cedar-browser-seam).
- **Review verdict/findings:** Exact ledger commit `a4da8f94c19f9a878e48516904258168cdf1a661` received **BLOCK** solely for this provenance wording. This corrective commit awaits fresh review.
- **Proof and authority effect:** This append-only correction changes no accepted scenario, fixture UUID, proof result, authority, canonical status, or external action. No backend, browser, or season proof exists yet.
- **External actions actually performed:** none.
- **Canonical status:** defer to [`docs/GOAL.md`](../GOAL.md); no canonical status claim is made here.

## SR-003 — Maple Ridge January tranche accepted

- **Date/time:** 2026-07-20T17:11:44-05:00 (`America/Chicago`)
- **Actor/model/effort:** Sol orchestrator; bounded Terra implementation support; fresh `gpt-5.6-sol` adversarial reviews
- **Worktree/branch:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` / `codex/farmrx-2027-season-ready`
- **Commit or state SHA:** accepted January proof HEAD `0238361192b7fa23d67956f43ffbf74be64c4022`; product-repair range `64c4d03^..9648c60`; harness range `b78fb52..0238361`
- **Parent/base SHA:** accepted HEAD parent `8d205afb9d459299589e0ce09837d2e8b9277008`; initiative base `7e19be18daa3b4d5d6228ad70ee245d2f37ee756`
- **Authority used:** isolated local implementation, disposable local backend/browser verification, local commits, and read-only review. No outward or live authority was used.
- **Files/systems in scope:** existing Fields editor/repositories, the versioned land-arrangement correction migration, focused regressions, disposable local Supabase, Playwright desktop/phone January harness, SQL assertions, and proof scripts. Primary `C:\FarmRx` remained untouched.
- **Scenario steps / fixture-manifest hash:** Maple Ridge January row in [`WORKFLOWS-AND-SCENARIOS.md`](WORKFLOWS-AND-SCENARIOS.md), scenario blob `1109915956d976c1fd4a8f54ebaa982e4a4667e2`; fixture-manifest blob `8821e601a994761246f609b59926860b58dd69bd`; exact runtime instant `2027-01-12T14:00:00.000Z`.
- **Expected writes:** exactly five `save_field_bundle_versioned` browser writes create/update the one manifest field, its owned arrangement, and its 2027 corn crop assignment, including the exact state/location, arrangement start date, crop values, and yield.
- **Expected non-writes:** opening Fields/detail and the phone read produce zero field RPC writes; no later monthly outcome rows appear; Inventory on-hand stays zero; the seeded cash bid remains unchanged.
- **Proof and exit codes:** full regression/postregression/build passed; focused Fields patch and `SupabaseFieldsRepository` regressions passed; TypeScript passed; durable arrangement-history disposable proof passed; local Supabase security advisor reported no issues; final January disposable proof exited `0` with two Playwright tests passed and `MAPLE_2027_JANUARY_DISPOSABLE_PASS`.
- **Browser/local DB evidence paths:** committed deterministic harness `tests/e2e/season/maple-january.spec.ts`, runner `scripts/verify-maple-january-disposable.ps1`, and SQL proof `tests/season/maple-2027-january.verify.sql`. Playwright trace capture is disabled; generated `test-results` were removed after verification.
- **Review verdict/findings:** product range received fresh Sol **PASS** with no actionable findings. Harness `b78fb52` was blocked for retained traces and insufficient clock proof; `8d205af` closed trace leakage but remained blocked because year-only proof could false-green; exact `0238361` received fresh Sol **PASS**, proving at least one runtime `Date` call from `src/data/index.ts` returned only `2027-01-12T14:00:00.000Z` in desktop and phone runs.
- **External actions actually performed:** none. No push, pull request, merge, deployment, live migration/data, secret/auth/permission change, customer action, or communication occurred.
- **Remaining risk / next approval:** January is accepted locally, not the complete season. February through December, the other governed scenarios, physical iPhone/Safari and Android/Chrome journeys, custom SMTP, publication, deployment, and live verification remain unproven or unauthorized.
- **Canonical status:** defer to [`docs/GOAL.md`](../GOAL.md); no canonical status claim is made here.

## SR-004 — Correct January harness range and cash-bid evidence scope

- **Date/time:** 2026-07-20T17:15:00-05:00 (`America/Chicago`)
- **Actor/model/effort:** Sol orchestrator; fresh `gpt-5.6-sol` adversarial ledger review
- **Commit or state SHA:** correction applies to SR-003 ledger commit `8eaa5a4346442cc63fddf1b6c9c1d93aac8f41a6`
- **Correction:** SR-003's inclusive harness range is `b78fb52^..0238361`, not `b78fb52..0238361`. SR-003 also overstates the cash-bid non-write evidence: the accepted SQL proof establishes that exactly one Maple cash-bid row still exists after January, but it does not prove every value in that row remained unchanged. Treat the SR-003 phrase `the seeded cash bid remains unchanged` as replaced by `exactly one seeded Maple cash-bid row still exists`; exact value stability remains unproven until a later proof asserts the row contents or a before/after hash.
- **Proof and authority effect:** The January product/harness Sol PASS, exact field writes, zero opening/phone field writes, absence of later monthly outcomes, zero Inventory on-hand, authority boundaries, and remaining risks are unchanged. This correction narrows evidence; it does not add a product or release claim.
- **External actions actually performed:** none.
- **Canonical status:** defer to [`docs/GOAL.md`](../GOAL.md); no canonical status claim is made here.

## SR-005 — Maple Ridge February–June continuous tranche accepted

- **Date/time:** 2026-07-21T13:17:16-05:00 (`America/Chicago`)
- **Actor/model/effort:** `gpt-5.6-sol` orchestrator and fresh read-only pre-commit/exact-commit reviewers; bounded `gpt-5.6-terra` implementation support. Per-agent reasoning-effort metadata was not exposed to the run, so no effort level is claimed.
- **Worktree/branch:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` / `codex/farmrx-2027-season-ready`
- **Commit or state SHA:** accepted product/proof commit `53e8d2d380907b7bf56da599362ec8254d3ef2a0`
- **Parent/base SHA:** `dc3b3daa33e339dcf917ac55d7e497e6586c7153`; initiative base remains `7e19be18daa3b4d5d6228ad70ee245d2f37ee756`
- **Authority used:** Mason approved bounded local FarmRx hardening repairs and a generated disposable local test credential. The approved work stayed inside the isolated local worktree, disposable local Supabase, local browser, local commits, and read-only review. No push, pull request, merge, deployment, live migration/data, live auth/permission, secret, customer, or communication authority was used.
- **Files/systems in scope:** generated credential lifecycle and local boundary, disposable season runners, February–June Playwright scenarios and SQL assertions, Program/Equipment startup status and receipt-backed v2 generation, strict client parsing, focused regressions, one startup migration, local Supabase, and the farm-access regression clock isolation repair. The primary `C:\FarmRx` checkout remained untouched.
- **Scenario steps / fixture-manifest hash:** controlling workflow blob `1109915956d976c1fd4a8f54ebaa982e4a4667e2`; season-start fixture blob `279ebd3a40557cbc35bc6b9c8231d9ddb9f8dbb4`; startup migration blob `b7b56d9b27f87e32c38e7c0e8350a5ecefa7b661`. The continuous runner reset once at January and preserved the same disposable database through June.
- **Expected writes:** February creates and assigns the exact Maple Program; March receives the exact Maple inventory product; April performs no write; May marks the exact Program pass applied while retaining its draft Inventory record; June saves one exact completed manual application/product and reduces on-hand from 100 to 90 gallons. Startup v2 generators write only when the authenticated edit-capable caller's server-clock status is due and bind idempotent receipts to caller, operation kind, and operation ID.
- **Expected non-writes:** password generation and SQL transport never persist or print a reusable credential; false startup status allocates no operation ID and performs no generator write; April and the phone-sized May/June confirmations perform no target or unexpected writes; February–June block unexpected non-read requests and non-loopback HTTP/WebSocket destinations; monthly SQL snapshots reject changes outside each exact allowance. January retains its separately accepted SR-003/SR-004 proof limits and is not credited with the later general network fence.
- **Proof and exit codes:** `scripts/verify-maple-june-disposable.ps1` exited `0` after `MAPLE_2027_START_DISPOSABLE_PASS` and continuous January, February, March, April, May, and June PASS markers; Playwright counts were January 2, February 1, March 1, April 1, May 2, and June 2. `npm run build`, `npm run regression` including postregression, `scripts/verify-startup-due-generation-disposable.ps1`, `scripts/verify-0043-disposable.ps1`, and `git diff --check` all exited `0`. The clock regression was made state-independent after an isolated failure caused by a real-time high-water value later than its controlled test noon, and then passed alone and in the full suite.
- **Browser/local DB evidence paths:** committed executable evidence is in `scripts/verify-maple-{season-start,january,february,march,april,may,june}-disposable.ps1`, `tests/e2e/season/maple-{january,february,march,april,may,june}.spec.ts`, `tests/season/maple-2027-{start,january,february,march,april,may,june}.verify.sql`, `scripts/verify-startup-due-generation-disposable.ps1`, and migration `supabase/migrations/20260720233500_startup_due_generation_preflight.sql`. Generated logs and Playwright failure artifacts were removed and are not tracked.
- **Review verdict/findings:** the first fresh Sol runtime review returned **BLOCK** because a local database reset recreated Auth while the running gateway retained Auth's former container address, producing `POST /auth/v1/token` HTTP 502. The repair refreshes only the exact disposable gateway and requires a bounded real GoTrue health response before browser launch. A later June run exposed a strict locator ambiguity and then a deterministic ID-hook priority error; both were repaired without weakening the network/write fence. Fresh Sol pre-commit acceptance returned **PASS**. Fresh exact-commit Sol review returned categorical **PASS** for `53e8d2d380907b7bf56da599362ec8254d3ef2a0`, parent `dc3b3daa33e339dcf917ac55d7e497e6586c7153`, with no correctness, security, false-positive proof, secret, credential, or artifact blocker.
- **External actions actually performed:** none. No push, pull request, merge, deployment, live migration/data, live service access, secret/auth/permission change, customer action, or communication occurred.
- **Remaining risk / next approval:** This accepts the local February–June tranche, not the season or release. February–April phone-sized lanes remain unbuilt; July–December, governed scenarios, physical iPhone/Safari and Android/Chrome installed-PWA journeys, custom SMTP, publication, production deployment, live migration/data, and live verification remain unproven or approval-gated. The next bounded local tranche is July receipt hardening and its continuous-season browser/database proof.
- **Canonical status:** defer to [`docs/GOAL.md`](../GOAL.md); this entry does not claim `RELEASE CANDIDATE READY` or `COMPLETE`.

## SR-006 — July–December static hardening checkpoint; runtime not accepted

- **Date:** 2026-07-21 (`America/Chicago`)
- **Actor/model:** Sol orchestration with bounded Terra/Sol implementation and separate read-only Sol review.
- **Worktree/branch:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` / `codex/farmrx-2027-season-ready`
- **Commit or state SHA:** documentation checkpoint begins from `dfc695c77ac6618d82e3b073f6fc2e17ef4867f7`; the accepted continuous runtime boundary remains `53e8d2d380907b7bf56da599362ec8254d3ef2a0` through June.
- **Authority used:** bounded local product/test hardening, local commits, disposable local proof attempts, and read-only review only. No push, pull request, merge, deployment, live migration/data, secret, live auth/permission, customer action, or communication occurred.
- **Static hardening chain:** `170c5e4` hardens Scouting receipt/recovery behavior; `073a1e8` adds the fail-closed July desktop/phone and SQL harness; `555b648` publishes Task quick-action receipts; `5d59096` publishes Harvest receipts; `0344058` adds operation-bound Grain estimate/reconciliation receipts; `7609d3e` adds action-owned bin, movement, contract, and delivery receipts; `dfc695c` strengthens startup production-orchestration regression coverage.
- **Evidence boundary:** repository history and committed file changes establish that these product and focused-test surfaces exist. This entry does not reproduce command output or upgrade any month from an unrecorded run. Earlier working evidence and exact-commit reviews support bounded static acceptance, but the required continuous July–December browser/database packet has not been recorded.
- **Runtime blocker:** the July harness intentionally refuses acceptance while the disposable Postgres clock is the current 2026 date. Browser clock control does not change database `current_date`/`now()`. A governed disposable 2027 database-clock seam is required; row patching, function replacement, weakened constraints, or a fabricated green result do not satisfy the contract.
- **Canonical status:** January–June retain SR-003 through SR-005 runtime proof. July is **RUNTIME-BLOCKED**; August–December product/focused-test hardening is **STATIC-ACCEPTED** only. No July–December month is **PROVEN**, and this entry does not claim `RELEASE CANDIDATE READY` or `COMPLETE`.
- **External actions actually performed:** none.
