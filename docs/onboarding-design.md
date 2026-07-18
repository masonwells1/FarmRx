# Farm Rx — Customer Onboarding Design (v1)

**Current status (updated 2026-07-18):** the owner-provisioning path below has been implemented
and exercised. The customer-zero readiness branch adds self-service password recovery and a
set-new-password screen. Production email delivery still requires the exact redirect URL and
custom SMTP checks in `docs/password-recovery-support.md`; those live settings are not changed by
application code.

---

## Plain English for Mason

**What "onboarding" means here:** turning a new customer into a working Farm Rx account — a
login they can use, and their own private, empty farm workspace ready for fields. Today there is
**no "Sign up" button** in Farm Rx (on purpose). You create each customer. That is a feature, not
a gap: it keeps strangers from making accounts on your project, and it gives you a clean moment to
welcome the customer.

**The one thing that makes this slightly technical:** for the app to show a new farmer the
"Set up your farm" screen, their account needs a hidden flag turned on
(`initial_farm_owner`). That flag **cannot** be set from the Supabase website's normal buttons —
it can only be set with your secret admin key. So the reliable way to add a customer is a **tiny
script that Claude runs for you** (one line per customer). It creates the login, sets the flag,
and sends the farmer a one-purpose link for choosing their first password.

**Your per-customer checklist (about 2 minutes):**

1. Get the customer's email address and their farm's name.
2. In a Claude session, say: *"Provision a Farm Rx customer: `farmer@email.com`."* Claude runs the
   provisioning script.
3. The script confirms that the setup email was requested. Tell the farmer to open only the newest
   Farm Rx email and choose their first password. Crop RX never sees or relays that password.
4. Tell the farmer: return to Farm Rx, sign in, then type the farm name and operating name on the
   "Set up your farm" screen. That's it — their farm exists and is private to them.
