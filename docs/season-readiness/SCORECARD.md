# Farm Rx 2027 season-readiness scorecard

**Snapshot:** Maple Ridge, North Fork, and Pine Hill are jointly proven at exact commit `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279`; Cedar Creek is locally proven at `26b161df92fc8ce55d6cfabd4cec278644656767`; Prairie Spray and Harvest Ridge remain separately proven at their identified SHAs; the exact-current-HEAD full six-scenario matrix remains runtime-blocked
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
| Exact-current-HEAD release ladder | **RUNTIME-BLOCKED** | Maple Ridge/North Fork/Pine Hill are jointly proven at `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279`, Prairie Spray at `0753c5165116c6a8f25076dd4b036b9afb570d51`, Harvest Ridge at `a39b4cd4cf6a7bb8b03ba7dd1ee4c8dce98a4fec`, and Cedar Creek at `26b161df92fc8ce55d6cfabd4cec278644656767`. The complete six-scenario ladder has not run and received fresh Sol acceptance on one exact current SHA, so **RELEASE CANDIDATE READY** remains unproven. |
| Maple Ridge full-year evidence packet | **PROVEN** | SR-027 records the accepted continuous January–December packet, and the entire packet reran successfully inside combined exact commit `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279` before fresh Sol acceptance. |

## Maple Ridge continuous year

The required Maple run resets once before January and preserves the same disposable database through December. A month-level status never proves that continuous invariant unless the evidence packet records it.

| Month | Status | Commit / current evidence | Required next proof or blocker |
|---|---|---|---|
| January | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the one-reset continuous packet from January. | No Maple month blocker; retain exact full-year continuity in any later release packet. |
| February | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the source-real Program assignment and focused database assertions. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| March | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the source-real Inventory receipt and exact database assertions. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| April | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the inspected-and-cancelled no-write lane. | No Maple month blocker; phone coverage remains limited to the recorded matrix below. |
| May | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the exact applied Program pass and phone-sized read-only result. | No Maple month blocker. |
| June | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the Inventory/compliance boundary continuously. | No Maple month blocker. |
| July | **PROVEN** | SR-027 and combined exact commit `e7efe9a` reran the governed `2027-07-09 21:10:00+00:00` scouting/task writes, SQL fences, and phone read-only/no-overflow lane. | No Maple month blocker. |
| August | **PROVEN** | SR-027 and combined exact commit `e7efe9a` proved the exact retained manual-task completion, rapid double-submit defense, stale replay no-op, SQL fence, and phone read-only/no-overflow lane at `2027-08-17 18:00:00+00:00`. | No Maple month blocker. |
| September | **PROVEN** | SR-027 and combined exact commit `e7efe9a` proved the exact 30,800-bushel harvest once, same-receipt replay, SQL fence, and phone read-only/no-overflow lane at `2027-09-28 23:05:00+00:00`. | No Maple month blocker. |
| October | **PROVEN** | SR-027 and combined exact commit `e7efe9a` proved the exact estimate, explicit harvest reconciliation, lost-success recovery, non-coupling fences, and phone lane at `2027-10-19 13:40:00+00:00`. | No Maple month blocker. |
| November | **PROVEN** | SR-027 and combined exact commit `e7efe9a` proved step-exact independent bin, inbound, contract, outbound, and delivery actions plus raw phone state at `2027-11-10 17:25:00+00:00`. | No Maple month blocker; Grain semantics remain explicit and non-coupled. |
| December | **PROVEN** | SR-027 and combined exact commit `e7efe9a` proved full-year reconciliation, twelve read-only module/concurrency lanes, exact SQL, zero startup writes, and phone no-overflow at `2027-12-15 15:30:00+00:00`. | No Maple month blocker; this is browser emulation, not physical-device proof. |

## Governed scenario gauntlets

