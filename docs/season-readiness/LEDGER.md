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

## SR-007 — Prairie Spray disposable-local runtime packet recorded; immutable acceptance pending

- **Date/time:** 2026-07-21T22:53:07-05:00 (`America/Chicago`)
- **Actor/model/effort:** bounded `gpt-5.6-terra` implementation support. No fresh Sol exact-state review was requested or received in this packet.
- **Worktree/branch:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` / `codex/farmrx-2027-season-ready`
- **Commit or state SHA:** uncommitted local proof state based on `b8ce4bd8667c9e0300a1c8fedbc0be3bae131dc1`; no commit, push, pull request, merge, deployment, or live action was authorized or performed.
- **Parent/base SHA:** `b8ce4bd8667c9e0300a1c8fedbc0be3bae131dc1`; initiative base remains `7e19be18daa3b4d5d6228ad70ee245d2f37ee756`.
- **Authority used:** Mason-approved bounded local Prairie proof closeout only: isolated worktree, disposable local Supabase, generated local credential, local browser, and local documentation. No production/live service, production credential, schema, migration, product/RPC, secret, permission, customer, or outward action was used.
- **Files/systems in scope:** `tests/season/prairie-spray-2027-start.sql`, `tests/season/prairie-spray-2027.verify.sql`, `tests/e2e/season/prairie-spray.spec.ts`, `playwright.prairie-spray.config.ts`, `scripts/verify-prairie-spray-disposable.ps1`, this append-only entry, and the scorecard/matrix. Existing saved Compliance rendering was exercised but not modified.
- **Scenario steps / fixture-manifest hash:** PS at `2027-06-15T14:10:00-05:00`, manager local Auth, manifest blob `8821e601a994761246f609b59926860b58dd69bd`, migration head `20260720233500_startup_due_generation_preflight.sql` blob `b7b56d9b27f87e32c38e7c0e8350a5ecefa7b661`. Fixture values are fictional: EPA `00000-000`, REI `12 hr`, PHI `0 hr`, and maximum rate `0.125 gal/acre`.
- **Expected writes:** real desktop UI created exactly manifest application `27043000-0000-4000-8000-000000000001` and product line `27044000-0000-4000-8000-000000000001`; derived on-hand changed exactly `100.00` to `92.50` gal. A browser-originated replay of the captured same RPC payload returned HTTP `200` and those same IDs; SQL then proved one application row and one product row only.
- **Expected non-writes:** full public-table snapshot fence allowed only the application, application-product, and target derived on-hand fields; all named Program, weather/provider/provenance, Crop RX delivery, task, notification, Grain, scouting, unrelated Inventory, and target-normalized inventory fields remained unchanged. Phone Compliance read generated zero target/unexpected non-read requests and no external HTTP/WebSocket destination.
- **Proof and exit codes:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-prairie-spray-disposable.ps1` exit `0`, marker `PRAIRIE_SPRAY_2027_DISPOSABLE_PASS`, with two Playwright tests passed. `npx tsc -b --force`, `npx tsx src/InventoryModule.compliance.regression.tsx`, `npx tsx src/data/SupabaseInventoryRepository.regression.ts`, `npm run regression`, `npm run build`, and `git diff --check` all exited `0`. `npm audit --audit-level=high` exited `1` for the pre-existing `fast-uri` high-severity advisory; no dependency change was made in this bounded proof slice.
- **Browser/local DB evidence paths:** durable executable evidence is the five PS proof files named above. The phone-sized lane asserted saved application time, pest, applicator, entered license/certification text, manual weather, per-product rate/total, EPA, signal, REI, PHI, maximum label rate, no horizontal overflow, and no write. Generated Playwright failure artifacts from prior failed fixture/assertion attempts were not retained as proof.
- **Review verdict/findings:** runtime initially failed closed on fixture creation because the farm bootstrap trigger required the signed-in owner context, then on a draft-first Inventory receipt transition, and then on the UI's displayed `14:10:00` time format. Each harness/fixture correction retained the contract; the final disposable runtime packet passed. Existing `save_inventory_application_bundle` idempotence is manifest application-ID replay, not a new `repository_write_receipts` row; the source mapping separately identifies an ID-bound shared Spray receipt as a future hardening candidate, so this entry does not claim one was added.
- **External actions actually performed:** none.
- **Remaining risk / next approval:** This is local runtime evidence at an uncommitted state, not an immutable accepted PS proof, release proof, or full-year proof. Promote only after an authorized immutable commit and fresh read-only Sol exact-SHA review. The id-bound shared Spray success receipt remains outside this proof slice and unresolved as a broader trust-hardening candidate.
- **Canonical status:** defer to [`docs/GOAL.md`](../GOAL.md); this entry does not claim `RELEASE CANDIDATE READY` or `COMPLETE`.

