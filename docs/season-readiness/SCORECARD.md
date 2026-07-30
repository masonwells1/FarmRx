# Farm Rx 2027 season-readiness scorecard

**Snapshot:** **RELEASE CANDIDATE READY** for local synthetic/disposable-backend and browser-emulation proof at exact immutable source/runtime commit `551d45e6181aad09d9b86150b7209e23324d9651`; SR-032/SR-033 record all six sequential scenario packets and fresh Sol **ACCEPT** with no P1/P2; explicitly not **COMPLETE**
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

## Governance and evidence controls

| Lane | Status | Authoritative evidence / missing proof |
|---|---|---|
| Goal, no-feature-expansion boundary, scenario contract, deterministic manifest, Sol/Terra orchestration, approval gates | **STATIC-ACCEPTED** | Governance review chain culminated at `381306e2824619921f8eab1235158c9b482c188b`; SR-001 records fresh Sol PASS and its limits. |
| January accepted evidence packet | **PROVEN** | SR-003/SR-004 record browser, local DB, exact clock, regressions/build, and fresh Sol review at January proof HEAD `0238361192b7fa23d67956f43ffbf74be64c4022`. The cash-bid evidence is limited exactly as corrected in SR-004. |
| February–June accepted evidence packet | **PROVEN** | SR-005 records one-reset continuous January–June browser/database proof, generated disposable local authentication, build/regression and database verifiers, and fresh exact-commit Sol PASS at `53e8d2d380907b7bf56da599362ec8254d3ef2a0`. |
| Exact combined integration ladder | **PROVEN** | Exact commit `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279` passed forced TypeScript, regression/post-regression, build, zero-vulnerability high audit, foundation, season contract/isolation, focused clock/timeout/classifier guards, and the complete sequential Maple/North/Pine disposable packets. Fresh-context Sol returned **ACCEPT** with no P1/P2. This proves only those three combined local synthetic lanes, not the full release matrix. |
| Exact accepted source/runtime release ladder | **PROVEN** | SR-032/SR-033 record forced TypeScript, regression/post-regression, build, zero-vulnerability high audit, season/foundation and focused guard proof, all six disposable packets run sequentially with final PASS markers, cleanup, and fresh-context read-only Sol **ACCEPT** with no P1/P2 at exact commit `551d45e6181aad09d9b86150b7209e23324d9651`. This establishes **RELEASE CANDIDATE READY** only under the local synthetic/emulated definition in [`../GOAL.md`](../GOAL.md); it does not establish **COMPLETE** or authorize outward action. |
| Maple Ridge full-year evidence packet | **PROVEN** | SR-027 preserves the historical accepted January–December packet. SR-032/SR-033 record the complete continuous packet rerun and fresh acceptance inside unified exact commit `551d45e6181aad09d9b86150b7209e23324d9651`. |

## Maple Ridge continuous year

The required Maple run resets once before January and preserves the same disposable database through December. A month-level status never proves that continuous invariant unless the evidence packet records it.

| Month | Status | Commit / current evidence | Required next proof or blocker |
|---|---|---|---|
| January | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the one-reset continuous packet from January; SR-003/SR-004/SR-027 retain historical evidence. | No Maple month blocker; retain exact full-year continuity in any later packet. |
| February | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the source-real Program assignment and focused database assertions. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| March | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the source-real Inventory receipt and exact database assertions. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| April | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the inspected-and-cancelled no-write lane. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| May | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the exact applied Program pass and phone-sized read-only result. | No Maple month blocker. |
| June | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the Inventory/compliance boundary continuously with accepted confirmed-save semantics and exact identities. | No Maple month blocker. |
| July | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the governed `2027-07-09 21:10:00+00:00` scouting/task writes, SQL fences, and phone read-only/no-overflow lane. | No Maple month blocker. |
| August | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran retained manual-task completion, rapid double-submit defense, stale replay no-op, SQL fence, and phone lane at `2027-08-17 18:00:00+00:00`. | No Maple month blocker. |
| September | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the exact 30,800-bushel harvest once, same-receipt replay, SQL fence, and phone lane at `2027-09-28 23:05:00+00:00`. | No Maple month blocker. |
| October | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran the exact estimate, explicit harvest reconciliation, lost-success recovery, non-coupling fences, and phone lane at `2027-10-19 13:40:00+00:00`. | No Maple month blocker. |
| November | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran step-exact independent bin, inbound, contract, outbound, and delivery actions plus raw phone state at `2027-11-10 17:25:00+00:00`. | No Maple month blocker; Grain semantics remain explicit and non-coupled. |
| December | **PROVEN** | SR-032/SR-033 and unified exact commit `551d45e` reran full-year reconciliation, twelve read-only module/concurrency lanes, exact SQL, zero startup writes, and phone no-overflow at `2027-12-15 15:30:00+00:00`. | No Maple month blocker; this is browser emulation, not physical-device proof. |

