# Farm Rx — Ship Checklist (first real customers)

Written 2026-07-13. Plain-English go-live sheet for the SHIP GATE in GOAL.md:
**Fields + Grain in front of a handful of real Crop RX customers.**

## What is READY (built, reviewed, proven live)
- All modules live on https://farm-rx.vercel.app against the farm-rx Supabase project:
  Fields, Grain (position/plan/contracts/bins/basis/alerts/offers/carry), Profitability
  (budgets/plans/reports/insurance), Inventory & compliance, Equipment, Tasks, Weather +
  spray windows, Rain gauge/field log, Scouting w/ photos, Harvest, Notifications, Programs.
- Security: public signups DISABLED (2026-07-13); grain/financials private per farm w/
  per-member "View financials"; rep access is two-part (grant + farm's share toggle);
  RLS proven with worker/rep/outsider tests.
- Onboarding: `scripts/provision-customer.mjs` proven end-to-end 2026-07-13 (creates the
  account while signups stay closed → farmer signs in → "Set up your farm" → clean app).
- Email alerts: Resend key installed; delivery proven to mason@croprxsolutions.com.

## What MASON must decide/do before or at ship
1. **Pick the customers** (a handful) + collect: email, farm name, cell number.
2. **Resend domain** (5 min): verify croprxsolutions.com at resend.com/domains → 3 DNS
   records into Hostinger → alert emails can then reach ANY address (today: only Mason's).
   Until then, farmers still get every alert in-app — email is a bonus, not a blocker.
3. **Custom SMTP for password resets** (optional at first): Supabase's built-in email is
   test-rate-limited. With provisioning we hand farmers their starting password directly,
   so resets are the only gap — acceptable to defer for a handful of hand-held customers.
4. **Phone push** (optional at first): needs the VAPID secrets set + HTTPS context.
   In-app alert bell works everywhere today.
5. **Supabase Pro** (recommended at ship, not required): daily backups, support, and
   leaked-password protection (free tier can't enable it). ~$25/mo.
6. **Real-device pass**: install the PWA on Mason's phone, walk the sunlight/gloves
   two-tap flows once before handing it to a farmer.

## How customer #1 goes live (the runbook)
1. Claude runs `node scripts/provision-customer.mjs <farmer email>` (local, service key
   in env only) → gets the one-time password.
2. Mason phones/texts the farmer the email + starting password (never email the password).
3. Farmer signs in at farm-rx.vercel.app → "Set up your farm" → done; app guides from there.
4. Optional: Mason's rep visibility = the farm's own "share with my Crop RX rep" toggle —
   OFF by default, the farmer flips it.

## Cleanup before the first real customer (Claude, one command each, on Mason's OK)
- Decide fate of test data: farmtest's "Test Farm (Claude verification)" and the two
  role-test accounts (farmworker@/farmrep@) are RLS-isolated and invisible to customers —
  safe to keep for ongoing verification. If Mason prefers a pristine DB, delete them.