## SR-008 — Prairie Spray exact proof commit accepted and scenario closed

- **Date/time:** 2026-07-21T23:14:20-05:00 (`America/Chicago`)
- **Actor/model/effort:** fresh-context read-only `gpt-5.6-sol` adversarial review at `xhigh` effort, following bounded Terra implementation and independent root verification.
- **Worktree/branch:** `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` / `codex/farmrx-2027-season-ready`
- **Exact reviewed commit / parent:** `0753c5165116c6a8f25076dd4b036b9afb570d51` / `b8ce4bd8667c9e0300a1c8fedbc0be3bae131dc1`; reviewer confirmed the branch and worktree were exact and clean.
- **Immutable proof content:** the five Prairie fixture/SQL/browser/runner files plus SR-007 and the scorecard's pre-acceptance state. Manifest blob `8821e601a994761246f609b59926860b58dd69bd`; migration head `20260720233500_startup_due_generation_preflight.sql` blob `b7b56d9b27f87e32c38e7c0e8350a5ecefa7b661`.
- **Execution evidence accepted:** `PRAIRIE_SPRAY_2027_DISPOSABLE_PASS`; two Playwright lanes; exact manager UI save and captured same-payload RPC replay; one resulting manifest application/product; exact saved application and label snapshots; `100.00` to `92.50` gal derived on-hand; full public-table snapshot fence and named non-writes; loopback-only browser network; phone Compliance facts, no prohibited license claim, no overflow, and no writes. Focused regressions, forced TypeScript, full regression including postregression, build, and `git diff --check` passed.
- **Review verdict/findings:** **ACCEPT**, no findings. Sol found the proof fail-closed and scope-complete and found no product, schema, migration, RPC, dependency, secret, live-service, or outward change.
- **Known separate gate:** `npm audit --audit-level=high` still reports the pre-existing transitive `fast-uri@3.1.3` high advisory through `vite-plugin-pwa` → `workbox-build` → `ajv`; this proof changed no dependency or lockfile. The ID-bound shared Spray success receipt remains a separately mapped trust-hardening candidate and was not claimed.
- **External actions actually performed:** none. No push, pull request, merge, deployment, live migration/data, production credential, live service, secret/auth/permission change, customer action, or communication occurred.
- **Canonical status:** PS — Prairie Spray compliance presence and its disposable desktop/phone browser lane are **PROVEN** at exact commit `0753c5165116c6a8f25076dd4b036b9afb570d51`. This does not make current HEAD, Maple July–December, the full-year packet, `RELEASE CANDIDATE READY`, or `COMPLETE` proven.

