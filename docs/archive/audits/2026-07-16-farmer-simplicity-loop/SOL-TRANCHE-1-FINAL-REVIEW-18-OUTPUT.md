## Findings

**NO-GO**

- **HIGH — valid offline access is blocked for normal editable farm users.** Offline authorization correctly returns an offline profile, but replay eligibility ignores that source ([farmContext.ts:55](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:55)). Startup then unconditionally awaits strict Program due generation and Equipment replay ([App.tsx:463](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:463)).

  - Programs uses the throwing `generateStrict()` path ([index.ts:68](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/index.ts:68)).
  - Equipment’s otherwise offline-safe queue inspection is always followed by a server due-task RPC ([createSupabaseEquipmentTasksServices.ts:8](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/createSupabaseEquipmentTasksServices.ts:8)).
  - Either expected network failure reaches the gate catch and changes the entire app to `blocked` before cached farm state is published.
  - This defeats the specified offline reopening behavior in [foundation-shell.spec.ts:315](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:315). That E2E file was compiled but deliberately not executed.
  - The 39 regressions miss this combination: the mounted gate test injects `source: "live"` and a custom Equipment-only replay path, while the Program regression explicitly confirms that strict generation throws offline.

Required repair: skip server-only due generation for an authenticated `source: "offline"` profile while preserving offline queue inspection. Keep strict generation and its retryable blocking behavior for live startup/reconnect. Add a mounted non-browser regression using the production replay composition and an offline profile.

## 0042 result

The Review 17 defect is repaired. Direct inspection found no remaining HIGH/MEDIUM blocker in the PostgreSQL proof structure:

- Owner backfill/private-provenance assertions end at [verify-0042-disposable.ps1:118](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:118).
- Historical exact and fail-closed reversals execute under transaction-local `authenticated` role with the correct JWT subject and farm epoch headers at [line 120](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:120).
- Owner resumes only for the deferred invariant and catalog/grant/owner/trigger inspection.
- Canonical save/replay/reversal and backdated/calendar paths run authenticated.
- The dblink connection sets `authenticated`; both the outer initial save and deletion also set `authenticated` at [line 701](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:701).
- Program manual/task and trusted `skip_program_pass` operations remain authenticated.
- No further blocker was found in operational RLS, Program provenance, helper revocation, hardened service wrappers, exact reversal/farm locking, queue isolation, cancellation, recovery, clock/snapshot purity, strict echoes/fixtures, flex validation, or credential isolation.

## Scope and proof

- `HEAD` equals base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`; all reviewed changes are working-tree changes.
- Exact non-audit scope: **43/43** — 39 tracked modifications plus four untracked files: `verify-0042`, `deviceClockFence`, and the two new migrations.
- Staged files: **0**.
- Diff: 2,768 insertions and 372 deletions.
- Routes: **18/18**, ordered `/fields`, `/fields/new`, `/fields/:id`, `/fields/:id/edit`, `/grain/*`, `/inventory`, `/profitability/*`, `/equipment`, `/tasks`, `/weather`, `/field-log`, `/scouting`, `/harvest`, `/programs`, `/notifications`, `*`, `/login`, `/*`.
- Option 2 SHA-256: exact match, `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.
- Fresh non-writing checks: app/Vite TypeScript PASS; standalone E2E TypeScript PASS; regressions **39/39 PASS** through `node --import tsx`; targeted guards **11/11 PASS**; foundation guards PASS; credentials **43/0**; diff check PASS.
- Standard `npm run regression` could not start because the sandbox denied TSX’s temporary IPC directory; the same 39 files subsequently passed through the non-writing loader.
- Skipped as required: production build, dependency audit/network, mutation drills, disposable PostgreSQL execution, browser/Playwright/phone, live services, deployment, and persistent database work.
- LOW follow-up: 202 untracked audit artifacts remain outside the 43-file release scope; keep them excluded from any implementation commit.
- Model/effort: the runtime did not expose an auditable exact model or reasoning-effort identifier, so I cannot independently attest `gpt-5.6-sol` / Extra High.

External mutation: no
