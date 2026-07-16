# Farm Rx Release-Gate Command Log

## Preflight and remote read-only checks

| Command/check | Final result |
|---|---|
| Branch, HEAD, merge-base, worktree inventory | PASS; `codex/farmrx-release-gate-proof`, HEAD/base `49614e7`; unrelated handoff preserved |
| `gh pr view 1 --json ...` and `gh pr checks 1` | PASS read-only on 2026-07-16; PR #1 open draft on old branch/HEAD; three existing checks green |
| `git ls-remote --heads origin ...` | Only `codex/farmrx-foundation-repair` exists remotely at `49614e7`; release-gate branch not pushed |
| Supabase/Vercel/service inventory | Read-only inventory completed; no named non-production Supabase environment or physical-device lane available |

## Defect-driven proof loop

| Proof | Result |
|---|---|
| Migrations 0038-0041 and disposable scripts | PASS after controlled before-states exposed and closed modern-claim, scheduler, push-owner, epoch, and direct-DML defects |
| Notification-link hostile matrix | PASS; hostile dot/protocol-relative forms reject and legitimate canonical paths remain same-origin |
| Queued operation regressions | PASS; stale A-to-B reads/writes, revocation/regrant, retained cache, queue save-lock, and cleanup replay are fenced |
| Revoked recovery regression | PASS; every queue family is quarantined, scoped, exportable/dismissible, and non-replayable |
| Scheduler/weather/push pure regressions | PASS; fixed clock, per-farm isolation, partial retry, gone target, and no successful-device resend |
| Migration 0041 direct DML proof | PASS; direct authenticated insert/update/delete denied while fenced save/delete RPCs work |
| Foundation harness failure proof | PASS; real exit 23 is fatal, every intermediate lane is checked, and the controlled mutation turns proof red |

## Authoritative full local gate

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-foundation.ps1` completed with exit code 0 in 144.1 seconds after the final harness repair.

- Intermediate-failure probe: PASS.
- Forced TypeScript build: PASS.
- Regression programs: 39/39 PASS.
- Production/PWA build: PASS; existing bundle-size advisory only.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Foundation static guards: PASS.
- Foundation mutation drill: 11/11 PASS.
- Disposable migration suites 0033, 0034, 0035, 0036, 0037, 0039, 0040, and 0041: PASS.
- RLS role matrix: PASS.
- Playwright: 32/32 PASS across Chromium desktop and phone.
- Final marker: `Farm Rx foundation gate: PASS`.

## Independent reviewers

| Reviewer | Authoritative runtime | Result |
|---|---|---|
| Sol delta 13 | `gpt-5.6-sol`, `xhigh` | Cleared direct push DML and prior security closures after repair |
| Terra delta 13 | `gpt-5.6-terra`, `medium` | `NO BLOCKING FINDINGS`; browser/PWA/workflow intent and local proof reconciled |
| Luna delta 13/14 | `gpt-5.6-luna`, `medium` | Found unchecked-intermediate-lane P1; fresh closure review returned `RELEASE CLEARED` |
| Sol delta 14 | `gpt-5.6-sol`, `xhigh` | Final frozen-diff review returned `RELEASE CLEARED` and `NO BLOCKING FINDINGS` |

## Final hard-barrier checks

- `npx tsc -b --force`: PASS.
- Changed/untracked implementation credential scan: no real credential identified; one UUID-shaped regression token fixture was reviewed without printing its value.
- Evidence-log credential scan: three copies of that same test-fixture shape and four third-party `node_modules` documentation examples were found and dispositioned from redacted context; no value was printed and no real credential was identified.
- Remaining status/diff/staged checks are recorded in `PRE-COMMIT-DECISION.md`.

No staging, commit, push, PR update, deploy, live migration/data change, provider delivery, or production action occurred.
