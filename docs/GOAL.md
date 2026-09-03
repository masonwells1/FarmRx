# STANDING GOAL — Farm Rx 2027 Season-Ready

**Owner:** Mason Wells · **Directed:** 2026-07-18 · **Governed status:** RELEASE CANDIDATE READY, not COMPLETE. The six-scenario 2027 packet remains accepted at `8a9565a08a760e0ec920170bfacee1d9132cba47`, and worker-free password recovery plus both PR-review repair rounds remains accepted at source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555` with governed source-closeout tip `5f2733e167edd4c420427e4ade14b761d6e9b7a7`. Recovery-domain/DNS/TLS, the exact Supabase redirect, server-side recovery/update/reuse/login events, and disposable-account deletion are durably proven; external-Chrome mailbox/UI/service-worker facts are separately operator-observed, and both physical-phone journeys remain open.

**Last verified runtime-publication snapshot (2026-08-12):** PR #24 exact accepted head `e580b73468f1022f23e0dcb84961e18ba877edca` merged as `af795371e2321fb445d3a7f81980cd6b7b6c2254` at `2026-08-12T20:44:42Z`. Vercel tied that exact merge SHA to successful production deployment `dpl_pXfwpFp9igFKVbyjjq4M4Kjbx9QN`, which was `READY`; the canonical root, recovery root, and recovery `/update-password` each returned HTTP `200`. Supabase migration `20260812135210` was applied after a zero-open-work drain, and exact reviewed `send-push` v5 was active and live-verified. SR-062/SR-063 record the evidence and corrected limits. This is dated evidence, not a self-updating claim about the repository or deployment that exists when this file is later read; reverify GitHub, Vercel, and Supabase before describing any SHA or deployment as current.

## Owner directive

Farm Rx will have **no real farmer use until 2027**. This dated direction supersedes earlier rollout timing, first-customer handoff timing, and any standing instruction to keep building toward immediate customer use.

That change in timing does not erase history. Farm Rx was previously committed, merged, deployed, and verified in production. The archived first-customer goal records that work verbatim at [`docs/archive/goals/2026-07-11-first-customer-ship.md`](archive/goals/2026-07-11-first-customer-ship.md). Production remains coupled to GitHub `main`; this goal does not authorize another production action.

## Goal

Prove that the existing Farm Rx product can carry a farmer through a realistic 2027 farm year safely, plainly, and without hidden cross-module mutations.

The work starts from the completed Farmer Simplicity hardening: guided Fields setup/forms, role-shaped direct navigation into the existing modules, visible save/recovery states, and the existing offline/farm-access protections. The season-readiness effort exercises and repairs those source-real workflows. It adds no new launcher or dashboard and does not start a second product architecture.

## Product boundary

- Keep the current modules, repositories, queues, permissions, privacy model, and Crop RX design system.
- Prefer the smallest complete repair when a season scenario exposes a defect in existing behavior.
- Do not add standalone modules, vendors, broad redesigns, or speculative features.
- A missing integration is a **negative assertion and out of scope** unless an approved scenario exposes a defect in behavior Farm Rx already claims to perform.
- Do not invent a pending Crop RX delivery UI, a standalone planting-actual entity, automatic grain-lot creation, a year-end finalization action, or a product/database `run_id` column.
- The future Crop RX delivery sync, live machine-data integrations, licensed market-data feeds, and other roadmap integrations remain absent unless Mason separately changes scope.

## Owner scope amendment — 2026-08-10

**Owner:** Mason Wells · **Directed:** 2026-08-10 (`America/Chicago`).

Mason authorizes two new bounded build initiatives beyond the season-readiness proof scope. For these two initiatives only, this amendment supersedes the "no standalone modules … or speculative features" line of the Product boundary above. Every other boundary line — no vendors, no broad redesigns, no proof-only `run_id` product column, no invented pending integrations — remains in force, and the season-readiness initiative's own scope, statuses, and carried gates are unchanged.

### Initiative CW — Connect Workflows (one writer session, two sequenced tranches)

- **CW-1 Weather→Spray prefill.** From an existing Weather-page forecast/spray-window view, a farmer-visible action starts a new spray/application record with the date and observed weather values (temperature, wind) prefilled from that forecast. The farmer reviews and explicitly saves; nothing writes without that save. This is prefill convenience only — it creates no background write, no automatic integration, and no claim of weather provenance beyond recording which prefilled values the farmer accepted.
- **CW-2 Program→Inventory matching.** When a program pass is marked applied, the app may offer to match that pass's product lines to existing Inventory products and, only on explicit farmer confirmation, draw down on-hand quantities accordingly. Free-typed or unmatched products remain unmatched and cause no Inventory change. No silent mutation.
- **Fence:** Initiative CW must not modify the Grain module, the Harvest module, or bin/contract/delivery code, repositories, or tables while the separate in-flight Harvest→Grain / Bin-out→Delivery work remains unmerged. If a CW tranche appears to require such a change, stop and return to Mason.

### Initiative SRX — Soil Rx (one writer session, three sequenced tranches)

- **SRX-1 Soil test storage.** Per-field soil test records (lab name, sample date, pH, organic matter, CEC, P, K, Ca, Mg, S, base saturations, optional micronutrients), with multi-year history per field and optional attachment of the lab report file. New tables, migrations, and screens are authorized. Soil data is farm-scoped, private by default, and covered by Row Level Security consistent with the existing privacy model.
- **SRX-2 Interpretation.** A plain-English, descriptive read of a stored soil test in the Kinsey-Albrecht style. Descriptive only: it states what the test shows and directs the farmer to their Crop RX agronomist for recommendations. It must not output product rates, prescriptions, or purchase recommendations, and must carry a plain-language "this is not agronomic advice" note consistent with the Grain-page compliance stance.
- **SRX-3 Nutrient removal.** Harvest actual bushels → estimated pounds of N, P, and K removed per field using standard published removal coefficients (source cited in the implementation), displayed alongside stored soil test levels. Read-only consumption of harvest data; no writes to Grain or Harvest.

### Shared rules for both initiatives

- Each initiative runs on its own branch and worktree cut from current `main`, follows the discipline of [`season-readiness/ORCHESTRATOR-RUNBOOK.md`](season-readiness/ORCHESTRATOR-RUNBOOK.md) — one bounded tranche, one immutable commit, fresh-context read-only Sol review of each exact commit, repairs as new commits — and keeps its own append-only ledger at `docs/initiatives/<initiative>/LEDGER.md`.
- All runbook approval gates remain: no push, pull-request mutation, merge, deploy, live migration, live data, secret/auth/permission, customer, or destructive action without Mason's named approval.
- **Recorded backlog, not authorized:** a Today/home "needs attention" view summarizing all modules. Do not build it under this amendment.

## Current capability truth

These statements are the baseline. A test must not claim more coupling than the product has.

1. Marking a Program pass applied may create a new **draft** application record or link an existing application record. Separately, an exact existing Inventory product may be matched and drawn down only when the farmer explicitly confirms the match and quantity. Free-typed, unmatched, ambiguous, or unconfirmed Program products do not change Inventory on-hand.
2. Weather guidance and spray records both exist. A fresh field forecast may open the existing spray form with the field, forecast-local date, temperature, wind speed, and compass direction prefilled. The farmer can review or change every value and must explicitly save; stale Weather offers no prefill, the blank manual path remains available, and no navigation, provenance, provider, or background write is created.
3. Harvest writes update the crop assignment's harvest actuals. Grain reads the harvest total, but the user must explicitly choose **Use harvest total as Grain actual** before Grain actual production changes. That action does not change bins.
4. A manual bin-out movement and a contract delivery are separate user actions and separate writes. Neither silently creates or performs the other.

## Required scenario contract

The canonical scenario and write/non-write contracts are in [`docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`](season-readiness/WORKFLOWS-AND-SCENARIOS.md). Required coverage is:

- **Maple Ridge:** one narrative 12-month 2027 farm year across the existing farmer workflows.
- **North Fork:** permissions, privacy, farm switching, and stale-access denial.
- **Prairie Spray:** spray-record compliance-field presence and saved snapshots only. It must make no claim about applicator-license eligibility, validity, or expiration.
- **Harvest Ridge:** harvest-to-Grain reconciliation, contracts, deliveries, and bin ledgers.
- **Cedar Creek:** deterministic weather guidance, manual weather transcription, and scouting.
- **Pine Hill:** weak signal, offline queues, reconnect, revocation, and recovery.

## Proof environment

- Use a simulated 2027 clock with fixed instants interpreted in `America/Chicago`. Do not depend on the workstation's current date or time zone.
- Use synthetic people, farms, fields, products, money, weather, and agronomic facts only.
- Keep deterministic fixture UUIDs in the external manifest in the scenario document and evidence packet. The manifest, not a product column, identifies a proof run.
- Use a disposable local backend seeded from the repository's current migrations. Never use the live Farm Rx or CRX Manager database for season proof.
- Reset the disposable backend between scenarios unless a scenario explicitly requires a sequence. Record migration identity and fixture-manifest hash.
- Prove the farmer-visible result in a real browser at representative desktop and phone sizes, and prove the corresponding local database writes and non-writes with focused queries.
- Every scenario records exact branch and commit SHA, role, selected farm, network state, simulated instant, fixture IDs, UI evidence, local database evidence, and result.

## Required evidence

A release packet is incomplete without all of the following on the exact reviewed commit:

- forced TypeScript, regression, production build, dependency audit, and foundation proof;
- disposable local-database setup and focused database assertions;
- browser proof for the approved scenario matrix at representative desktop and phone sizes;
- full Maple Ridge 12-month season proof;
- explicit expected-write and expected-non-write results for every scenario;
- exact-SHA credential/scope/diff checks;
- a fresh-context, read-only Sol adversarial review; and
- append-only entries in [`docs/season-readiness/LEDGER.md`](season-readiness/LEDGER.md).

The operating loop and authority boundaries are in [`docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`](season-readiness/ORCHESTRATOR-RUNBOOK.md).

## Canonical status definitions

These are the only status definitions for this initiative. Other files may report one of these statuses but must link here instead of redefining it.

### RELEASE CANDIDATE READY

**RELEASE CANDIDATE READY** means local exact-SHA disposable-backend, browser, foundation, and season proof has passed and a fresh-context, read-only Sol review has accepted that exact commit. It does not mean anything was pushed, merged, deployed, migrated, enabled, or used on a physical device or live service.

### COMPLETE

**COMPLETE** means RELEASE CANDIDATE READY plus every required Mason-approved commit, publish, pull-request, merge, deploy, live migration, live-data, secret/auth/permission, and customer-account action has actually been performed and recorded, and every required physical-device and live verification has actually been performed and recorded. Planned, simulated, automated, or deferred work does not count as performed.

### OPERATOR-OBSERVED

**OPERATOR-OBSERVED** means the action or UI state was directly observed during a controlled run but lacks a committed screenshot, trace, HAR, mailbox export, complete audit window, or equivalent durable artifact. It may preserve truthful provenance, but it cannot establish **PROVEN** or **COMPLETE** by itself.

## Unresolved customer-zero gates carried forward

The prior engineering release did not close these operational gates, and the 2027 timing does not waive them:

- The 2026-08-01 through 2026-08-03 recovery tranche is indexed in the redacted [`2026-08-03 live recovery closeout evidence`](audits/2026-08-03-live-recovery-closeout-evidence.md). Exact accepted source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555` and governed source-closeout tip `5f2733e167edd4c420427e4ade14b761d6e9b7a7` merged through PR #17 as `4b4dae787afbd013a79d4edc05d8aebfbb0d5257`. Documentation-only PR #18 exact head `521a434a3d4f0d77e96d90b4e01133bc21920baa` then merged its provenance corrections as `2c10256c740f4080d08b4bc119eb6341f54f3b80`; at the SR-048 observation time, GitHub deployment `5728676687` tied that exact SHA/ref to Production and Vercel deployment `dpl_CzsG7P8e8xwXvEdaogYDJugsK646` was `READY`. The recovery domain/DNS/TLS and exact fifth Supabase redirect are durable evidence from that recorded tranche, not an undated assertion about later configuration. Redacted Auth logs durably record recovery request `200`, successful verification, user modification, fail-closed reused-link `403`, password-grant login `200`, and exact disposable-user deletion `200`; a read-only `auth.users` query proves three original users remain and zero disposable UID/email matches. Mailbox arrival, exact visible UI states, zero service-worker registrations/control, canonical handoff, missing-farm-setup display, and sign-out were directly observed in external Chrome but remain **OPERATOR-OBSERVED** because no screenshot, trace, HAR, or mailbox export was committed. No permanent farm membership or application data was provisioned for that disposable identity.
- The two physical-phone customer-zero journeys—iPhone/Safari and Android/Chrome—must be performed and recorded, including installed-PWA, privacy, weak-signal, recovery, and stale-access behavior.

