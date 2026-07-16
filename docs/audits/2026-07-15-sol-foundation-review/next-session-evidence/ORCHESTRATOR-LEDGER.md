# Farm Rx Release-Gate Orchestrator Ledger

**Run:** 2026-07-15 through 2026-07-16

**Branch:** `codex/farmrx-release-gate-proof`

**Base and current HEAD:** `49614e75140fdf4dee94d916e32b386bef922f1a`

**Operating boundary:** local/disposable proof and read-only remote inspection only

## Authority record

Mason's verbatim authorization was:

> ok go ahead and do what you neeeed

This authorized the local release-gate branch, evidence, local/disposable proof, and narrowly scoped local repairs. It did not name a non-production Supabase project, authorize a preview deployment change, provide physical devices/test recipients, or authorize a commit, push, PR update, merge, production deploy, live migration, live-data change, secret change, or customer notification.

## Preserved state

- The unrelated untracked file `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` remains present, unchanged, and excluded.
- No `.env` file or generated `dist`, Playwright, or `test-results` artifact is candidate-scoped.
- Nothing is staged. No new commit exists. The release-gate branch is local-only.
- Fresh read-only GitHub verification on 2026-07-16 confirmed PR #1 remains an open draft from `codex/farmrx-foundation-repair` at `49614e7`; its `foundation`, `Vercel`, and `Vercel Preview Comments` checks are green. The PR contains none of the working-tree repairs.

## Defects found and closed

1. Modern PostgREST JSON claims were not authoritative in server-owned RPCs. Forward migration 0038 and before/after PostgreSQL 17 proof closed this.
2. Scheduler weather qualification and per-device push retry semantics were unsafe. Migration 0039 and deterministic Edge/database proofs closed this.
3. Revoked-farm queues could survive locally and replay after regrant. A scoped, export-or-dismiss recovery vault with no replay path closed this.
4. Parent CSP directly permitted TradingView. The parent now permits only the same-origin opaque frame; the frame retains its isolated CSP.
5. Stale user/farm operations could cross async boundaries. Migrations 0040-0041, captured farm-access epochs, repository guards, and regressions now fence queued writes and all ten queued repository read paths.
6. A hostile notification link could normalize to a protocol-relative off-origin URL. Exact canonical same-origin validation and regression coverage closed this.
7. Authenticated users could bypass push fencing through direct `push_subscriptions` DML. Migration 0041 now revokes direct INSERT/UPDATE/DELETE and removes the write policies while fenced save/delete RPCs remain proven.
8. The aggregate foundation script could miss an intermediate native-process failure. Every lane now runs through a fail-fast wrapper; a real exit-23 probe, static guard, and controlled mutation prove the aggregate cannot falsely pass that way.

## Final gate disposition

| Gate | Disposition | Evidence |
|---|---|---|
| Local TypeScript/regressions/build/audit | PASS | Forced TypeScript, 39 regression programs, PWA production build, and audit with 0 vulnerabilities |
| Static and mutation proof | PASS | Static guards and 11/11 controlled mutations |
| Disposable database/RLS proof | PASS | Migrations 0033-0041 and RLS role matrix on disposable PostgreSQL 17 |
| Browser/PWA proof | PASS LOCAL | 32/32 Chromium desktop/phone checks |
| Fresh Sol adversarial review | RELEASE CLEARED | Exact runtime `gpt-5.6-sol`, `xhigh`; no remaining P0/P1/P2 |
| Terra independent workflow review | NO BLOCKING FINDINGS | Exact runtime `gpt-5.6-terra`, `medium` |
| Luna scope/proof review | RELEASE CLEARED | Exact runtime `gpt-5.6-luna`, `medium`; harness P1 found, fixed, and independently closed |
| Non-production Supabase/Edge/scheduler | UNVERIFIED | No exact allowed non-production project or secret authority was supplied |
| Deployed preview/CDN hostile-frame proof | UNVERIFIED | No preview redeploy/configuration authority was supplied |
| Physical device/real push/email | UNVERIFIED | No named devices, accounts, or recipients were supplied |
| Production/live action | NOT PERFORMED | Explicit approval was not supplied |

## External side-effect record

No database, deployment, provider, GitHub, business-data, email, or push mutation was performed. During early read-only preview inspection, Vercel CLI automatically created a temporary deployment-protection bypass token; its value was never printed or stored and no deployment/configuration changed. The action was recorded and not repeated.

## Current release boundary

The working tree is a locally cleared release candidate and is ready for Mason's separate commit decision. It is not deployed, not pushed, not on PR #1, and not production released.