## Governed scenario gauntlets

| Scenario | Status | Current blocker / missing evidence |
|---|---|---|
| NF — North Fork permissions/privacy | **PROVEN** | SR-032/SR-033 record two complete NF1–NF8 browser/database sequences and final `NORTH_FORK_2027_DISPOSABLE_PASS` at unified exact commit `551d45e6181aad09d9b86150b7209e23324d9651`: owner/farm switching, explicit rep sharing, role limits, stale-rep and outsider denial, exact writes/non-writes, cleanup, and fresh Sol acceptance. This does not change or prove live permissions. |
| PS — Prairie Spray compliance presence | **PROVEN** | SR-032/SR-033 record the desktop create/replay and emulated-phone read-only packet at unified exact commit `551d45e6181aad09d9b86150b7209e23324d9651`: exact application/product identities, `100.00` to `92.50` gal arithmetic, same-payload replay with one application/product, named non-writes, Compliance details, no overflow, and loopback-only browser traffic. This proves stored snapshot presence only and makes no applicator-license eligibility, validity, or expiration claim. |
| HR — Harvest Ridge Grain truth | **PROVEN** | SR-032/SR-033 record the governed packet at unified exact commit `551d45e6181aad09d9b86150b7209e23324d9651`: harvest, explicit Grain reconciliation, proof-created bin/inbound, proof-created contract, independent bin Out and contract delivery, reverse order, exact replay identities/timestamps/balances/associations, row-specific non-writes, and emulated-phone read-only proof. Harvest reconciliation, bin movements, contracts, and deliveries remain explicit, separate, non-coupled actions. |
| CC — Cedar Creek weather/scouting | **PROVEN** | SR-032/SR-033 record the deterministic desktop and 390-by-844 packet at unified exact commit `551d45e6181aad09d9b86150b7209e23324d9651`: manual payload-free weather transcription, one truthful spray application/product despite duplicate submit, exact `20` to `15` gal inventory, one scouting note and durable receipt, authorized RPCs only, and clean recovery. It adds no weather-to-spray provenance, integration, or automatic prefill. |
| PH — Pine Hill offline/recovery | **PROVEN** | SR-032/SR-033 record the complete reset/reconnect/revocation packet at unified exact commit `551d45e6181aad09d9b86150b7209e23324d9651`, including three variants, corrupt-active and corrupt-vault fail-closed checks, exact queue bytes, SQL/security fences, final pass, cleanup, and fresh Sol acceptance. This is local synthetic browser/database proof only. |

## Browser and environment matrix

