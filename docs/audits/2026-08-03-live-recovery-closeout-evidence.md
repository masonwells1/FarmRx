# Farm Rx live recovery closeout evidence index

**Observed:** 2026-08-01 through 2026-08-03 (`America/Chicago`)
**Repository base:** `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`
**Accepted recovery source:** `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555`
**Governed source-closeout tip:** `5f2733e167edd4c420427e4ade14b761d6e9b7a7`

This redacted index separates durable server/repository evidence from operator-observed browser facts. It contains no password, session token, recovery token, API key, cookie, or signed-link query value. Browser facts marked **OPERATOR-OBSERVED** are not promoted to the scorecard's **PROVEN** status by themselves.

## Durable repository and deployment evidence

| Check | Read-only evidence | Result |
|---|---|---|
| PR publication | `gh pr view 17 --json ...` | PR #17 exact head `5f2733e167edd4c420427e4ade14b761d6e9b7a7`; foundation, CodeRabbit, Vercel, and Vercel Preview checks succeeded; merged at `2026-08-01T23:48:02Z`. |
| Merge identity | GitHub commit API plus `git rev-parse origin/main` | Exact merge `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`; parents `45dc52f425ee844a0ddc473d514cce748e61c559` and `5f2733e167edd4c420427e4ade14b761d6e9b7a7`. |
| Production identity | `vercel api /v13/deployments/dpl_AgNouFqbBnCehg8DFb3xpjJaJuny` | `READY`, target `production`, Git SHA `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`, ref `main`. |
| Recovery domain | Vercel project-domain API | `recovery.croprxsolutions.app` exists on project `farm-rx` and is verified. |
| Public DNS | `Resolve-DnsName recovery.croprxsolutions.app -Type CNAME` | CNAME target `cname.vercel-dns.com`. |
| HTTPS route | `Invoke-WebRequest https://recovery.croprxsolutions.app/update-password` | HTTP `200`; response contained the Farm Rx application shell. |
| Supabase URL configuration | authenticated read-only dashboard inspection | Site URL remained `https://farm-rx.vercel.app`; the four prior redirect URLs remained; exact `https://recovery.croprxsolutions.app/update-password` is the fifth URL. |

## Durable Supabase Auth event chain

The Supabase Auth log service was queried read-only after the journey. The following event identifiers, times, methods, paths, and statuses are redacted of network addresses and all token material.

| UTC time | Event ID | Durable server fact |
|---|---|---|
| `2026-08-03T13:28:30Z` | `f917d1f4-c2a9-4745-a267-9ac6090720d2` | `user_recovery_requested`; `POST /recover`; status `200`; referer was exact recovery `/update-password`. |
| `2026-08-03T13:29:20Z` | `bc538d25-43ff-4ae8-8abd-55fbcf69a088` | Recovery verification completed with `GET /verify`; status `303`; exact recovery `/update-password` referer; corresponding implicit login was recorded for the disposable UID. |
| `2026-08-03T13:33:24Z` | `7050e152-7104-4b2e-a431-ec05f47dd46f` | `user_modified`; `PUT /user`; status `200` for the disposable UID. A subsequent password-grant login below corroborates that the new credential was accepted. |
| `2026-08-03T13:34:34Z` | `9313bbdb-59b1-4517-b473-6403d27aab35` | Reused verification failed with `403: Email link is invalid or has expired`; server error `One-time token not found`. |
| `2026-08-03T13:53:27Z` | `004cd177-c3f4-4bbd-9b55-d3f0b512123c` | Password-grant `POST /token`; status `200`; login action recorded for the disposable UID from the canonical Farm Rx referer. |
| `2026-08-03T13:57:09Z` | `5d1f5285-e467-4112-bd79-a21418c8a451` | `user_deleted`; `DELETE /admin/users/eee61720-933e-474b-867e-9bb8369d4586`; status `200`. |

## Durable deletion and non-provisioning checks

After deletion, a read-only aggregate query against `auth.users` returned:

- `total_users=3`
- `disposable_uid_matches=0`
- `disposable_email_matches=0`
- `expected_original_matches=3`

Fresh-context read-only Sol additionally found zero references to the disposable UID across the identified public user/creator columns. The three retained Auth emails were `farmrep@croprxsolutions.com`, `farmtest@croprxsolutions.com`, and `farmworker@croprxsolutions.com`.

Supabase did not retain a `user_created` event or a complete creation-window audit result for this tranche. The operator directly observed creating only this disposable identity, but that creation-count boundary is **OPERATOR-OBSERVED** and is not promoted to **PROVEN**. Durable evidence proves the exact UID's later recovery chain, deletion, final three-user Auth state, and absence from the identified public references only.

## Operator-observed external-Chrome facts

The following were directly observed in external Chrome during the same event chain but do not have a committed screenshot, trace, HAR, or mailbox export. They are recorded as **OPERATOR-OBSERVED**, not as independent **PROVEN** evidence:

- the recovery message arrived in the real mailbox from the configured Farm Rx Auth sender;
- the signed message opened exact `https://recovery.croprxsolutions.app/update-password`;
- the fresh recovery page reported no controlling service worker and zero registrations;
- password completion handed off to canonical Farm Rx sign-in;
- the reused-link page visibly rendered the invalid/expired/already-used state matching the server `403` event;
- clean new-password login reached Farm Rx, which displayed the missing-farm-setup boundary for the disposable identity; and
- the disposable session was signed out before permanent deletion.

## Evidence limits

This index does not prove a physical iPhone/Safari or Android/Chrome installed-PWA journey. It does not credit a live migration, customer data, permanent farm membership, a real farmer account, customer communication, broader Auth/permission/secret work, or a manual deployment/promotion/rollback. Weather-to-spray remains manual payload-free transcription with no provenance link, integration, or automatic prefill.