## SR-009 — Harvest Ridge disposable proof tranche started; runtime not accepted

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Actor/model:** bounded Terra implementation in the isolated Farm Rx worktree; no fresh Sol exact-state acceptance has occurred.
- **Base state:** clean `cc2c410ef3f797ef720bfbc41ba5280c1fc1cc15` on `codex/farmrx-2027-season-ready`.
- **Authority and boundary:** local synthetic fixture, disposable local Supabase, loopback browser and documentation only. No schema/migration/RPC/product change, live data, credentials, deployment, push, or other outward action.
- **Planned proof:** canonical HR-1 through HR-5, plus a minimal manifest extension so the browser must itself create a proof bin, add a manual In movement, and create a contract. Those extension actions remain independent of the canonical bin-out and contract delivery.
- **First execution result:** forced TypeScript and `git diff --check` passed. The first disposable runner reached a new local database and corrected an obsolete `auth.users.phone_change_token_current` fixture column. The second run authenticated but rendered Farm Rx's existing offline/unreachable recovery screen immediately after login, so no Harvest Ridge write was attempted and no browser/database runtime claim is made.
- **Open acceptance work:** diagnose that local browser bootstrap failure, add the required clean-reset reverse November order, same-ID replay/no-duplicate assertions, broad non-write snapshot fence, exact contract association checks, and storage/contracts phone overflow checks. HR remains **STATIC-ACCEPTED**; this entry does not alter the scorecard or claim a product defect.

## SR-010 — Harvest Ridge local harness correction; runtime still not accepted

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Evidence correction:** The first post-login recovery screen was caused by the HR harness globally freezing `Date`, making a real local Auth session appear expired. The runner now uses Prairie-style local Auth health/config checks and the browser clock is limited to Harvest/Grain action and harvest-date-helper stacks.
- **Observed result:** the corrected desktop browser authenticated and saved `27,600.00` Harvest Bottom 160 bushels through `save_crop_harvest_versioned`; the local RPC returned HTTP `200` with the exact manifest crop assignment and harvest fields. This is partial diagnostic evidence only, not a scenario pass.
- **Current stop point:** the browser then hit a proof-selector ambiguity in the new bin form; it has been narrowed, but the remaining canonical/reverse/replay/non-write/phone requirements were not run to completion. The local `operational_integrity_capability_probe` also returned HTTP `400` during the attempted flow and must be classified before any non-write claim.
- **Canonical status:** HR remains **STATIC-ACCEPTED**. No product defect, runtime pass, scorecard promotion, immutable commit, or outward action is claimed.

## SR-011 — Harvest Ridge canonical disposable-local packet; reverse/snapshot acceptance remains open

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Actor/model:** bounded Terra implementation in the isolated Farm Rx worktree. No fresh Sol exact-state review, immutable commit, or scenario acceptance has occurred.
- **Authority and boundary:** synthetic fixture, disposable local Supabase, loopback browser, local test/documentation files only. No product, schema, migration, repository, RPC, live data, production credential, deploy, push, or outward action.
- **Canonical runtime evidence:** `scripts/verify-harvest-ridge-disposable.ps1` exited `0` with `HARVEST_RIDGE_2027_DISPOSABLE_PASS`. Desktop UI recorded 27,600 Harvest Bottom 160 bushels, waited for the exact persisted Grain reconciliation PATCH, created the proof bin and its 2,600-bu corn inbound movement, created the exact 2,600-bu cash contract, recorded an independent 5,000-bu main-bin out movement, and recorded the independent 5,000-bu baseline-contract delivery. Exact SQL proved the stored rows, balances, associations, and no duplicate bin movements/contracts/deliveries.
- **Replay/phone evidence:** browser-originated same-payload replays for the Harvest, append-movement, and delivery RPC contracts returned 2xx with the original IDs; direct-table optimistic-save retry semantics for the bin, contract, and reconciliation remain covered by the focused repository regression rather than a raw duplicate POST. A 390px lane read Grain, Storage, and Contracts after the desktop flow, found no horizontal document overflow, and made zero target mutation requests.
- **Harness correction:** the first Grain reconciliation assertion was racy because it matched the paragraph's Harvest value before the Grain PATCH settled. It now awaits the 2xx `production_estimates` PATCH, checks the full Grain value, and reloads before continuing. A strengthened SQL assertion also caught an ambiguous empty-bin commodity default; the UI proof now explicitly selects `corn_yellow` so stored bin movement and proof contract share the intended commodity.
- **Remaining acceptance work:** the required fresh-reset reverse November order and broad named non-write snapshot fence have not yet run, nor have the full project regression/build/audit command packet or fresh Sol adversarial review. HR is therefore not accepted or scorecard-promoted by this entry.