| Matrix lane | Status | Evidence requirement |
|---|---|---|
| Playwright desktop, Maple January | **PROVEN** | SR-032/SR-033 record the one-reset continuous January lane rerun at unified exact commit `551d45e`; SR-003 retains its historical proof. |
| Playwright phone-sized, Maple January | **PROVEN** | SR-032/SR-033 record the phone-sized January lane rerun at unified exact commit `551d45e`; this is emulation, not a physical phone. |
| Playwright desktop, Maple February–June | **PROVEN** | SR-032/SR-033 record all five continuous desktop lanes passing at unified exact commit `551d45e`; SR-005 retains historical evidence. |
| Playwright phone-sized, Maple February–April | **UNMAPPED/UNBUILT** | The unified packet does not add February–April phone-sized scenarios. No physical or emulated phone proof is inferred from desktop coverage. |
| Playwright phone-sized, Maple May–June | **PROVEN** | SR-032/SR-033 record May Program and June Inventory/compliance read-only phone-sized results at unified exact commit `551d45e`; this is emulation, not a physical phone. |
| Playwright desktop + phone, Maple July | **PROVEN** | SR-032/SR-033 record the desktop scouting/task writes and 390-by-844 read-only/no-overflow/zero-mutation lane at unified exact commit `551d45e`; this is browser emulation. |
| Playwright desktop + phone, Maple August–December | **PROVEN** | SR-032/SR-033 record continuous desktop actions and 390-by-844 read-only/no-overflow/zero-mutation coverage under all five governed clocks at unified exact commit `551d45e`; this is browser emulation. |
| Playwright desktop + phone, PS | **PROVEN** | SR-032/SR-033 record desktop manager-create/replay and phone-sized Compliance read-only/no-overflow at unified exact commit `551d45e`; this is browser emulation and proves stored presence, not license validity. |
| Playwright desktop + phone, HR | **PROVEN** | SR-032/SR-033 record desktop actions and 390-by-844 Grain, Storage, and Contracts read-only/no-overflow/zero-mutation at unified exact commit `551d45e`; this is browser emulation and retains explicit non-coupling. |
| Playwright desktop + phone, NF | **PROVEN** | SR-032/SR-033 record both role/privacy sequences and phone-sized read-only/no-overflow checks at unified exact commit `551d45e`; this is browser emulation, not live-auth or physical-device proof. |
| Playwright desktop + phone, PH | **PROVEN** | SR-032/SR-033 record offline/reconnect/revocation/recovery variants, byte assertions, and phone-sized checks at unified exact commit `551d45e`; this is disposable-backend browser emulation. |
| Playwright desktop + phone, CC | **PROVEN** | SR-032/SR-033 record root and independent Sol desktop plus 390-by-844 packets exiting `0` with final Cedar pass, direct selected-tab visibility, exact browser/database outcomes, loopback-only traffic, and acceptance at unified exact commit `551d45e`; this is browser emulation. |
| Physical iPhone/Safari installed-PWA journey | **UNMAPPED/UNBUILT** | Must be performed and recorded on a physical device before COMPLETE; no proof exists. Any customer account, auth change, or outward/live action used for it is separately **APPROVAL-GATED**. |
| Physical Android/Chrome installed-PWA journey | **UNMAPPED/UNBUILT** | Must be performed and recorded on a physical device before COMPLETE; no proof exists. Any customer account, auth change, or outward/live action used for it is separately **APPROVAL-GATED**. |

## Outward and operational gates

| Gate | Status | Current truth |
|---|---|---|
| Custom SMTP and real password-email delivery | **APPROVAL-GATED** | Unconfigured/unproven for customer onboarding; requires separate approval, safe configuration, and end-to-end proof. |
| Push / pull request / merge | **APPROVAL-GATED** | No authority is implied by local work or this scorecard. |
| Production deploy / promotion / rollback | **APPROVAL-GATED** | `main` is production-coupled; no action is authorized. |
| Live migration, live data, secrets, auth, permissions, customer accounts or communication | **APPROVAL-GATED** | Each specific outward action requires Mason's explicit approval. |
| Publication and live verification | **APPROVAL-GATED** | Cannot be credited until actually performed and durably recorded. |

## Update procedure

1. Read the controlling contract and append-only ledger; inspect the exact current branch, HEAD, worktree, migrations, manifests, harnesses, and evidence files.
2. Change a status only from durable evidence for the exact identified commit. Chat-reported runs or verdicts may locate work but cannot establish **PROVEN**.
3. For every runtime claim, record command and exit code, exact SHA and parent, migration/manifest hashes, simulated instant, role/farm/network, browser project/viewport, UI evidence, focused database writes/non-writes, artifact paths, scope/credential checks, and fresh read-only Sol verdict.
4. Append a new ledger entry or correction; never rewrite prior ledger history. A repair is a new immutable commit and receives a new fresh-context Sol review.
5. Re-evaluate the full 11-step verification ladder on the resulting exact HEAD. Month passes do not imply full-year or release readiness.
6. Never convert **APPROVAL-GATED** based on silence or prior local authority. Record the exact approved action and its actual result after it occurs.

The initiative is **RELEASE CANDIDATE READY** only for the accepted local synthetic/disposable-backend and browser-emulation evidence at exact commit `551d45e6181aad09d9b86150b7209e23324d9651`. It remains explicitly below **COMPLETE** as defined in [`../GOAL.md`](../GOAL.md); every outward and physical-device gate above remains open or approval-gated.
