# Command Log

**Date:** 2026-07-15  
**Working directory:** `C:\FarmRx`  
**Mode:** Review only. No app/config/migration/test/dependency changes; no commit, push, deploy, migration, Supabase setting change, or manual form submission. Important exception: normal authenticated page loads automatically invoked the app's idempotent due-item and alert-transition RPCs, so live test-farm bookkeeping may have been updated even though no write action was intentionally taken.

## Repository baseline

- `git status --short --branch`
  - Start: `## main...origin/main`, clean.
  - End before final artifact write: only `docs/audits/2026-07-15-sol-foundation-review/` untracked.
- `git log -1 --format=...`
  - `d6b746d` — `Ship checklist executed: 0031-0035 applied, edge functions deployed, pushed` (2026-07-14 06:40:26 -0500).
- Source inventory:
  - 35 migrations, `0001_module1_fields.sql` through `0035_operational_integrity.sql`.
  - Two Edge Functions: `deliver-grain-alert` and `send-push`.
  - 28 regression scripts in `npm run regression`.

## Required verification

### `npx tsc -b --force`

- **Exit:** 0
- **Output:** none
- **Result:** PASS

### `npm run regression`

- **Exit:** 0
- **Elapsed:** approximately 13.4 seconds
- **Result:** PASS — all 28 configured scripts completed.
- Covered groups included cost of carry, insurance math, marketing alerts, firm offers, bin ledger, Grain repair/planning, Mock and Supabase-named repository suites, Programs/due items, notifications, weather, submit locks, save durability, and the round-seven sweep.

### `npm run build`

- **Exit:** 0
- **Elapsed:** approximately 8.5 seconds
- **Result:** PASS
- Vite transformed 201 modules.
- Main JavaScript: 1,093.15 kB, 287.59 kB gzip.
- CSS: 120.10 kB, 19.19 kB gzip.
- PWA worker generated; precache: 7 entries / 1,186.11 KiB.
- Warning preserved: some chunks exceed 500 kB after minification.

## Deeper local database proof

### `scripts/verify-0033-disposable.ps1`

- **Exit:** 0
- **Result:** PASS
- Proved same-bin/cross-bin commodity handling, capacity and negative-balance rejection, sequential replay idempotency, direct ledger insert revocation, immutable/finalized price legs, crop rotation after emptying, contract-delivery replay, and over-delivery rejection.

### `scripts/verify-0034-disposable.ps1`

- First parallel attempt: **Exit 1** with exact summary `Disposable postgres:16 did not become ready.`
- Isolated rerun: **Exit 0**, `PROBE disposable migration suite: PASS`.
- Interpretation: temporary Docker startup contention, not a product failure.

### `scripts/verify-0035-disposable.ps1`

- **Exit:** 0
- **Result:** PASS
- Proved Program due-notification dedupe, push-delivery queue creation and claim backoff, retryability, RLS enabled on internal tables, Program-owned task status protection, service-log meter reversal, alert transition uniqueness, and cross-farm alert rejection.

### Fresh role/RLS matrix against all migrations

- Two harness attempts failed before product assertions:
  1. temp probe table lacked an `authenticated` insert grant (`permission denied for table probe_results`);
  2. a temporary Postgres container shut down during bootstrap.
- Simplified isolated rerun: **Exit 0**, `PROBE RLS role matrix: PASS`.
- Observed matrix:

| Actor | Access | Edit | Manage | Private financials | Visible farms |
|---|---:|---:|---:|---:|---:|
| manager | true | true | true | true | 1 |
| worker default | true | true | false | false | 1 |
| read-only | true | false | false | false | 1 |
| rep, farm toggle off | false | false | false | false | 0 |
| rep, toggle + explicit grant | true | false | false | true | 1 |
| stranger | false | false | false | false | 0 |

## Supabase/live-state inspection

- `supabase --version` -> `2.106.0`.
- `supabase migration list --linked` -> **blocked** with exact summary: `Cannot find project ref. Have you run supabase link?`
- No `supabase/config.toml` exists in this checkout.
- Therefore live migration registry, advisors, Auth settings, schedules, and secrets were not claimed as verified.
- Authenticated browser traffic successfully read the live module tables/RPCs, including 0035 capability/transition paths. Page load automatically called `generate_due_program_items` and `record_marketing_alert_transition`; these are idempotent application behavior but may update due/alert bookkeeping. No form was submitted and no manual live mutation was attempted.

## Deployment and HTTP headers

- `vercel inspect` reported production Ready for `https://farm-rx.vercel.app`.
- `Invoke-WebRequest -Method Head https://farm-rx.vercel.app/grain`:
  - HTTP 200;
  - HSTS present: `max-age=63072000; includeSubDomains; preload`;
  - no CSP;
  - no X-Frame-Options;
  - no Referrer-Policy;
  - no Permissions-Policy;
  - no X-Content-Type-Options.

## Browser/PWA review

Used the Playwright review workflow against deployed production with the documented verification account. Credentials were not written to audit files; the session was signed out after review.

- Anonymous `/fields` -> `/login`: PASS.
- Authenticated route smoke: Fields, Grain, Inventory, Profitability, Equipment, Tasks, Weather, Field Log, Scouting, Harvest, Programs, and Alerts all returned HTTP 200, rendered the expected H1, and had no visible `[role=alert]` page error.
- Grain displayed real scoped farm data, manual Harvest-to-Grain reconciliation, check-on-open alerts, and six TradingView widget frames.
- PWA inspection:
  - manifest: `/manifest.webmanifest`;
  - Service Worker supported and controlling via `/sw.js`;
  - manifest display mode: standalone.
- **Offline proof:** load Fields online -> set browser offline -> reload.
  - Shell loaded.
  - Farm UI failed with: `We could not reach Farm Rx. Check your signal and try again.`
- **Mobile proof:** 390x844 screenshot showed all twelve bottom-nav destinations compressed with overlapping labels/icons.
- Login page console noise: missing `/favicon.ico` returned 404. This was not elevated above polish.

## Static/security analysis

- `npm audit --omit=dev --audit-level=moderate` -> exit 0, `found 0 vulnerabilities`.
- `npm audit --audit-level=moderate` -> exit 0, `found 0 vulnerabilities`.
- Static traces covered every repository composition, local queue, gateway, major RPC, RLS helper/policy family, Edge Function, service worker, storage bucket, and cross-module dependency.

## Artifact integrity

- A sensitive-pattern scan of the audit directory found no password, Bearer token, or Supabase auth-storage value.
- No existing source, migration, config, dependency, environment, test, or documentation file was modified.