## SR-012 — Harvest Ridge clean-reset reverse and public-table fence completed; broader acceptance remains pending

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Actor/model:** bounded Terra implementation in the isolated worktree. No immutable commit or fresh Sol exact-state review has occurred.
- **Runtime evidence:** `scripts/verify-harvest-ridge-disposable.ps1` exited `0` with `HARVEST_RIDGE_2027_DISPOSABLE_PASS`. It ran the canonical desktop/phone packet and exact SQL verifier, then performed a new disposable reset, fixture, gateway/Auth-health cycle and ran the reverse November browser lane plus `HARVEST_RIDGE_2027_REVERSE_VERIFY_PASS`.
- **Reverse-order proof:** in the clean reset, browser UI recorded the 5,000-bu delivery first. The main bin remained 30,000 bu with zero movements; only the later, explicit 5,000-bu manual Out changed it to 25,000 bu. SQL proved one exact delivery, one exact movement, no extra delivery/movement, and no hidden coupling.
- **Public-table non-write fence:** before each browser phase the runner took a deterministic public-data dump excluding the explicitly allowed target tables (`crop_assignments`, `production_estimates`, `grain_bins`, `bin_transactions`, `grain_contracts`, `grain_contract_deliveries`, and the one expected harvest operation receipt). It normalized dump nonce and sequence metadata, compared after the SQL target assertions, and passed. The canonical verifier separately proves the single allowed receipt; all other public tables therefore remained byte-stable across each phase.
- **Boundary:** no product/schema/migration/RPC/live/outward action occurred. This is uncommitted local runtime evidence only; full project checks and fresh Sol review remain required before any scorecard promotion or commit.

## SR-013 — Harvest Ridge local verification packet complete; immutable review pending

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Command evidence:** `npx tsc -b --force`, `npx tsx src/data/SupabaseGrainRepository.regression.ts`, the two-reset `scripts/verify-harvest-ridge-disposable.ps1`, `npm run regression`, `npm run build`, `npm run verify:season`, and `git diff --check` all exited `0`. The season contract fixture count was deliberately advanced from 81 to 87 to account for the six stable HR proof identities; its mutation/isolation regressions passed.
- **Audit evidence:** `npm audit --audit-level=high` exited `1` for the pre-existing transitive `fast-uri@3.1.3` high advisory. No package or lockfile change was made, and this entry does not treat that advisory as resolved.
- **Acceptance boundary:** no scorecard promotion, commit, push, PR, deployment, live database/service access, production credential, or outward action occurred. The next required gate is a fresh-context Sol adversarial review of this exact uncommitted state; until then HR is not immutable-accepted.

