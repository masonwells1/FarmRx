# Farm Rx customer-zero readiness release evidence

**Date:** 2026-07-18
**Branch:** `codex/farmrx-customer-zero-readiness`
**Isolated worktree:** `C:\Users\mason\.codex\worktrees\farmrx-customer-zero-readiness`
**Integrated base:** `origin/main` at `983536ab444deef477b05ad2f75d5ccdad49e7dd`
**Production URL:** `https://farm-rx.vercel.app`
**Supabase project:** `agvsozfbstpekuqxpqjr`

## Owner verdict

The code slice is merged and deployed with password-email delivery **off by default**. It must not
be called customer-zero operationally complete until custom SMTP and two physical-phone journeys
are proven. The publication changed application code and documentation only: no Auth setting,
secret, live data, or live migration was changed.

Final independent Sol verdict on the integrated release commit: **GO**, with no P0, P1, P2, or P3
findings. The final uninterrupted foundation gate on that exact code and base: **PASS**, exit 0.
Earlier review findings are closed by explicit memory-only recovery, a bounded tab-owned recovery
lease, ordinary-tab broadcast isolation, and fail-closed back/forward-cache revalidation.

## Delivered slice

### Farm privacy

- Adds a farmer-facing **Farm privacy** route reachable from normal navigation.
- Shows the server-confirmed `share_with_rep` state; owner/manager may change it, other roles are
  read-only.
- Requires confirmation before turning sharing on.
- Does not change the control optimistically. A failed or lost response leaves the last confirmed
  setting visible and offers an explicit recheck.
- Refuses offline changes and never queues privacy changes for later replay.
- Binds the write to one exact user, farm, access epoch, and expected `updated_at` row version.
- Expanded disposable RLS proof covers owner/manager writes, worker/read-only/rep denial, named-rep
  OFF/ON visibility, and epoch bumps for every sharing transition.

### Password recovery and first-password setup

- Adds non-enumerating **Forgot password** and `/update-password` flows.
- Only a real `PASSWORD_RECOVERY` event on the exact update route creates a narrow recovery
  capability; it never becomes an ordinary signed-in Farm Rx session.
- Recovery credentials remain memory-only in the page that received `PASSWORD_RECOVERY`. Closing,
  refreshing, or leaving `/update-password` revokes that page's unique owner lease, remains signed
  out, and requires a fresh link. A hard crash expires after ten minutes and the next coordinated
  sign-in prunes only the stale tuple. Later refresh/user-update events cannot resurrect a completed
  capability. A persisted back/forward-cache restore revalidates the exact tuple and becomes invalid
  before submission when pagehide already revoked the owner lease.
- Supabase broadcasts recovery events to sibling tabs. Ordinary-route recipients ignore the
  capability locally, preserve any legitimate session, and cannot clear the recovery owner's lease.
- Password updates require 12 characters, confirmation, strength feedback, and a submit lock.
- Once the server changes the password, local state immediately becomes completed/signed-out. If
  device cleanup then fails, the UI truthfully says the password changed, disables retry, clears as
  much local state as possible, and gives close-tabs/support guidance. A sibling tab's newer
  accepted session remains exact and usable; the terminal recovery page cannot adopt or overwrite it.
- The password mutation uses a one-purpose, non-persistent Auth client seeded only with the captured
  recovery credentials; a shared-tab ambient session change cannot redirect the update to another
  account.
- Public reset requests resolve success, returned provider error, and thrown transport error to the
  same public string and exact same-origin redirect contract.
- `scripts/provision-customer.mjs` creates a confirmed, approved initial owner with an unshared
  random bootstrap secret, immediately requests the same one-purpose first-password email, and
  never returns or prints a password. It accepts no positional email argument: the only create
  command has no arguments and the email is entered as prompt data, outside shell history.