5. You watch it work once (have them sign in while you're on the phone), then you're done.

**Current safety state (verified 2026-07-18):** public sign-up is already disabled. Leaked-password
protection is unavailable on the current Supabase Free tier (the Management API returns 402); keep
it documented as a deferred Pro-tier hardening item, not an onboarding action or release prerequisite.

---

## What exists today vs. what's missing

**Verified against the code and applied migrations:**

| Piece | State |
|---|---|
| Login screen (email + password sign-in) | **Exists.** `LoginPage` in `src/App.tsx`, including required-field validation and **Forgot password?**. Public sign-up remains intentionally absent. |
| Session restore / stay-signed-in | **Exists.** `AuthProvider` + `RequireSession`. |
| "Set up your farm" form for a new owner | **Exists** — `InitialFarmSetup` in `src/App.tsx`, shown by `FarmAccessGate`. |
| Gate that decides who sees the setup form | **Exists.** `FarmAccessGate` shows it only when `user.app_metadata.initial_farm_owner === true` **and** the account has zero farms. Otherwise it shows *"Crop RX needs to finish your farm setup."* |
| Farm-creation RPC | **Exists and applied** (migration 0009). `public.bootstrap_first_farm(p_farm_name, p_entity_name, p_entity_type)` — idempotent, binds owner to `auth.uid()`, the 0002 trigger adds the owner membership. Called by `bootstrapInitialOwnerFarm` in `src/auth/bootstrapFarm.ts`. |
| A way to **create the auth user** | **Missing from the app** (by design — no self-serve). Must be done by Crop RX out-of-band. |
| A way to **set `initial_farm_owner`** on that user | **Missing.** This is the crux (see below). |
| First-password / password-reset screen | **Implemented on the customer-zero readiness branch.** Provisioning and later recovery both send a narrow Supabase recovery link to `/update-password`; invite-completion remains a separate, unused flow. |

**The crux — the hidden flag:** `FarmAccessGate` (App.tsx line ~123) requires
`user.app_metadata.initial_farm_owner === true` before it will show the setup form. `app_metadata`
is a **protected** field in Supabase: it is **not** editable from the dashboard's Users UI, and
the public sign-up endpoint cannot set it either. It can only be set by the **Admin API** (service-
role key) or a direct SQL update to `auth.users.raw_app_meta_data`. **Any onboarding method that
can't set this flag leaves the farmer stuck on "Crop RX needs to finish your farm setup."** This is
why the pure-dashboard option (a) does not actually work end-to-end today, and why a small script
(option b) is the right v1.

---

## Security assessment — public sign-up is disabled

**Current read-only production state (2026-07-18):** Supabase Auth has public sign-up disabled. The
publishable key remains in the browser as normal, but it cannot be used to create a public account.
Leaked-password protection remains unavailable because this project is on the Free tier.

**Can a stranger reach any farm data? No.** Row-Level Security (migration 0002) is the wall:

- `farms_select` uses `can_access_farm(id)` → active membership **or** an enabled named-rep grant.
  A brand-new stranger has neither, so **zero farm rows** are returned.
- Every child table (`entities`, `fields`, `crop_assignments`, `arrangements`, and the
  Grain/Inventory/Profitability tables in later migrations) has the same parent check. All return
  nothing.
- The **only** table a member-less signed-in user can read is `commodities` — a global crop-name
  lookup with no farm or financial data. Harmless.

**Why keep this guard?** If public sign-up were ever re-enabled, two real but lower-severity risks
would return. Both concern abuse of *Mason's* project rather than a data leak:

1. **Stranger self-provisioning an empty farm.** `bootstrap_first_farm` is granted to any
   `authenticated` user and only checks that the caller has no membership — it does **not** check
   `initial_farm_owner`. The app's UI gate checks that flag, but a determined attacker can call the
   RPC directly with the publishable key + their own confirmed session and create their **own**
   empty farm (and owner membership) on Mason's project. They still can't see anyone else's data —
   but they can litter the free-tier project with junk farms.
2. **Account-creation spam.** Open sign-up lets bots create confirmed accounts, burning free-tier
   quota and auth email sends.

**Required state: keep public sign-up disabled.** With the sign-up endpoint off, no stranger can
obtain an account at all, so `bootstrap_first_farm` is unreachable by strangers and the empty-farm
and spam vectors disappear. The owner-provisioned model never uses public sign-up, and the **Admin
API still creates users with sign-up disabled** (the toggle blocks only the public endpoint).

---

## Options evaluated (honest comparison)

### (a) Pure Supabase Dashboard flow — *rejected for v1*
Add/invite the user in the dashboard; farmer signs in; the app's setup form creates the farm.
**Zero code, appealing — but it does not work today.** The dashboard cannot set
`initial_farm_owner` on `app_metadata`, so the farmer lands on *"Crop RX needs to finish your farm
setup"* and can go no further. It would only work if we (1) added a SQL step anyway, or (2) removed
the flag requirement — but the flag is a deliberate security control (it stops every future
employee account with zero memberships from silently becoming a farm owner), and the task forbids
src changes. **Verdict: not viable alone.**

### (b) Small local provisioning script run by Claude — **RECOMMENDED for v1**
A small Node script using the service-role key, run from Mason's machine (by Claude in a session),
one command per customer. In one operator flow it creates the confirmed user, sets
`app_metadata.initial_farm_owner = true`, and requests a one-purpose first-password email. The
temporary bootstrap secret is never returned, printed, emailed, or relayed. The service key never
ships to the app or a commit. **Verdict: ship this after production SMTP proof.**

### (c) In-app Crop RX admin screen — *post-ship*
A screen inside Farm Rx where Mason adds customers himself. Nicest long-term UX, but it's the most
code: it needs an admin-role design, a secure server function to call the Admin API (the service
key must never reach the browser), and its own testing. Not a v1 blocker. **Verdict: build later,
after Fields + Grain are in front of real customers.**

---

## Recommended v1: the provisioning script (option b)

### Why v1 uses the recovery capability for first-password setup
Farm Rx does not treat an invite as a normal app session. The provisioning script creates a
confirmed, approved owner account with a long random bootstrap secret that nobody receives, then
immediately requests the same narrow `/update-password` recovery email used by **Forgot
password?**. The farmer chooses the first known password. Crop RX never sees, prints, emails, or
relays it.

If account creation succeeds but email delivery fails, the CLI reports that partial success and
instructs the operator to retry in owner-validated resend mode. The customer email is always entered
at the script prompt, never appended to a shell command. Resend mode never creates or changes an account: it first
finds the exact email through the Admin API and proves `initial_farm_owner === true`, then requests
a fresh setup link. This avoids both an unknowable-password dead end and accidentally granting an
employee owner setup.

### The script

The canonical implementation is `scripts/provision-customer.mjs`, backed by
`scripts/provision-customer-lib.mjs`. Do not paste a second copy into a runbook; the executable file
is the source of truth.

```powershell
$env:FARM_RX_AUTH_EMAIL_DELIVERY_READY = "true" # only after the SMTP delivery proof
node scripts/provision-customer.mjs
# Enter the customer email only when the script prompts for it.
# Only after a reported partial email failure and after mail delivery is fixed:
node scripts/provision-customer.mjs --resend-setup
# Enter the same customer email only when the script prompts for it.
```

**Secret handling (hard rules):**
- The service-role key lives **only** in an environment variable on Mason's machine, e.g. set for
  the session in PowerShell: `$env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."`. Never paste it into
  a file, a commit, or the app.
- `.gitignore` already excludes `.env*`, including nested `scripts/.env` files. Keep that guard in
  place and never force-add a local key file. The script itself contains no secret and is safe to
  commit.
- The service-role key bypasses RLS. It is used **only** for provisioning, from a trusted machine,
  never in the PWA and never in customer-path testing.

### If a farmer is also an "employee" (not an owner)
v1 onboards **farm owners**. Do **not** set `initial_farm_owner` for an employee — leave it off, and
add them to an existing farm via a membership row (owner/manager can do this once the in-app roster
UI exists, or via a separate admin step). An employee with the flag off and no membership correctly
sees *"Crop RX needs to finish your farm setup,"* which is the intended safe dead-end until they're
added to a farm.

---

## Per-customer runbook (the recommended flow, click by click)

Do this once per new **owner** customer. Assumes the two one-time dashboard settings below are
already done.

1. **Collect** the farmer's email address, their farm name (e.g. "Wells Family Farm"), and their
   operating/entity name + type (LLC, individual, etc.). You only strictly need the email to create
   the login; the farmer types the farm names themselves in step 4.
2. **Run the script.** In a Claude session on Mason's machine, with the service-role key set in the
   environment, run `node C:\FarmRx\scripts\provision-customer.mjs` with no email argument. Enter
   the farmer's email only at the script prompt. It confirms the exact owner identity and that the
   first-password email was requested; it prints no password.
3. **Farmer chooses the password.** Ask them to open only the newest Farm Rx email and choose their
   password. If email dispatch failed after account creation, fix delivery and use the documented
   `--resend-setup` mode and enter that same email at the prompt; never paste customer input into a
   shell command.
4. **Farmer signs in and names their farm.** They return to Farm Rx, sign in, and the app shows **"Set up
   your farm."** They enter the farm name + operating name + entity type and tap **Save farm**. Behind
   the scenes this calls `bootstrap_first_farm`, which creates the farm, the first entity, and the
   owner membership — all bound to the farmer's own account.
5. **Watch it work.** Ideally stay on the phone while they sign in the first time. Confirm they reach
   the Fields screen with their farm name in the header. That's the proof the account is live. (If
   they ever see *"Crop RX needs to finish your farm setup,"* the flag didn't get set — re-run the
   check in the troubleshooting note.)