No real farmer account may be provisioned and no customer communication may be sent under this goal before Mason separately authorizes those actions and the applicable gates are proven.

## Preserved release history and current routing

For current repository and branch work, start with [`docs/README.md`](README.md) and the dated [`2026-09-03 branch inventory`](branch-inventory-2026-09-03.md). The history below preserves the accepted season/recovery chain; it is not an undated assertion that an old SHA, deployment, or branch remains current.

Preserve the accepted six-scenario release candidate at immutable source/runtime commit `8a9565a08a760e0ec920170bfacee1d9132cba47`; SR-035/SR-036 remain its accepted proof. Preserve the recovery source/review chain through exact source `9ecc6cba7bbaa9bea063054fe3b996cd22ea9555`, governed source-closeout tip `5f2733e167edd4c420427e4ade14b761d6e9b7a7`, PR #18 governance-correction head `521a434a3d4f0d77e96d90b4e01133bc21920baa`, PR #18 merge `2c10256c740f4080d08b4bc119eb6341f54f3b80`, and SR-051's dated PR #19 publication snapshot; SR-041 through SR-051 preserve the immutable acceptance, correction, authority, publication, and snapshot-stabilization history. Preserve the later Deno verification repair through exact accepted PR #21 head `4740a5183b5d1ccc6937d8cd0385a6951a35144f`, merge `fcf727f9250c8bf6903c87eb35ee59956c41f637`, and dated SR-058 production snapshot. Preserve the two-High security repair through exact accepted PR #24 head `e580b73468f1022f23e0dcb84961e18ba877edca`, merge `af795371e2321fb445d3a7f81980cd6b7b6c2254`, and dated SR-062/SR-063 Vercel/Supabase/Edge production proof plus the separately labeled live UI operator observation.

