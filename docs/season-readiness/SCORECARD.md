# Farm Rx 2027 season-readiness scorecard

**Snapshot:** **RELEASE CANDIDATE READY**; the six-scenario synthetic/disposable release packet remains accepted at `8a9565a08a760e0ec920170bfacee1d9132cba47`; worker-free recovery plus both PR-review repair rounds remains accepted at source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555` with governed source-closeout tip `5f2733e167edd4c420427e4ade14b761d6e9b7a7`; PR #17 merged as exact `main` `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`, exact production deployment `dpl_AgNouFqbBnCehg8DFb3xpjJaJuny` is healthy, and stale-client retirement plus recovery domain/DNS/TLS/Auth/final-email/disposable-cleanup proof is complete; only both physical-phone gates remain open; explicitly not **COMPLETE**
**Controlling contract:** [`../GOAL.md`](../GOAL.md), [`WORKFLOWS-AND-SCENARIOS.md`](WORKFLOWS-AND-SCENARIOS.md), [`ORCHESTRATOR-RUNBOOK.md`](ORCHESTRATOR-RUNBOOK.md), and append-only [`LEDGER.md`](LEDGER.md)

This file is a current-state index, not proof by itself. It must never upgrade a lane based on chat, intent, a committed test that was not run, or a result from a different HEAD.

## Status key

| Status | Meaning |
|---|---|
| **PROVEN** | Durable repository evidence records the required runtime/database/browser proof and fresh Sol acceptance for the identified immutable commit. This does not imply the current HEAD or release is proven. |
| **STATIC-ACCEPTED** | Contract, source, or harness shape was reviewed and accepted, but the required runtime evidence is absent or incomplete. |
| **RUNTIME-BLOCKED** | The lane exists but a named environment, fixture, browser, or evidence blocker prevents acceptable runtime proof. |
| **PRODUCT-BLOCKED** | An existing claimed workflow has a concrete behavior or trust defect that must be repaired and proven. |
| **UNMAPPED/UNBUILT** | Required mapping or executable proof is not durably present. |
| **APPROVAL-GATED** | Work requires Mason's explicit outward-action approval under the runbook. |
| **AUTHORIZED / PENDING** | Mason explicitly authorized the exact named action, but execution has not started or has no credited result. |
| **AUTHORIZED / IN PROGRESS** | Mason explicitly authorized the exact named action and its controlled execution has begun, but completion is not yet credited. |
| **EXACT AUTHORIZATION ONLY** | Only the specifically named live mutations are authorized; adjacent or broader actions remain approval-gated. |
| **PARTIAL** | Earlier evidence is proven, but the current tranche still lacks its required publication or runtime result. |

## Governance and evidence controls

| Lane | Status | Authoritative evidence / missing proof |
|---|---|---|
| Goal, no-feature-expansion boundary, scenario contract, deterministic manifest, Sol/Terra orchestration, approval gates | **STATIC-ACCEPTED** | Governance review chain culminated at `381306e2824619921f8eab1235158c9b482c188b`; SR-001 records fresh Sol PASS and its limits. |
| January accepted evidence packet | **PROVEN** | SR-003/SR-004 record browser, local DB, exact clock, regressions/build, and fresh Sol review at January proof HEAD `0238361192b7fa23d67956f43ffbf74be64c4022`. The cash-bid evidence is limited exactly as corrected in SR-004. |
| February–June accepted evidence packet | **PROVEN** | SR-005 records one-reset continuous January–June browser/database proof, generated disposable local authentication, build/regression and database verifiers, and fresh exact-commit Sol PASS at `53e8d2d380907b7bf56da599362ec8254d3ef2a0`. |
| Exact combined integration ladder | **PROVEN** | Exact commit `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279` passed forced TypeScript, regression/post-regression, build, zero-vulnerability high audit, foundation, season contract/isolation, focused clock/timeout/classifier guards, and the complete sequential Maple/North/Pine disposable packets. Fresh-context Sol returned **ACCEPT** with no P1/P2. This proves only those three combined local synthetic lanes, not the full release matrix. |
| Exact accepted source/runtime release ladder | **PROVEN** | SR-035/SR-036 record the six bounded PR-review repairs, forced TypeScript over all 14 root Playwright configs, regression/post-regression, build, zero-vulnerability high audit, season/foundation and mutation proof, all six disposable packets with final PASS markers, cleanup, and fresh-context read-only Sol **ACCEPT** with no P1/P2 at exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`. This establishes **RELEASE CANDIDATE READY** only under the local synthetic/emulated definition in [`../GOAL.md`](../GOAL.md); it does not establish **COMPLETE** or credit outward action. |
| Exact accepted password-recovery hardening ladder | **PROVEN** | SR-041/SR-042 preserve predecessor acceptance through `2c4fadb1`; SR-044 records controlling source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555`: complete foundation PASS, audit/build/regression, 25/25 mutation rejection, disposable backend/RLS proof, 62 browser passes with 14 intentional skips, focused enabled-email Chromium 11/11, season-contract PASS, and fresh-context read-only Sol **ACCEPT — no merge blockers**. Governed source-closeout tip `5f2733e167edd4c420427e4ade14b761d6e9b7a7` also received fresh Sol acceptance, then PR #17 merged both as exact `main` `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`. SR-045 records exact production and live customer-zero recovery proof without expanding the accepted source claim. |
| Maple Ridge full-year evidence packet | **PROVEN** | SR-027 preserves the historical accepted January–December packet. SR-035/SR-036 record the complete continuous packet rerun, exact December assertions, mutation rejection proof, and fresh acceptance inside unified exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`. |

