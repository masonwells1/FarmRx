# Farm Rx customer-zero readiness runbook

**Purpose:** prove that one real farmer can use the complete Farm Rx loop on real phones without
coaching, false success, lost work, or uncertainty about who can see private grain information.

Run this with one disposable owner, worker, and named-rep account on one test farm. Use an iPhone
with Safari and an Android phone with Chrome. Do not use irreplaceable production records.

## Preflight

- Record the deployed Git SHA, Vercel deployment URL, Supabase project, date, tester, devices, OS,
  browser, and network.
- Confirm the farm's **Share my grain position with my Crop RX rep** setting starts **OFF**.
- Confirm all three accounts and their intended roles before storing any test records.
- Confirm password-recovery SMTP and the exact production redirect are configured.
- Provision the disposable owner through `scripts/provision-customer.mjs` with no email command
  argument; enter its email only at the secure prompt. Confirm the script emits no password and the
  farmer chooses their first password from only the newest setup email.
- Keep screenshots free of customer secrets, passwords, reset links, and private financial values.

## Farmer journey

1. Install Farm Rx to each phone's home screen and launch it as an installed PWA.
2. Sign in as the owner from a fresh device. Select the test farm and open **Fields**.
3. Make one realistic field edit. Drop connectivity during save, keep the app open, reconnect, and
   prove the exact saved-work receipt. Confirm the record belongs only to the selected farm.
4. Open **Grain**, enter a realistic but disposable position, and ask the farmer to explain the
   displayed production, priced percentage, open bushels, and disclaimer in their own words.
5. Open **Farm privacy**. Prove sharing is OFF and the named rep cannot open the farm.
6. As the owner, deliberately turn sharing ON after reading the confirmation. Prove the assigned,
   enabled, unrevoked named rep can open Grain but cannot edit or manage the farm.
7. Turn sharing OFF. Prove the rep loses access after revalidation and a stale rep tab cannot keep
   reading or writing with its old access epoch.
8. Sign in as the worker. Prove operational modules work while Grain and private financials remain
   unavailable. Revoke the worker while their phone is offline; preserve any unsent work visibly,
   but never upload it to another farm or account after reconnect.
9. Complete first-password setup and later password recovery once each. Prove expired/reused links
   fail, recovery never becomes an ordinary session, and revoked farm access does not return.
10. Close the PWA and exercise one real push notification. Reopen under weak signal and low device
    storage. Confirm cached pages, pending work, and recovery wording stay truthful.

## Usability observation

Record every point where the farmer:

- asks what a word means;
- needs Mason to explain the next step;
- misses a control in sunlight or with gloves;
- taps more than twice for a common action;
- believes an unconfirmed save succeeded;
- cannot tell which farm/account owns pending work; or
- cannot state whether Crop RX can see their grain position.

## Evidence record

| Step | Device/account | Result | Evidence | Follow-up owner |
|---|---|---|---|---|
| Install/sign-in | | | | |
| Field edit + weak signal | | | | |
| Grain understanding | | | | |
| Sharing OFF | | | | |
| Sharing ON + rep access | | | | |
| Sharing OFF + stale rep | | | | |
| Worker revoke offline | | | | |
| First password + recovery | | | | |
| App-closed push | | | | |
| Low storage/cache | | | | |

## Exit criteria

Customer zero is complete only when:

- the farmer completes the owner journey without coaching;
- privacy OFF/ON/OFF is proven across real owner and rep sessions;
- the worker and stale-session revocation cases fail closed without losing local evidence;
- first-password setup, later recovery, and installed-PWA behavior work on both phone families;
- every observed confusion has an owner and disposition; and
- the evidence record names the exact deployed SHA and contains no secrets.

Automated browser and disposable-database checks support this runbook, but they do not replace the
two physical phones or the farmer's uncoached explanation.
