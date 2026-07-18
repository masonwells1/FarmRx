# Farm Rx — Ship Checklist (first real customers)

Written 2026-07-13. Plain-English go-live sheet for the SHIP GATE in GOAL.md:
**Fields + Grain in front of a handful of real Crop RX customers.**

Release status refreshed 2026-07-18: the browser/bundle/database hardening release is merged,
live, and verified in production. The engineering release is complete; this checklist now tracks
only the human handoff to the first customers.

## What is READY (built, reviewed, proven live)
- All modules live on https://farm-rx.vercel.app against the farm-rx Supabase project:
  Fields, Grain (position/plan/contracts/bins/basis/alerts/offers/carry), Profitability
  (budgets/plans/reports/insurance), Inventory & compliance, Equipment, Tasks, Weather +
  spray windows, Rain gauge/field log, Scouting w/ photos, Harvest, Notifications, Programs.
- Security: public signups DISABLED (2026-07-13); grain/financials private per farm w/
  per-member "View financials"; rep access is two-part (grant + farm's share toggle);
  RLS proven with worker/rep/outsider tests.
- Onboarding: `scripts/provision-customer.mjs` creates the approved owner while signups stay closed,
  sends the narrow first-password link, and has an owner-validated resend path after partial mail
  failure. The older starting-password journey was proven 2026-07-13; the new email-first journey
  still needs the production SMTP and phone proof below.
- Email alerts: Resend key installed; delivery proven to mason@croprxsolutions.com.

## What MASON must decide/do before or at ship
1. **Pick the customers** (a handful) + collect: email, farm name, cell number.
2. **Resend domain** (5 min): verify croprxsolutions.com at resend.com/domains → 3 DNS
   records into Hostinger → alert emails can then reach ANY address (today: only Mason's).
   Until then, farmers still get every alert in-app — email is a bonus, not a blocker.
3. **Custom SMTP — CUSTOMER-ONBOARDING BLOCKER, NOT A DEFAULT-OFF CODE-MERGE BLOCKER:** Supabase's built-in email
   is test-rate-limited, and the July 18 read-only Auth check confirmed SMTP host, user, and sender
   are all unconfigured. Configure and prove custom SMTP before provisioning a real customer, then
   enable `VITE_PASSWORD_EMAIL_DELIVERY_ENABLED=true` for the approved deployment and
   `FARM_RX_AUTH_EMAIL_DELIVERY_READY=true` only in the trusted provisioning terminal.
4. **Phone push** (optional at first): needs the VAPID secrets set + HTTPS context.
   In-app alert bell works everywhere today.
5. **Supabase Pro** (recommended at ship, not required): daily backups and support. Leaked-password
   protection is deferred because the current Free-tier Management API returns 402; it is not an
   action available before this release or a code-merge prerequisite. ~$25/mo.
6. **Real-device pass**: install the PWA on Mason's phone, walk the sunlight/gloves
   two-tap flows once before handing it to a farmer. Mason deferred this pass on 2026-07-18;
   it was intentionally excluded from the completed hardening release, but remains required
   before the first farmer handoff.

## How customer #1 goes live (the runbook)
1. Claude runs `node scripts/provision-customer.mjs` (local, service key in env only) and enters the
   farmer email only at the script prompt. The script confirms the approved owner and requests the
   setup email; it prints no password and the email never appears in shell history.
2. Farmer opens only the newest email, chooses the first password, then signs in at
   farm-rx.vercel.app → "Set up your farm" → done; app guides from there.
3. If account creation succeeded but mail failed, fix SMTP and rerun
   `node scripts/provision-customer.mjs --resend-setup`, then enter the same email at the prompt.
   That mode validates the existing initial-owner flag before sending and never creates another
   account or reveals a secret.
4. Optional: Mason's rep visibility = the farm's own "share with my Crop RX rep" toggle —
   OFF by default, the farmer flips it.

## Cleanup before the first real customer (Claude, one command each, on Mason's OK)
- Decide fate of test data: farmtest's "Test Farm (Claude verification)" and the two
  role-test accounts (farmworker@/farmrep@) are RLS-isolated and invisible to customers —
  safe to keep for ongoing verification. If Mason prefers a pristine DB, delete them.