## Maple Ridge continuous year

The required Maple run resets once before January and preserves the same disposable database through December. A month-level status never proves that continuous invariant unless the evidence packet records it.

| Month | Status | Commit / current evidence | Required next proof or blocker |
|---|---|---|---|
| January | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the one-reset continuous packet from January; SR-003/SR-004/SR-027 retain historical evidence. | No Maple month blocker; retain exact full-year continuity in any later packet. |
| February | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the source-real Program assignment and focused database assertions. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| March | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the source-real Inventory receipt and exact database assertions. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| April | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the inspected-and-cancelled no-write lane. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| May | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the exact applied Program pass and phone-sized read-only result. | No Maple month blocker. |
| June | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the Inventory/compliance boundary continuously with accepted confirmed-save semantics and exact identities. | No Maple month blocker. |
| July | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the governed `2027-07-09 21:10:00+00:00` scouting/task writes, SQL fences, and phone read-only/no-overflow lane. | No Maple month blocker. |
| August | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran retained manual-task completion, rapid double-submit defense, stale replay no-op, SQL fence, and phone lane at `2027-08-17 18:00:00+00:00`. | No Maple month blocker. |
| September | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the exact 30,800-bushel harvest once, same-receipt replay, SQL fence, and phone lane at `2027-09-28 23:05:00+00:00`. | No Maple month blocker. |
| October | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran the exact estimate, explicit harvest reconciliation, lost-success recovery, non-coupling fences, and phone lane at `2027-10-19 13:40:00+00:00`. | No Maple month blocker. |
| November | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran step-exact independent bin, inbound, contract, outbound, and delivery actions plus raw phone state at `2027-11-10 17:25:00+00:00`. | No Maple month blocker; Grain semantics remain explicit and non-coupled. |
| December | **PROVEN** | SR-035/SR-036 and unified exact commit `8a9565a` reran full-year reconciliation, exact 11-receipt and 32,000/30,800-bushel SQL, twelve read-only module/concurrency lanes, zero startup writes, and phone no-overflow at `2027-12-15 15:30:00+00:00`. | No Maple month blocker; this is browser emulation, not physical-device proof. |

## Governed scenario gauntlets

| Scenario | Status | Current blocker / missing evidence |
|---|---|---|
| NF — North Fork permissions/privacy | **PROVEN** | SR-035/SR-036 record complete NF1–NF8 browser/database proof and final `NORTH_FORK_2027_DISPOSABLE_PASS` at unified exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`: deterministic exact owner timestamps, owner/farm switching, explicit rep sharing, role limits, stale-rep and outsider denial, exact writes/non-writes, mutation rejection, cleanup, and fresh Sol acceptance. This does not change or prove live permissions. |
| PS — Prairie Spray compliance presence | **PROVEN** | SR-035/SR-036 record the desktop create/replay and emulated-phone read-only packet at unified exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`: deterministic fixture authentication, exact application/product identities, `100.00` to `92.50` gal arithmetic, same-payload replay with one application/product, named non-writes, Compliance details, no overflow, and loopback-only browser traffic. This proves stored snapshot presence only and makes no applicator-license eligibility, validity, or expiration claim. |
| HR — Harvest Ridge Grain truth | **PROVEN** | SR-035/SR-036 record the governed packet at unified exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`: harvest, explicit Grain reconciliation, proof-created bin/inbound, proof-created contract, independent bin Out and contract delivery, reverse order, exact replay identities/timestamps/balances/associations, row-specific non-writes, and emulated-phone read-only proof. Harvest reconciliation, bin movements, contracts, and deliveries remain explicit, separate, non-coupled actions. |
| CC — Cedar Creek weather/scouting | **PROVEN** | SR-035/SR-036 record the deterministic desktop and 390-by-844 packet at unified exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`: deterministic fixture authentication, manual payload-free weather transcription, one truthful spray application/product despite duplicate submit, exact `20` to `15` gal inventory, one scouting note and durable receipt, authorized RPCs only, and clean recovery. It adds no weather-to-spray provenance, integration, or automatic prefill. |
| PH — Pine Hill offline/recovery | **PROVEN** | SR-035/SR-036 record the complete reset/reconnect/revocation packet at unified exact commit `8a9565a08a760e0ec920170bfacee1d9132cba47`, including deterministic fixture authentication, three variants, corrupt-active and corrupt-vault fail-closed checks, exact queue bytes, SQL/security fences, final pass, cleanup, and fresh Sol acceptance. This is local synthetic browser/database proof only. |

