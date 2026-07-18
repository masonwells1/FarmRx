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
