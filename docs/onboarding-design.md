# Farm Rx — Customer Onboarding Design (v1)

**Design status:** design only. This session changed no application code, no database, no
Supabase settings, and ran no git. It reads the applied schema (migrations 0001–0014),
`src/App.tsx`, and `src/auth/bootstrapFarm.ts` and specifies exactly how Crop RX provisions a
real farmer. Nothing here is "done" until Mason (or Claude in a session) runs it and watches a
real farmer sign in and name their farm.

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
and hands you a starting password to give the farmer.

**Your per-customer checklist (about 2 minutes):**

1. Get the customer's email address and their farm's name.
2. In a Claude session, say: *"Provision a Farm Rx customer: `farmer@email.com`."* Claude runs the
   provisioning script.
3. The script prints the email + a one-time starting password. **Call or text the farmer** and
   give them the email + password (don't email the password to them).
4. Tell the farmer: open Farm Rx, sign in, then type your farm name and operating name on the
   "Set up your farm" screen. That's it — their farm exists and is private to them.
5. You watch it work once (have them sign in while you're on the phone), then you're done.

**Two safety switches to flip once (see the end of this doc):** turn **off** public sign-ups and
turn **on** leaked-password protection in the Supabase dashboard. These are one-time settings, not
per-customer.

---

## What exists today vs. what's missing

**Verified against the code and applied migrations:**

| Piece | State |
|---|---|
| Login screen (email + password sign-in) | **Exists.** `LoginPage` in `src/App.tsx`. No sign-up, no password-reset, no set-password screen. |
| Session restore / stay-signed-in | **Exists.** `AuthProvider` + `RequireSession`. |
| "Set up your farm" form for a new owner | **Exists** — `InitialFarmSetup` in `src/App.tsx`, shown by `FarmAccessGate`. |
| Gate that decides who sees the setup form | **Exists.** `FarmAccessGate` shows it only when `user.app_metadata.initial_farm_owner === true` **and** the account has zero farms. Otherwise it shows *"Crop RX needs to finish your farm setup."* |
| Farm-creation RPC | **Exists and applied** (migration 0009). `public.bootstrap_first_farm(p_farm_name, p_entity_name, p_entity_type)` — idempotent, binds owner to `auth.uid()`, the 0002 trigger adds the owner membership. Called by `bootstrapInitialOwnerFarm` in `src/auth/bootstrapFarm.ts`. |
| A way to **create the auth user** | **Missing from the app** (by design — no self-serve). Must be done by Crop RX out-of-band. |
| A way to **set `initial_farm_owner`** on that user | **Missing.** This is the crux (see below). |
| Set-password / password-reset / invite-completion screen | **Missing.** Foundation-design notes it as a "separate scoped flow" not yet built. |

**The crux — the hidden flag:** `FarmAccessGate` (App.tsx line ~123) requires
`user.app_metadata.initial_farm_owner === true` before it will show the setup form. `app_metadata`
is a **protected** field in Supabase: it is **not** editable from the dashboard's Users UI, and
the public sign-up endpoint cannot set it either. It can only be set by the **Admin API** (service-
role key) or a direct SQL update to `auth.users.raw_app_meta_data`. **Any onboarding method that
can't set this flag leaves the farmer stuck on "Crop RX needs to finish your farm setup."** This is
why the pure-dashboard option (a) does not actually work end-to-end today, and why a small script
(option b) is the right v1.

---

## Security assessment — the open public-signup endpoint

**Today's settings (as given):** Supabase Auth allows public sign-ups with email confirmation
required; leaked-password protection is OFF. That means anyone holding the **publishable** key
(which ships inside the app to every user — that's normal and fine on its own) can hit
`POST /auth/v1/signup` and create an account, and after confirming their own email, sign in.

**Can a stranger reach any farm data? No.** Row-Level Security (migration 0002) is the wall:

- `farms_select` uses `can_access_farm(id)` → active membership **or** an enabled named-rep grant.
  A brand-new stranger has neither, so **zero farm rows** are returned.
- Every child table (`entities`, `fields`, `crop_assignments`, `arrangements`, and the
  Grain/Inventory/Profitability tables in later migrations) has the same parent check. All return
  nothing.
- The **only** table a member-less signed-in user can read is `commodities` — a global crop-name
  lookup with no farm or financial data. Harmless.

**So what *is* the risk?** Two real but lower-severity problems, both about abuse of *Mason's*
project rather than a data leak:

1. **Stranger self-provisioning an empty farm.** `bootstrap_first_farm` is granted to any
   `authenticated` user and only checks that the caller has no membership — it does **not** check
   `initial_farm_owner`. The app's UI gate checks that flag, but a determined attacker can call the
   RPC directly with the publishable key + their own confirmed session and create their **own**
   empty farm (and owner membership) on Mason's project. They still can't see anyone else's data —
   but they can litter the free-tier project with junk farms.
2. **Account-creation spam.** Open sign-up lets bots create confirmed accounts, burning free-tier
   quota and auth email sends.

**Recommendation: disable public sign-ups for v1.** It closes both risks at the source: with the
sign-up endpoint off, no stranger can obtain an account at all, so `bootstrap_first_farm` becomes
unreachable by strangers, and the empty-farm and spam vectors both disappear. This costs nothing —
the owner-provisioned model never uses public sign-up, and the **Admin API still creates users with
sign-ups disabled** (the toggle only blocks the public endpoint, not admin creation). This is the
single most important hardening step in this document.

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
A ~30-line Node script using the service-role key, run from Mason's machine (by Claude in a
session), one command per customer. In a single call it creates the confirmed user, sets
`app_metadata.initial_farm_owner = true`, and produces a starting password. **This is the only
method that works fully end-to-end with zero new app code**, and it's simple, repeatable, and safe
(service key never ships to the app, never committed). **Verdict: ship this.**

### (c) In-app Crop RX admin screen — *post-ship*
A screen inside Farm Rx where Mason adds customers himself. Nicest long-term UX, but it's the most
code: it needs an admin-role design, a secure server function to call the Admin API (the service
key must never reach the browser), and its own testing. Not a v1 blocker. **Verdict: build later,
after Fields + Grain are in front of real customers.**

---

## Recommended v1: the provisioning script (option b)

### Why a starting password instead of an invite/magic-link email
The tidier-sounding "send an invite email" flow **breaks on today's app** because Farm Rx has **no
set-password or invite-completion screen**. A Supabase invite/magic link would sign the farmer in
*once* (the app's `detectSessionInUrl: true` consumes the token), but they'd never set a password
and so **could not sign in again**. Until a "set your password" screen exists, the only path that
lets a farmer sign in *today and every day after* is a real password. So the script creates the
user **already confirmed** with a strong **starting password**, and Mason relays it to the farmer
by phone/text. (Fast-follow below moves this to invites once the small screen exists.)

Password handling stays clean: the **script** generates the random password and prints it for
**Mason** to relay; the **farmer** types it themselves. Claude never types a credential into any
field, and the password is never emailed.

### The script

Save as `C:\FarmRx\scripts\provision-customer.mjs`. It uses `@supabase/supabase-js` (already a
project dependency).

```js
// Provision one Farm Rx customer. Run by Claude from Mason's machine only.
// The service-role key is a SECRET: it is read from the environment, never
// committed, and never shipped to the app. Usage:
//   node scripts/provision-customer.mjs farmer@email.com
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = 'https://agvsozfbstpekuqxpqjr.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = (process.argv[2] || '').trim().toLowerCase()

if (!serviceKey) { console.error('Set SUPABASE_SERVICE_ROLE_KEY first.'); process.exit(1) }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Pass a valid email.'); process.exit(1) }

// Strong, human-typeable one-time password.
const password = randomBytes(9).toString('base64url') + 'A9!'

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,                       // no confirmation email needed; they can sign in now
  app_metadata: { initial_farm_owner: true } // the flag that unlocks the "Set up your farm" screen
})

if (error) {
  // Most common: the email already has an account.
  console.error('Could not create user:', error.message)
  process.exit(1)
}

console.log('\n=== Farm Rx account created ===')
console.log('Email:            ', email)
console.log('Starting password:', password)
console.log('User id:          ', data.user.id)
console.log('initial_farm_owner:', data.user.app_metadata?.initial_farm_owner === true)
console.log('\nRelay the email + starting password to the farmer by phone/text (do not email the password).')
```

**Secret handling (hard rules):**
- The service-role key lives **only** in an environment variable on Mason's machine, e.g. set for
  the session in PowerShell: `$env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."`. Never paste it into
  a file, a commit, or the app.
- Add `scripts/.env` and any local key file to `.gitignore` before this ships. The script itself
  contains no secret and is safe to commit.
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
   environment: `node C:\FarmRx\scripts\provision-customer.mjs farmer@email.com`. It prints the
   email, a one-time starting password, and confirms `initial_farm_owner: true`.
3. **Deliver the credentials.** Call or text the farmer the email + starting password. Do **not**
   email the password.
4. **Farmer signs in and names their farm.** They open Farm Rx, sign in, and the app shows **"Set up
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
- *"That email or password did not work"* → wrong starting password, or the account wasn't created
  confirmed. Re-read the script output; the user must have `email_confirm: true`.
- *"We found more than one farm for this account"* → the account already owns a farm; they don't need
  onboarding, just sign-in.

---

## One-time Supabase dashboard settings to change

Do these **once**, before onboarding real customers. Both are in the Supabase dashboard for the
Farm Rx project (`agvsozfbstpekuqxpqjr`).

1. **Turn OFF public sign-ups.** Authentication → Sign In / Providers → Email (or Auth → Settings,
   depending on dashboard version) → disable **"Allow new users to sign up."** This closes the open
   `/auth/v1/signup` endpoint so strangers can't create accounts or spawn empty farms on your
   project. Admin user creation (the script) keeps working with this off.
2. **Turn ON leaked-password protection.** Authentication → Passwords / Attack Protection → enable
   **"Prevent use of leaked passwords"** (HaveIBeenPwned check). Currently OFF; enabling it stops
   customers from choosing known-breached passwords.
3. **Email confirmation:** leave "Confirm email" required. It becomes moot once sign-ups are off and
   the script creates users with `email_confirm: true`, but there's no reason to relax it.

---

## Known v1 limitations and fast-follows (not blockers)

- **No self-serve password reset or "set/change password" screen.** The starting password is what the
  farmer keeps using until this is added. **Fast-follow #1:** add a small "set your password" screen;
  then switch provisioning from a starting password to Supabase's **invite email** (nicer, no password
  over the phone) — `admin.inviteUserByEmail(email, { data: {...} })` followed by
  `updateUserById(id, { app_metadata: { initial_farm_owner: true } })`, or keep using `createUser`
  and let the farmer set their own password on first sign-in.
- **RPC-level flag enforcement.** With public sign-ups off, the empty-farm risk is closed. As
  defense-in-depth, a later migration could make `bootstrap_first_farm` also require
  `initial_farm_owner`, so the flag is enforced in the database, not just the UI. Not required for
  v1 once sign-ups are disabled.
- **Option (c), the in-app admin screen,** remains the eventual home for onboarding so Mason doesn't
  need Claude in the loop per customer — build it after Fields + Grain reach real customers.
</content>
</invoke>