## Browser and environment matrix

| Matrix lane | Status | Evidence requirement |
|---|---|---|
| Playwright desktop, Maple January | **PROVEN** | SR-035/SR-036 record the one-reset continuous January lane rerun at unified exact commit `8a9565a`; SR-003 retains its historical proof. |
| Playwright phone-sized, Maple January | **PROVEN** | SR-035/SR-036 record the phone-sized January lane rerun at unified exact commit `8a9565a`; this is emulation, not a physical phone. |
| Playwright desktop, Maple February–June | **PROVEN** | SR-035/SR-036 record all five continuous desktop lanes passing at unified exact commit `8a9565a`; SR-005 retains historical evidence. |
| Playwright phone-sized, Maple February–April | **UNMAPPED/UNBUILT** | The unified packet does not add February–April phone-sized scenarios. No physical or emulated phone proof is inferred from desktop coverage. |
| Playwright phone-sized, Maple May–June | **PROVEN** | SR-035/SR-036 record May Program and June Inventory/compliance read-only phone-sized results at unified exact commit `8a9565a`; this is emulation, not a physical phone. |
| Playwright desktop + phone, Maple July | **PROVEN** | SR-035/SR-036 record the desktop scouting/task writes and 390-by-844 read-only/no-overflow/zero-mutation lane at unified exact commit `8a9565a`; this is browser emulation. |
| Playwright desktop + phone, Maple August–December | **PROVEN** | SR-035/SR-036 record continuous desktop actions and 390-by-844 read-only/no-overflow/zero-mutation coverage under all five governed clocks at unified exact commit `8a9565a`; this is browser emulation. |
| Playwright desktop + phone, PS | **PROVEN** | SR-035/SR-036 record desktop manager-create/replay and phone-sized Compliance read-only/no-overflow at unified exact commit `8a9565a`; this is browser emulation and proves stored presence, not license validity. |
| Playwright desktop + phone, HR | **PROVEN** | SR-035/SR-036 record desktop actions and 390-by-844 Grain, Storage, and Contracts read-only/no-overflow/zero-mutation at unified exact commit `8a9565a`; this is browser emulation and retains explicit non-coupling. |
| Playwright desktop + phone, NF | **PROVEN** | SR-035/SR-036 record role/privacy sequences and phone-sized read-only/no-overflow checks at unified exact commit `8a9565a`; this is browser emulation, not live-auth or physical-device proof. |
| Playwright desktop + phone, PH | **PROVEN** | SR-035/SR-036 record offline/reconnect/revocation/recovery variants, byte assertions, and phone-sized checks at unified exact commit `8a9565a`; this is disposable-backend browser emulation. |
| Playwright desktop + phone, CC | **PROVEN** | SR-035/SR-036 record root and independent Sol desktop plus 390-by-844 packets exiting `0` with final Cedar pass, direct selected-tab visibility, exact browser/database outcomes, loopback-only traffic, and acceptance at unified exact commit `8a9565a`; this is browser emulation. |
| Recovery-origin and canonical-session matrix | **PROVEN** | SR-044 records exact `9ecc6cb`: the isolation, cleanup, retry, session-preservation, thrown/discarded storage-preflight, visible honest alert, and zero-provider-request automation. The full run passed 62 browser scenarios with 14 intentional skips and focused enabled-email Chromium passed 11/11. SR-045 adds the final live external-Chrome journey on exact production `4b4dae7`: every known stale proof client retired, recovery origin uncontrolled with zero service-worker registrations, real email and password update succeeded, canonical re-login with the new password succeeded, and used-link reuse failed as `otp_expired`. This is not physical-device proof. |
| Physical iPhone/Safari installed-PWA journey | **UNMAPPED/UNBUILT** | Must be performed and recorded on a physical device before COMPLETE; no proof exists. Any customer account, auth change, or outward/live action used for it is separately **APPROVAL-GATED**. |
| Physical Android/Chrome installed-PWA journey | **UNMAPPED/UNBUILT** | Must be performed and recorded on a physical device before COMPLETE; no proof exists. Any customer account, auth change, or outward/live action used for it is separately **APPROVAL-GATED**. |