**Troubleshooting quick hits:**
- *"Set up your farm" never appears / stuck on the "finish your setup" message* → the
  `initial_farm_owner` flag isn't `true`. Confirm with an admin read of the user, or re-run the
  provisioning step (createUser will report "already exists"; in that case set the flag with
  `admin.auth.admin.updateUserById(id, { app_metadata: { initial_farm_owner: true } })`).
- *The setup email did not arrive* → verify custom SMTP and Auth delivery logs. If the account was
  created, run `node scripts/provision-customer.mjs --resend-setup` and enter the email at the
  prompt; that mode proves the existing user is an approved initial owner before it requests another
  link. Do not create a second account or relay a password.
- *"We found more than one farm for this account"* → the account already owns a farm; they don't need
  onboarding, just sign-in.

---

## Current Supabase dashboard state and deferred hardening

These are the current settings and known platform limits for the Farm Rx project
(`agvsozfbstpekuqxpqjr`); they are not per-customer steps.

1. **Public sign-up is OFF.** Keep **"Allow new users to sign up"** disabled. This closes the public
   `/auth/v1/signup` endpoint while the Admin API used by the provisioning script continues to work.
2. **Leaked-password protection is deferred.** The current Free-tier Management API responds 402
   (available on Pro Plans and up). Do not treat it as a dashboard action or as a prerequisite for
   this default-off code release; reassess if Farm Rx upgrades to Pro.
3. **Email confirmation remains conservative.** The provisioning script creates confirmed owners and
   public signup stays off; do not loosen Auth email settings while enabling custom SMTP.

---

## Known v1 limitations and fast-follows (not blockers)

- **Invite completion is not used.** First-password setup and later self-service recovery both use
  the narrowly fenced `/update-password` recovery capability. Before releasing either flow,
  configure custom SMTP and run the real-email proof in `docs/password-recovery-support.md`.
- **RPC-level flag enforcement.** With public sign-ups off, the empty-farm risk is closed. As
  defense-in-depth, a later migration could make `bootstrap_first_farm` also require
  `initial_farm_owner`, so the flag is enforced in the database, not just the UI. Not required for
  v1 once sign-ups are disabled.
- **Option (c), the in-app admin screen,** remains the eventual home for onboarding so Mason doesn't
  need Claude in the loop per customer — build it after Fields + Grain reach real customers.