SR-045 records the performed outward recovery sequence. SR-046 and SR-047 correct its provenance and status-definition boundaries without rewriting it. SR-048 records PR #18's exact merge and then-current production deployment; SR-049 corrects the unsupported inference that governed tip `5f2733e` received its own exact-SHA Sol acceptance; SR-050 records Mason's PR #19 publication authority, its time-bounded open/not-merged state, and the review corrections carried there; SR-051 records PR #19's later merge/deployment facts and establishes dated publication snapshots so later repository activity cannot silently make a truthful historical statement false. SR-056/SR-057 preserve the Deno compatibility defect, bounded lock repair, exact evidence, and immutable acceptance; SR-058 records PR #21's merge and dated exact-production verification; SR-062 records PR #24's accepted merge, schema-only migration, exact Edge deployment, live service verification, and original closeout claims; SR-063 corrects the SR-062 ACL and live-UI evidence boundaries without rewriting it. Repository, deployment, domain/DNS/TLS, redirect configuration, redacted Auth event chain, exact deletion, retained-user count, and the durable SR-062/SR-063 production events are recorded; the browser-only SR-062 UI check and browser/mailbox-only recovery statements remain **OPERATOR-OBSERVED**. The redacted recovery evidence index is the controlling map for that distinction. Migration `20260812135210` intentionally changed execution ACLs on the push functions so revalidation is service-role-only and internal helpers are restricted. No customer data, real farmer account, permanent farm access, Auth setting, secret, unrelated project/customer permission, or customer communication changed during SR-062/SR-063.

The initiative remains **RELEASE CANDIDATE READY**, not **COMPLETE**. The physical iPhone/Safari and Android/Chrome installed-PWA customer-zero journeys remain unperformed and must include privacy, weak-signal, recovery, and stale-access behavior. The external-Chrome mailbox/UI observations cannot be promoted beyond **OPERATOR-OBSERVED** unless a stronger redacted artifact is committed. Connect Workflows later added the explicit-save Weather-to-Spray prefill and confirmed Program-to-Inventory matching described under **Current capability truth**; its ledger records source publication and the two production migrations, while also recording that no production CW user path was exercised. Any new outward action, live mutation, real customer action, or production change beyond the already performed sequence requires its own authority.