| Scenario | Status | Current blocker / missing evidence |
|---|---|---|
| NF — North Fork permissions/privacy | **PROVEN** | Combined exact commit `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279` ran two complete NF1–NF8 browser/database sequences and emitted two `NORTH_FORK_2027_VERIFY_PASS` markers plus `NORTH_FORK_2027_DISPOSABLE_PASS`. It proves owner/farm switching, explicit rep sharing, rep/read-only/worker/manager limits, stale-rep denial, outsider denial, exact writes/non-writes, cleanup, and fresh Sol acceptance. It does not change or prove live permissions. |
| PS — Prairie Spray compliance presence | **PROVEN** | SR-007 records the passing disposable-local manager desktop/phone packet, and SR-008 records fresh Sol **ACCEPT** with no findings for exact proof commit `0753c5165116c6a8f25076dd4b036b9afb570d51`: exact application/product snapshots, `100.00` to `92.50` gal arithmetic, browser-originated same-payload replay with one resulting application/product, named non-writes, phone Compliance details, no overflow, and no external browser network. This is snapshot-presence proof only; it makes no license-status claim. The separate ID-bound Spray receipt hardening candidate remains unclaimed. |
| HR — Harvest Ridge Grain truth | **PROVEN** | SR-014/SR-015 record the governed disposable-local packet and fresh exact-commit Sol **ACCEPT** with no findings at `a39b4cd4cf6a7bb8b03ba7dd1ee4c8dce98a4fec`: harvest, explicit Grain reconciliation, proof-created bin and inbound grain, proof-created contract, independent bin Out and contract delivery, exact replay identities, clean-reset reverse order, exact timestamps/balances/associations, row-specific non-writes, and 390-by-844 read-only proof. This is scenario proof only; it does not prove Maple continuity, the full year, or release readiness. |
| CC — Cedar Creek weather/scouting | **PROVEN** | SR-030/SR-031 record the bounded repairs, full governed disposable-local desktop and 390-by-844 packet, and fresh read-only Sol **ACCEPT** with no P1/P2 at exact commit `26b161df92fc8ce55d6cfabd4cec278644656767`: deterministic weather guidance; manual, payload-free weather transcription; one truthful spray application/product despite duplicate submit; exact `20` to `15` gal inventory; one scouting note and one durable receipt; only the two authorized RPCs; and clean recovery. This is local synthetic browser/database proof only. It adds no weather-to-spray provenance or automatic prefill and proves neither a physical phone nor release readiness. |
| PH — Pine Hill offline/recovery | **PROVEN** | Combined exact commit `e7efe9a6bc02bbdf603735d8f23ed977ec6d5279` ran the complete reset/reconnect/revocation packet, including three variants, corrupt-active and corrupt-vault fail-closed checks, exact queue byte assertions, SQL/security fences, final `PINE_HILL_2027_DISPOSABLE_PASS`, cleanup, and fresh Sol acceptance. This is local synthetic browser/database proof only. |

## Browser and environment matrix

| Matrix lane | Status | Evidence requirement |
|---|---|---|
| Playwright desktop, Maple January | **PROVEN** | Recorded in SR-003 for January proof HEAD only. |
| Playwright phone-sized, Maple January | **PROVEN** | Recorded in SR-003 for January proof HEAD only; this is emulation, not a physical phone. |
| Playwright desktop, Maple February–June | **PROVEN** | SR-005 records all five desktop lanes passing continuously at accepted commit `53e8d2d`. |
| Playwright phone-sized, Maple February–April | **UNMAPPED/UNBUILT** | February–April have no accepted phone-sized scenario; this remains explicit and is not inferred from desktop proof. |
| Playwright phone-sized, Maple May–June | **PROVEN** | SR-005 records read-only phone-sized confirmation for the May Program result and June Inventory/compliance result at accepted commit `53e8d2d`; this is emulation, not a physical phone. |
| Playwright desktop + phone, Maple July | **PROVEN** | SR-017/SR-018 record the accepted desktop scouting/task writes and 390-by-844 read-only/no-overflow/zero-mutation lane at exact commit `021b587`; this is browser emulation, not a physical-device journey. |
| Playwright desktop + phone, Maple August–December | **PROVEN** | SR-027 and combined exact commit `e7efe9a` record the accepted continuous source-real desktop actions and 390-by-844 read-only/no-overflow/zero-mutation coverage under all five governed clocks. This is browser emulation, not a physical-device journey. |
| Playwright desktop + phone, PS | **PROVEN** | SR-007/SR-008 record the disposable-local desktop manager-create/replay lane and phone-sized Compliance read-only/no-overflow lane accepted at exact commit `0753c5165116c6a8f25076dd4b036b9afb570d51`. This does not prove release/full-year readiness or a physical-device journey. |
| Playwright desktop + phone, HR | **PROVEN** | SR-014/SR-015 record the accepted desktop action packet and 390-by-844 Grain, Storage, and Contracts read-only/no-overflow/zero-mutation lane at exact commit `a39b4cd4cf6a7bb8b03ba7dd1ee4c8dce98a4fec`. This is browser emulation, not a physical-device journey. |
| Playwright desktop + phone, NF | **PROVEN** | Combined exact commit `e7efe9a` records both complete source-real role/privacy sequences and the governed phone-sized read-only/no-overflow checks. This is browser emulation, not live-auth or physical-device proof. |
| Playwright desktop + phone, PH | **PROVEN** | Combined exact commit `e7efe9a` records the governed offline/reconnect/revocation/recovery variants, byte assertions, and phone-sized checks. This is browser emulation on a disposable backend. |
| Playwright desktop + phone, CC | **PROVEN** | SR-030/SR-031 record root and independent Sol desktop plus 390-by-844 browser-emulation packets exiting `0` with final Cedar pass, direct selected-tab visibility, no page overflow, exact browser/database outcomes, loopback-only traffic, and fresh exact-SHA acceptance at `26b161df92fc8ce55d6cfabd4cec278644656767`. This is browser emulation, not a physical-device journey. |
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

The initiative remains below **RELEASE CANDIDATE READY** and **COMPLETE** as defined in [`../GOAL.md`](../GOAL.md).