## SR-014 — Harvest Ridge time-isolated disposable proof complete; fresh Sol review pending

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Evidence correction:** SR-013 did not establish that database-owned timestamps followed each scenario instant. The completed runner now swaps only the disposable local database into an exact frozen-clock copy for each phase, proves the authenticated application and PostgREST routes use that copy, and restores the ordinary local stack after every phase.
- **Canonical runtime:** `scripts/verify-harvest-ridge-disposable.ps1` exited `0` after all 11 browser phases. HR-1 through HR-3 ran at `2027-10-11T22:30:00Z`, `22:40:00Z`, and `22:45:00Z`; proof bin, manual In, and proof contract ran at `2027-11-06T14:50:00Z`, `14:55:00Z`, and `14:58:00Z`; HR-4 and HR-5 ran at `15:00:00Z` and `15:05:00Z`. Exact SQL emitted `HARVEST_RIDGE_2027_VERIFY_PASS` after proving the persisted rows, distinct associations, balances, server-owned timestamps, replay stability, and absence of duplicate target rows.
- **Reverse-order runtime:** a second disposable reset recorded HR-5 at `2027-11-06T15:05:00Z` before HR-4 at `15:00:00Z`. Exact SQL emitted `HARVEST_RIDGE_2027_REVERSE_VERIFY_PASS`: delivery did not change bin inventory, the later explicit Out changed only the intended bin, and neither action created a duplicate or hidden coupled row.
- **Phone/non-write proof:** the 390-by-844 browser lane read Grain, Storage, and Contracts with no document-level horizontal overflow and made zero target mutation requests. Each phase also passed the normalized public-table snapshot fence outside the declared target rows, and the runner emitted `HARVEST_RIDGE_2027_DISPOSABLE_PASS`.
- **Clock recovery and residue:** the explicit retained-journal recovery lane and a clean no-write isolation lane passed before the full run. Final inspection found the exact ordinary database container running and healthy on restart policy `unless-stopped`, no parked clock container, no `farmrx-clock-snapshot` or `farmrx-frozen-clock-swap` images, and no Harvest Ridge recovery journals.
- **Regression/build packet:** the PowerShell 5 Docker-argument regression, abstract swap-adapter regression, concrete Docker-adapter regression, season request-classifier regression, focused offline authorization regressions, `npm run regression`, `npx tsc -b --force`, `npm run build`, `npm run verify:season`, and `git diff --check` all exited `0`. Two test-only clock corrections bind previously wall-clock-sensitive July 15 offline fixtures to their own validation instant; application logic is unchanged.
- **Known separate gate:** `npm audit --audit-level=high` exits `1` for the pre-existing transitive `fast-uri@3.1.3` high advisory. No package or lockfile changed.
- **Acceptance boundary:** no product/schema/migration/repository/RPC change, live data/service/credential access, scorecard promotion, commit, push, PR, deployment, or outward action occurred. This exact uncommitted state still requires the separate fresh Sol adversarial review before acceptance or any optional local commit.

## SR-015 — Harvest Ridge exact-commit acceptance and scorecard closeout

- **Date/time:** 2026-07-22 (`America/Chicago`)
- **Immutable proof commit:** `a39b4cd4cf6a7bb8b03ba7dd1ee4c8dce98a4fec` (`test: prove Harvest Ridge grain truth`), parent `cc2c410ef3f797ef720bfbc41ba5280c1fc1cc15`.
- **Fresh Sol verdict:** **ACCEPT**, no findings. The reviewer confirmed the exact SHA and clean worktree, independently reran the clock/swap/Docker/request-classifier and Harvest/Grain focused regressions, the 87-fixture season contract, forced TypeScript, production build, and `git diff --check`, then cross-checked every runtime claim against the committed harness and SQL evidence.
- **Accepted scenario evidence:** exact governed 2027 database/browser instants; harvest and explicit Grain reconciliation; proof-created bin, inbound movement, and contract; independent 5,000-bu bin Out and contract delivery; exact replay status/body/IDs; clean-reset reverse ordering; exact timestamps, balances, associations, receipt cardinality, and duplicate/non-write fences; 390-by-844 Grain, Storage, and Contracts read-only/no-overflow/zero-mutation proof.
- **Recovery and boundary:** the ordinary disposable database was healthy on the pinned image and `unless-stopped`; no parked container, temporary clock image, or recovery journal remained. No product/schema/migration/repository/RPC/package change, production credential, live service/data, push, PR, deployment, or outward action occurred.
- **Canonical status:** HR — Harvest Ridge Grain truth and its disposable desktop/phone browser lane are **PROVEN** at exact commit `a39b4cd4cf6a7bb8b03ba7dd1ee4c8dce98a4fec`. This does not make current HEAD, Maple July–December continuity, the full-year packet, `RELEASE CANDIDATE READY`, or `COMPLETE` proven.