## Outward and operational gates

| Gate | Status | Current truth |
|---|---|---|
| Custom SMTP and real password-email delivery | **PROVEN** | Exact production `VITE_PASSWORD_EMAIL_DELIVERY_ENABLED=true` and configured SMTP remain in force. SR-045 records the final post-repair external-Chrome journey: `/auth/v1/recover` returned `200`, the real signed email targeted exact `https://recovery.croprxsolutions.app/update-password`, password update and canonical clean login succeeded, and link reuse failed closed as `otp_expired`. No customer communication occurred. |
| Push / pull request / merge | **PROVEN** | PR #17 exact head `5f2733e167edd4c420427e4ade14b761d6e9b7a7` passed foundation, CodeRabbit, Vercel, and Vercel Preview checks and merged to `main` as exact `4b4dae787afbd013a79d4edc05d8aebfbb0d5257` at `2026-08-01T23:48:02Z`. Accepted source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555` is an ancestor of both. |
| Production deployment authority | **PROVEN** | SR-042 records Mason's separate exact authority for PR #17's production-coupled merge and automatic Vercel deployment. That authorized action occurred and is recorded in SR-045. Any different deploy, promotion, rollback, or future outward action still requires separate authority. |
| Production deployment identity and public HTTP health | **PROVEN** | Vercel API/CLI re-verification returned deployment `dpl_AgNouFqbBnCehg8DFb3xpjJaJuny`, exact Git SHA `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`, ref `main`, target `production`, and `READY`; `farm-rx.vercel.app` and exact recovery hostname resolve to that deployment, and fresh HTTPS requests returned HTTP `200`. |
| Recovery domain, DNS, TLS, and Supabase redirect | **PROVEN** | `recovery.croprxsolutions.app` is verified on the same Vercel project, public DNS resolves its CNAME to `cname.vercel-dns.com`, and HTTPS `/update-password` serves Farm Rx with HTTP `200`. Supabase Site URL remains exact `https://farm-rx.vercel.app`; the four prior redirect URLs remain and exact `https://recovery.croprxsolutions.app/update-password` is the fifth allowlisted URL. |
| Exact authorized recovery Auth actions | **PROVEN** | Only the exact authorized Auth actions occurred: the recovery redirect was added, one disposable Auth user was created for the journey, and that exact UID/email was then permanently deleted. A read-only `auth.users` query returned three total users, zero disposable UID/email matches, and all three expected original users. |
| Other live migration, live data, secrets, auth, permissions, customer accounts or communication | **APPROVAL-GATED** | No live migration, customer data, permanent farm access, real farmer account, broader auth/permission/secret change, or customer communication occurred or is credited. Any such future action requires separate authority. |
| Repository publication and public HTTP verification | **PROVEN** | PR #17 publication/merge and exact production deployment `dpl_AgNouFqbBnCehg8DFb3xpjJaJuny` at `4b4dae787afbd013a79d4edc05d8aebfbb0d5257` are proven; `origin/main` equals that merge before this documentation-only closeout. Public canonical and recovery routes returned HTTP `200`. |

## Update procedure

1. Read the controlling contract and append-only ledger; inspect the exact current branch, HEAD, worktree, migrations, manifests, harnesses, and evidence files.
2. Change a status only from durable evidence for the exact identified commit. Chat-reported runs or verdicts may locate work but cannot establish **PROVEN**.
3. For every runtime claim, record command and exit code, exact SHA and parent, migration/manifest hashes, simulated instant, role/farm/network, browser project/viewport, UI evidence, focused database writes/non-writes, artifact paths, scope/credential checks, and fresh read-only Sol verdict.
4. Append a new ledger entry or correction; never rewrite prior ledger history. A repair is a new immutable commit and receives a new fresh-context Sol review.
5. Re-evaluate the full 11-step verification ladder on the resulting exact HEAD. Month passes do not imply full-year or release readiness.
6. Never convert **APPROVAL-GATED** based on silence or prior local authority. Record the exact approved action and its actual result after it occurs.

The initiative is **RELEASE CANDIDATE READY** for the accepted six-scenario packet at `8a9565a08a760e0ec920170bfacee1d9132cba47` and the accepted recovery repair chain at source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555`. PR #17 publication/merge, exact production deployment, customer-zero stale-client retirement, recovery domain/DNS/TLS, exact Supabase redirect, final no-bypass external-Chrome/email proof, used-link failure, clean re-login, and disposable-user cleanup are now performed and recorded in SR-045. Only the physical iPhone/Safari and Android/Chrome installed-PWA journeys remain unperformed, so Farm Rx is explicitly not **COMPLETE**. Any different publish, deploy, Auth, live-service, customer, or destructive action remains separately approval-gated.
