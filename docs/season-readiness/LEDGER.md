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