- Explicit `--resend-setup` mode paginates Auth users, requires exactly one email match and
  `initial_farm_owner === true`, then sends a fresh link without creating or changing the account.
  It accepts no other arguments and reads the email only at the prompt. Partial mail success gives
  non-executable remediation text and never interpolates customer input into a paste-ready shell
  command.

### SMTP-safe default

- `VITE_PASSWORD_EMAIL_DELIVERY_ENABLED` must equal the exact string `true` before the web reset
  request appears. The default production build instead shows honest contact guidance.
- `FARM_RX_AUTH_EMAIL_DELIVERY_READY` must equal `true` in the trusted terminal before provisioning
  can create or resend an owner account.
- `/update-password` stays available for a valid recovery link.

### Rural-network bundle and lazy-route recovery

- Self-hosts Inter instead of depending on a font request at runtime.
- Splits major routes into lazy chunks and separates React and Supabase vendor chunks.
- A stale route chunk triggers at most one automatic page reload for that route in the current
  browser session.
- A persistent failure stops reloading, renders a useful retry state, and the boundary resets after
  navigation to another route.
- The PWA build includes the route chunks in its generated precache.

Default-off production build sizes from the final gate:

- app shell: 484.21 kB, 116.00 kB gzip;
- React vendor: 230.82 kB, 74.01 kB gzip;
- Supabase vendor: 211.23 kB, 54.97 kB gzip;
- privacy route: 3.60 kB, 1.46 kB gzip;
- Fields route: 39.29 kB, 10.40 kB gzip;
- Grain route: 82.24 kB, 21.99 kB gzip; and
- generated PWA precache: 30 entries, 1350.62 KiB.

## Read-only live evidence

### Farm privacy database contract

Read-only live verification confirmed the current Farm Rx project is healthy and already contains:

- `farms.share_with_rep`;
- the `farms_update` policy using `can_manage_farm`; and
- the sharing access-epoch trigger.

No schema migration was needed or applied for this slice.

### Auth configuration

Read-only Supabase Management API verification, with no secret output, confirmed:

- site URL: `https://farm-rx.vercel.app`;
- redirect allowlist: the production origin, `https://farm-rx.vercel.app/**`, and localhost entries;
- public sign-up disabled;
- external email auth enabled;
- automatic mail confirmation disabled; and
- SMTP host, user, and sender all unconfigured.

The production wildcard covers `/update-password`. Missing custom SMTP blocks enabling email
delivery and onboarding a real customer, but does not block merging the default-off guards.
Leaked-password protection is a deferred Pro-tier hardening item: the current Free-tier Management
API returns 402 for that setting, so it is neither an available dashboard action nor a prerequisite
for this default-off code release.

## Executed proof

