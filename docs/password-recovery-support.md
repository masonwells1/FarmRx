# Farm Rx first-password and password-recovery support

This runbook covers the first-password email sent by `scripts/provision-customer.mjs`, **Forgot
password?**, and `/update-password`. It does not use public sign-up or invite completion.

## Production prerequisites

Before releasing the feature:

1. In the Farm Rx Supabase project (`agvsozfbstpekuqxpqjr`), allow the exact redirect
   `https://farm-rx.vercel.app/update-password`.
2. Confirm the Auth site URL remains `https://farm-rx.vercel.app`.
3. Configure and verify custom SMTP. Supabase's default sender is test-rate-limited and is not a
   dependable customer support channel.
4. Send a recovery message to a disposable non-production customer account and verify the link,
   sender, subject, delivery time, and mobile rendering.
5. Never place SMTP credentials, service-role keys, or customer passwords in this repository.

Current read-only production evidence from 2026-07-18: the Auth site URL is
`https://farm-rx.vercel.app`; the redirect allowlist contains that origin, its wildcard, and local
development entries; public sign-up is disabled; email auth is enabled; automatic confirmation is
off; and SMTP host, user, and sender are all unconfigured. The wildcard covers `/update-password`,
but missing custom SMTP blocks enabling email delivery and onboarding a real customer. It does not
block merging the default-off code guards. Do not change live Auth settings without a separate
approved production action.

Until that action and a real delivery test pass, the production-safe defaults are:

- `VITE_PASSWORD_EMAIL_DELIVERY_ENABLED` is absent or not `true`, so sign-in shows honest help
  guidance instead of a reset form that cannot deliver.
- `FARM_RX_AUTH_EMAIL_DELIVERY_READY` is absent or not `true`, so the provisioning CLI refuses to
  create or resend an account.

After SMTP is proven, set the Vite flag to `true` in the approved deployment environment and set
the CLI readiness flag to `true` only in the trusted provisioning terminal session. The exact
case-sensitive string is required; other values remain off.

These are live authentication settings. They require a separate production-change record and
post-change proof; merging frontend code does not configure them.

## What the farmer sees

- The public response is identical whether the email exists or not: if an account matches, a link
  will be sent. This prevents account discovery.
- A valid recovery link opens **Choose a new password**.
- Expired, malformed, reused, non-recovery, closed, or refreshed recovery pages fail closed and
  offer **Request a new link** plus Crop RX representative guidance.
- The recovery credential stays only in the current page's memory. The farmer must keep that page
  open until the update completes; closing or refreshing it requires a fresh link. Returning to a
  browser-cached copy revalidates the exact owner lease and fails closed after that lease was revoked.
- Other Farm Rx tabs receive Supabase's recovery notification but cannot adopt it or clear the
  recovery page's owner lease; an existing ordinary session remains unchanged.
- Completing recovery returns the farmer to normal sign-in. The recovery session is never treated
  as an ordinary Farm Rx session.
- A newly provisioned owner uses the same narrow recovery capability to choose the first known
  password. The script's bootstrap secret is never printed, returned, emailed, or relayed.
- Resetting a password does not create or restore farm membership. Revoked farm access stays
  revoked.

## Support checklist

### No email arrived

1. Ask the farmer to wait two minutes and check spam/junk.
2. Confirm the address they typed, without confirming whether an account exists.
3. Check Supabase Auth delivery logs and SMTP provider delivery/bounce events.
4. Fix a bounced or blocked address at the mail provider; do not manually reveal or assign a
   password.
5. Let the farmer request one new link after the mail issue is fixed. Avoid repeated requests that
   trigger rate limits.
6. If this was first-password setup and the account was already created, run
   `node scripts/provision-customer.mjs --resend-setup` and enter that same email only at the
   prompt. It must prove the existing account has the protected `initial_farm_owner` flag before
   sending; never create a duplicate or disclose a bootstrap secret.

### Link expired or was already used

1. Return to sign-in and choose **Forgot password?**.
2. Request a new link and use only the newest message.
3. Keep the new recovery page open until the password update finishes. Closing or refreshing the
   page intentionally invalidates the in-memory recovery session.
4. Close older recovery tabs. A recovery link is a sensitive, one-purpose credential.

### Password was changed but sign-in still fails

1. Confirm the farmer is using the new password and the same email address.
2. Ask them to close old Farm Rx tabs and open the production URL again.
3. Check Auth logs for a disabled, deleted, or otherwise blocked account.
4. If sign-in works but the farm does not open, investigate membership/access separately. Do not
   use password recovery to repair authorization.

## Release proof

- Known and unknown emails show the same public response.
- Provisioning sends the first-password email without exposing a password; a partial mail failure
  has a tested, owner-validated resend path.
- Valid recovery succeeds once on both phone and desktop.
- Expired, reused, malformed, and ordinary sign-in links cannot update a password.
- Recovery credentials remain memory-only in the page that received `PASSWORD_RECOVERY`; closing,
  refreshing, or navigating away revokes that page's unique owner lease, remains signed out, and
  requires a fresh link. A hard browser crash that cannot run close cleanup expires after ten
  minutes, and the next coordinated sign-in prunes only that stale lease.
- A back/forward-cache restore cannot revive a ready-looking form after pagehide revoked its exact
  owner lease; submission is disabled before the isolated password updater can run.
- A later token refresh or user-update event cannot resurrect the completed recovery capability.
- Two tabs cannot complete competing password updates or sign in under different accounts.
- A recovery broadcast to an ordinary tab neither signs it into the recovery account nor clears the
  real recovery owner's capability.
- Revoked farm access remains revoked after the password changes.
