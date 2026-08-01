# STANDING GOAL — Farm Rx 2027 Season-Ready

**Owner:** Mason Wells · **Directed:** 2026-07-18 · **Current state:** RELEASE CANDIDATE READY; the six-scenario 2027 packet remains accepted at `8a9565a08a760e0ec920170bfacee1d9132cba47`, and worker-free password recovery plus PR-review hardening is locally accepted at `2c4fadb1d8f4bbffe025dc92aa1a79caa02efba4`; PR #17 still points to older remote head `102f69d43db2b3c0ac9be95b72779e8f0d982e79`, current remote/production `main` remains `45dc52f425ee844a0ddc473d514cce748e61c559`, and the authorized outward sequence is pending; not COMPLETE

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

## Current capability truth

These statements are the baseline. A test must not claim more coupling than the product has.

1. Marking a Program pass applied may create a new **draft** application record or link an existing application record. Free-typed Program products are not matched to Inventory products and do not change Inventory on-hand.
2. Weather guidance and spray records both exist. A farmer manually transcribes weather into a spray record; there is no weather-to-spray provenance link.
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

## Unresolved customer-zero gates carried forward

The prior engineering release did not close these operational gates, and the 2027 timing does not waive them:

- The 2026-08-01 operator tranche configured the SMTP provider, and an authenticated Vercel check confirmed exact production `VITE_PASSWORD_EMAIL_DELIVERY_ENABLED=true`; disposable recovery messages arrived, but that pre-repair journey exposed the stale service-worker defect and does not count as final end-to-end proof. PR review repairs are freshly accepted at exact `2c4fadb1d8f4bbffe025dc92aa1a79caa02efba4`, including automatic completion handoff, origin-bound/session-lineage cleanup authority, offline-only cleanup, newer-session preservation, and cleanup retry. That SHA is local only; PR #17 still points to `102f69d43db2b3c0ac9be95b72779e8f0d982e79`, production/main remains `45dc52f425ee844a0ddc473d514cce748e61c559`, `recovery.croprxsolutions.app` is unconfigured/NXDOMAIN, and the exact Supabase redirect is not enabled. Mason has authorized this exact publication/deployment/domain/Auth/disposable-email sequence, but none of those pending actions receives completion credit yet.
- The two physical-phone customer-zero journeys—iPhone/Safari and Android/Chrome—must be performed and recorded, including installed-PWA, privacy, weak-signal, recovery, and stale-access behavior.

No real farmer account may be provisioned and no customer communication may be sent under this goal before Mason separately authorizes those actions and the applicable gates are proven.

## Current next step

Preserve the accepted six-scenario release candidate at immutable source/runtime commit `8a9565a08a760e0ec920170bfacee1d9132cba47`; SR-035/SR-036 remain its accepted proof. PR #15 and the documentation-only PR #16 are now ancestors of current remote `main` `45dc52f425ee844a0ddc473d514cce748e61c559`. Current production deployment `dpl_Fe9UHdAiwoF8ucczm8kgHnZYczrJ` is `READY`, uses that exact `main` SHA, is aliased to `farm-rx.vercel.app`, and returned HTTP `200`. Those facts do not authorize another outward action.

SR-041 preserves the predecessor recovery acceptance at exact `e012e718aec1f5492894891a3df92544c1c4951f`; it is an ancestor of PR #17's older remote head, not the current local acceptance point. SR-042 records the controlling accepted source at exact `2c4fadb1d8f4bbffe025dc92aa1a79caa02efba4`: its complete foundation gate passed with 62 browser scenarios and 12 intentional skips, 21/21 controlled mutations were rejected, the season contract remained green, and fresh-context read-only Sol returned **ACCEPT — no merge blockers**. The repair retains the dedicated worker-free recovery origin and adds authenticated completion cleanup, offline-only cleanup, automatic terminal handoff, transactional newer-session preservation, and exact-user cleanup retry.

SR-042 adds the accepted PR-review repair chain at exact `2c4fadb1d8f4bbffe025dc92aa1a79caa02efba4` and records Mason's explicit authorization for this exact publication, automatic deployment, recovery-domain/DNS, Supabase redirect, disposable Auth/email/external-Chrome proof and cleanup, and follow-up governed closeout sequence. The initiative remains **RELEASE CANDIDATE READY**, not **COMPLETE**: accepted `2c4fadb1` is still local while PR #17 points to older `102f69d4`; no accepted recovery source is merged or deployed; the recovery hostname/DNS and exact Supabase redirect are not configured; and no final no-bypass live Chrome/email proof exists. Physical iPhone/Safari and Android/Chrome installed-PWA journeys also remain unperformed. Weather-to-spray remains manual payload-free transcription with no provenance link, integration, or automatic prefill. No migration, customer data, real farmer account, or customer communication is authorized or credited.