| Command / proof | Result |
|---|---|
| `node scripts/provision-customer.regression.mjs` | PASS, exit 0: unshared secret, exact redirect, owner-only resend, partial-success recovery, prompt-only CLI input (malicious positional input is rejected before prompt/provision/output), default-off CLI gate |
| `npx tsx src/auth/passwordRecovery.regression.ts` | PASS, natural exit 0: production-adapter memory-only recovery, ordinary-route broadcast isolation, exact owner pagehide lease revocation, fail-closed back/forward-cache restore with zero mutation, eight primary/retry cleanup fault boundaries preserving a sibling's exact accepted session and rendered sign-in, bounded crash cleanup, mounted route/cancel cleanup, one-winner cross-tab update, isolated mutation, retry/completion truth, non-enumeration helper |
| Post-broadcast-repair focused matrix | PASS: forced TypeScript; Auth-session storage fence; queued-operation context; foundation static guards; invalid-recovery and default-off login Playwright 4/4 across desktop + phone |
| `npx tsx src/data/SupabaseFarmSharingRepository.regression.ts` | PASS, exit 0: exact context, offline refusal, cross-farm/race/malformed response failure |
| `npx tsc -b --force` | PASS, exit 0 inside the final uninterrupted foundation gate |
| Default-off focused Playwright login proof | PASS 2/2, desktop + phone |
| Explicitly enabled focused Playwright reset proof | PASS 2/2, desktop + phone |
| Focused privacy + lazy recovery Playwright | PASS 10/10, desktop + phone |
| Isolated `CI=1` full Playwright before integration with current `main` | PASS 50/50 in 1.2 minutes, exit 0; superseded by the exact integrated gate below |
| Production build before the final non-enumeration helper edit | PASS; route chunks emitted, PWA 30-entry precache, 1341.35 KiB |
| Full foundation gate before the final non-enumeration helper edit | PASS, exit 0: audit 0 vulnerabilities; static guards; 11/11 mutations; disposable 0033/34/35/36/37/39/40/41/42; expanded RLS matrix; 50/50 browser |
| Final `CI=1 npm run verify:foundation` on the exact integrated release code | **PASS, exit 0**: forced TypeScript; every regression; production build; audit 0 vulnerabilities; static guards; 11/11 mutations; disposable 0033/34/35/36/37/39/40/41/42/43; authenticated-owner privacy RLS matrix; Playwright 53 passed, 1 intentional skip in 1.3 minutes |
| PR #6 required checks on feature head `2a8bc6d8adcdd61831cb58c9653c37989458b04b` | **PASS**: foundation, Vercel preview, Vercel Preview Comments, and CodeRabbit; latest CodeRabbit review produced no actionable comments |
| Post-merge production HTTP proof | **PASS**: `/`, `/login`, `/update-password`, `/privacy`, `/manifest.webmanifest`, and `/sw.js` returned 200 with the expected content types and CSP, referrer, permissions, no-sniff, frame-deny, and same-origin opener headers |
| Post-merge production Chromium proof | **PASS**, desktop Chrome + Pixel 5: required sign-in fields; default-off support guidance with no reset button; invalid recovery fails closed to **Return to sign in**; unauthenticated privacy redirects to sign-in; no horizontal overflow, console errors, or page errors |

One earlier non-CI Playwright attempt reused another task's preview on port 4173; that preview exited
mid-run and later tests received `ERR_CONNECTION_REFUSED`. That run is discarded and is not release
evidence. The final isolated `CI=1` rerun above owned its server and passed 53 tests with one
intentional project-specific skip.

## Customer-zero operational proof still required

1. Configure custom SMTP through a separately approved production change.
2. Send to a disposable non-production owner and prove sender, delivery, newest-link behavior,
   mobile rendering, first-password completion, later recovery, expiry, and reuse failure.
3. Only after that proof, enable the Vercel email-delivery flag and the trusted-terminal
   provisioning readiness flag.
4. Execute `docs/customer-zero-readiness-runbook.md` on physical iPhone/Safari and Android/Chrome
   with disposable owner, worker, and named-rep accounts.
5. Prove OFF/ON/OFF privacy and stale-rep revocation on separate real sessions.
6. Prove weak-signal save/reconnect, installed PWA, app-closed push, low-storage behavior, worker
   offline revocation, and an uncoached farmer explanation.

These are operational go-live gates. They are not claims that automated desktop emulation can
replace.

## Publish closeout

- Pull request: `https://github.com/masonwells1/FarmRx/pull/6`, merged 2026-07-18.
- Reviewed feature head: `2a8bc6d8adcdd61831cb58c9653c37989458b04b`.
- Production merge commit: `a6541b2ca33917e2ca3f63c22f43ca60095532a8`.
- Vercel production deployment: `dpl_5ySZms2MjWJ2thtP8uQuKpAE3NLT`, status **Ready**, aliased to
  `https://farm-rx.vercel.app`.
- Production app shell observed after deployment: `/assets/index-BSgdbEQT.js`.

The default-off email guards make this code publication safe while SMTP remains absent. Enabling
email delivery is a separate production action with its own proof; this release did not enable it.
