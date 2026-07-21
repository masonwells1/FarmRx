# Farm Rx 2027 season-readiness scorecard

**Snapshot:** accepted local evidence through `codex/farmrx-2027-season-ready` commit `53e8d2d380907b7bf56da599362ec8254d3ef2a0` (`53e8d2d`)
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
| Exact-current-HEAD verification ladder | **RUNTIME-BLOCKED** | The accepted product/proof commit is `53e8d2d380907b7bf56da599362ec8254d3ef2a0`, but the full 11-step ladder still includes July–December and governed-scenario/physical-device/outward lanes that have not run. Documentation-only descendants do not inherit an exact-current-HEAD release claim. |
| Full-year evidence packet and append-only closeout | **UNMAPPED/UNBUILT** | No continuous January–December accepted evidence packet or final ledger entry exists. |

## Maple Ridge continuous year

The required Maple run resets once before January and preserves the same disposable database through December. A month-level status never proves that continuous invariant unless the evidence packet records it.

| Month | Status | Commit / current evidence | Required next proof or blocker |
|---|---|---|---|
| January | **PROVEN** | Accepted proof HEAD `0238361192b7fa23d67956f43ffbf74be64c4022`; ledger SR-003/SR-004. | Re-run inside the eventual exact-HEAD continuous-year packet. |
| February | **PROVEN** | SR-005; accepted commit `53e8d2d`. Real local desktop UI created and assigned the exact Maple Program, followed by focused database assertions. | Re-run inside the eventual January–December packet. |
| March | **PROVEN** | SR-005; accepted commit `53e8d2d`. Real local desktop UI received the exact Maple product, with target-write, identity, clock, network, and database assertions. | Re-run inside the eventual January–December packet. |
| April | **PROVEN** | SR-005; accepted commit `53e8d2d`. Real local desktop UI inspected and cancelled without a write; the proof asserted zero target/unexpected writes and database invariance. | Re-run inside the eventual January–December packet. |
| May | **PROVEN** | SR-005; accepted commit `53e8d2d`. Desktop marked the exact pass applied and phone-sized read-only UI confirmed it; database assertions passed. | Re-run inside the eventual January–December packet. |
| June | **PROVEN** | SR-005; accepted commit `53e8d2d`. Desktop saved the exact manual application and phone-sized read-only UI confirmed 90 gallons plus compliance presence; database assertions passed. | Continue with July from this accepted boundary; the eventual full-year proof must still reset once at January. |
| July | **PRODUCT-BLOCKED** | Read-only mapping identified that Scouting closes after save without an honest receipt; Task quick actions also lack receipts. No committed July harness exists. | Repair existing receipt behavior, add offline/replay/failure/double-submit proof, then build browser/SQL lane. |
| August | **PRODUCT-BLOCKED** | Task quick-action receipt gap affects trusted status changes; no committed August harness exists. | Same bounded receipt repair plus executable browser/DB proof. |
| September | **PRODUCT-BLOCKED** | Harvest save has no honest receipt; no committed September harness exists. | Repair receipt behavior and prove write/non-write/replay behavior. |
| October | **STATIC-ACCEPTED** | Durable mapping commit `fae1365` records the explicit two-step Grain workflow, ordered writes, and non-coupling boundaries; immutable Sol review passed. No committed harness or runtime result exists. | Build and run browser/DB proof on the continuous fixture. |
| November | **PRODUCT-BLOCKED** | Grain bin/storage and contract/delivery actions lack honest receipt coverage; no committed harness exists. | Repair receipts and prove five independent writes and all required non-writes. |
| December | **STATIC-ACCEPTED** | Commit `53e8d2d` adds authenticated, edit-gated, server-clock status preflights and receipt-backed v2 generators for Program and Equipment startup. The disposable verifier proves authorization, idempotency, concurrency, strict receipts, and zero-ID allocation on false status. No December closeout browser harness exists. | Build the December browser/database closeout lane and prove truly zero startup writes in the continuous January–December run. |

## Governed scenario gauntlets

| Scenario | Status | Current blocker / missing evidence |
|---|---|---|
| NF — North Fork permissions/privacy | **STATIC-ACCEPTED** | Durable mapping commit `600b821` confirms current migrations use `can_edit_farm(farm_id)` and records the required owner/manager/worker/read-only/rep/outsider role matrix, epoch changes, server-clock seam, and non-writes. No executable browser/database gauntlet exists; any live auth/RLS action remains separately approval-gated. |
| PS — Prairie Spray compliance presence | **PRODUCT-BLOCKED** | The saved application detail UI does not surface existing stored compliance facts required by the scenario: application time, pest, applicator/license, weather, and product rate/total fields. Fixture interpretation is also unresolved; proof must assert saved snapshots only and never claim license eligibility, validity, or expiration. |
| HR — Harvest Ridge Grain truth | **PRODUCT-BLOCKED** | Existing Grain bin/movement actions do not show action-specific honest save receipts; the generic page timestamp can be inherited from a different prior storage action. Deterministic baseline evidence and the executable reconciliation/contracts/deliveries/bin-ledger gauntlet are also absent. |
| CC — Cedar Creek weather/scouting | **PRODUCT-BLOCKED** | The deterministic weather contract is static, but Scouting's missing save receipt blocks a trustworthy executable workflow. No accepted CC runtime packet exists. |
| PH — Pine Hill offline/recovery | **PRODUCT-BLOCKED** | Read-only mapping found two custody defects: queued Field Log entries do not persist their operation-era revocation generation/token/server epoch, and a removed member cannot retrieve the authoritative new epoch needed to build the required revoked fence. No disposable fixture, executable desktop/phone gauntlet, corruption negative case, or evidence packet exists. |

## Browser and environment matrix

| Matrix lane | Status | Evidence requirement |
|---|---|---|
| Playwright desktop, Maple January | **PROVEN** | Recorded in SR-003 for January proof HEAD only. |
| Playwright phone-sized, Maple January | **PROVEN** | Recorded in SR-003 for January proof HEAD only; this is emulation, not a physical phone. |
| Playwright desktop, Maple February–June | **PROVEN** | SR-005 records all five desktop lanes passing continuously at accepted commit `53e8d2d`. |
| Playwright phone-sized, Maple February–April | **UNMAPPED/UNBUILT** | February–April have no accepted phone-sized scenario; this remains explicit and is not inferred from desktop proof. |
| Playwright phone-sized, Maple May–June | **PROVEN** | SR-005 records read-only phone-sized confirmation for the May Program result and June Inventory/compliance result at accepted commit `53e8d2d`; this is emulation, not a physical phone. |
| Playwright desktop + phone, Maple July–December | **UNMAPPED/UNBUILT** | Required executable specs/runners/evidence are absent. |
| Playwright desktop + phone, NF/PS/HR/CC/PH | **UNMAPPED/UNBUILT** | Required executable matrix and evidence packets are absent. Read-only mappings do not constitute executable browser coverage. |
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
