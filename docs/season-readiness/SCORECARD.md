# Farm Rx 2027 season-readiness scorecard

**Snapshot:** `codex/farmrx-2027-season-ready` at `600b8212486292ac43242e42890d342631863638` (`600b821`)
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
| February–June evidence packets and ledger entries | **RUNTIME-BLOCKED** | Harness commits and chat-reported Sol PASS exist, but runtime outputs, browser/DB indexes, hashes, exact-SHA packets, and append-only ledger acceptance are not durable. Do not call these months proven. |
| Exact-current-HEAD verification ladder | **RUNTIME-BLOCKED** | Current HEAD is `600b8212486292ac43242e42890d342631863638`. No durable packet proves all 11 runbook ladder steps on this exact SHA; the continuous browser run is blocked by disposable synthetic authentication setup. |
| Full-year evidence packet and append-only closeout | **UNMAPPED/UNBUILT** | No continuous January–December accepted evidence packet or final ledger entry exists. |

## Maple Ridge continuous year

The required Maple run resets once before January and preserves the same disposable database through December. A month-level status never proves that continuous invariant unless the evidence packet records it.

| Month | Status | Commit / current evidence | Required next proof or blocker |
|---|---|---|---|
| January | **PROVEN** | Accepted proof HEAD `0238361192b7fa23d67956f43ffbf74be64c4022`; ledger SR-003/SR-004. | Re-run inside the eventual exact-HEAD continuous-year packet. |
| February | **RUNTIME-BLOCKED** | Browser harness commit `9e08815` plus assignment repair commits `4dda4ec`, `954aef3`, `57e2223`. Chat reports fresh Sol PASS, but no durable runtime packet/ledger entry exists. | Make disposable synthetic login self-contained; run and record browser/DB proof and exact-SHA review. |
| March | **RUNTIME-BLOCKED** | Inventory harness commit `82e5255`; chat reports fresh Sol PASS only. | Durable runtime packet, exact-SHA review evidence, and ledger entry. |
| April | **RUNTIME-BLOCKED** | No-write harness commit `f6009a5`; chat reports fresh Sol PASS only. | Durable runtime/non-write packet, exact-SHA review evidence, and ledger entry. |
| May | **RUNTIME-BLOCKED** | Program harness commit `63b4f0b`; chat reports fresh Sol PASS only. | Durable runtime packet, exact-SHA review evidence, and ledger entry. |
| June | **RUNTIME-BLOCKED** | Application harness commit `adc527e`; chat reports fresh Sol PASS only. | Durable runtime packet, exact-SHA review evidence, and ledger entry. |
| July | **PRODUCT-BLOCKED** | Read-only mapping identified that Scouting closes after save without an honest receipt; Task quick actions also lack receipts. No committed July harness exists. | Repair existing receipt behavior, add offline/replay/failure/double-submit proof, then build browser/SQL lane. |
| August | **PRODUCT-BLOCKED** | Task quick-action receipt gap affects trusted status changes; no committed August harness exists. | Same bounded receipt repair plus executable browser/DB proof. |
| September | **PRODUCT-BLOCKED** | Harvest save has no honest receipt; no committed September harness exists. | Repair receipt behavior and prove write/non-write/replay behavior. |
| October | **STATIC-ACCEPTED** | Durable mapping commit `fae1365` records the explicit two-step Grain workflow, ordered writes, and non-coupling boundaries; immutable Sol review passed. No committed harness or runtime result exists. | Build and run browser/DB proof on the continuous fixture. |
| November | **PRODUCT-BLOCKED** | Grain bin/storage and contract/delivery actions lack honest receipt coverage; no committed harness exists. | Repair receipts and prove five independent writes and all required non-writes. |
| December | **PRODUCT-BLOCKED** | Startup currently calls the mutating Program due-item generator, which consumes an operation receipt even when it creates zero tasks and notifications; no committed closeout harness exists. | Add the mapped read-only eligibility preflight while preserving generator idempotency, align the disposable database clock, prove truly zero startup writes, then build closeout proof. |

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
| Playwright desktop, Maple February–June | **RUNTIME-BLOCKED** | Desktop-only committed specs/configs exist, but acceptable durable runtime/evidence packets do not; synthetic local password setup blocks the continuous run. |
| Playwright phone-sized, Maple February–June | **UNMAPPED/UNBUILT** | The February–June configs contain only a `Desktop Chrome` project; phone-sized projects/spec evidence are absent. |
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
