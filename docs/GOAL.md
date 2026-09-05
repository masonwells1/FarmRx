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
- **Recorded backlog, not authorized:** a Today/home "needs attention" view summarizing all modules. Do not build it under this amendment. *(Superseded on 2026-09-05: the owner amendment below authorizes the Today home screen as Initiative FD.)*

## Owner scope amendment — 2026-09-05

**Owner:** Mason Wells · **Directed:** 2026-09-05 (`America/Chicago`) · **Basis:** [`docs/strategy/2026-09-05-farmer-value-strategy.md`](strategy/2026-09-05-farmer-value-strategy.md) and Mason's numbered answers to its eight decisions.

Mason authorizes the bounded build initiatives below. For these initiatives only, this amendment supersedes the "no standalone modules … or speculative features" line of the Product boundary and the 2026-08-10 "Recorded backlog, not authorized" line about a Today/home view. Every other boundary line remains in force: no vendors, no broad redesigns, no proof-only `run_id` product column, no invented pending integrations, no live machine-data or licensed market-data feeds. The 2027 no-real-farmer directive, the privacy model, Row Level Security, and every outward-action approval gate are unchanged.

### Recorded owner decisions

1. **Today home screen: authorized** (Initiative FD below).
2. **Barchart OnDemand: declined** as too expensive. Board quotes remain the display-only TradingView widgets. No number Farm Rx computes may depend on a board price. The USDA AMS My Market News (MARS) feed is public-domain government data, not a vendor, and is authorized under Initiative GL.
3. **Pricing model: free to active Crop RX customers; paid for anyone else.** This is a business decision, not a build item; no billing code is authorized by this amendment.
4. **Scale tickets / loads: authorized as a top-priority build** (Initiative LD below), sequenced immediately after FD and GL.
5. **Prepay balance tracking: deferred** until the CRX Manager → Farm Rx delivery pipeline exists. Mason is completing CRX Manager first. Not authorized here.
6. **"We set up your numbers" service: free for pilot farms;** pricing decided afterward. No build item.
7. **Pilot farms: agreed in principle, names to follow.** No real farmer account may be provisioned and no customer communication may be sent until Mason names the farms, the two physical-phone journeys in "Unresolved customer-zero gates" are recorded, and email delivery from the ship checklist is proven.
8. **Process: loosened for screen work** (see "Verification tiers" below). Approval gates on push, pull-request mutation, merge, deploy, live migration, live data, secrets/auth/permissions, customer accounts, and destructive actions are unchanged.

### Build order

FS → FD → GL → LD → CM → IP. One writer session per initiative; an initiative may start when the prior one's final tranche has a committed, reviewed tip, even if its pull request is still open.

### Initiative FS — Friction Sweep (one tranche, may be split by module)

Small, visible repairs to existing screens. No schema change. Replace browser `prompt`/`confirm` dialogs with in-app dialogs in the Crop RX design system; persist the Grain sale limit, the cost-of-carry grid, and the U of I default badges to the database instead of one browser's local storage; seed `usda_report_dates` by migration; derive the TradingView contract months from the crop year instead of the hardcoded 2026/2027 symbols; give the matrix, cost table, cost-of-carry, and plan-comparison tables phone layouts; plain-English relabel pass; one sentence and one button on every empty state.

### Initiative FD — Front Door (two sequenced tranches)

- **FD-1 Today screen.** A new `/today` route becomes the default route after sign-in and the first item in phone and desktop navigation. The visual target is Mason's selected July 2026 direction, archived at [`archive/audits/2026-07-16-farmer-simplicity-loop/SELECTED-VISUAL-OPTION-2.png`](archive/audits/2026-07-16-farmer-simplicity-loop/SELECTED-VISUAL-OPTION-2.png) (SHA-256 `d62cf7297313c1d4aa622ceb19c543b9acfa92e1d493127fa49fde109ea10d38`): a **"What are you recording?"** grid of Rain · Scouting note · Spray record · Task · Harvest · Grain delivery, each opening the existing module form (no new write paths); the existing Weather spray-window card; and a **Next up** list built only from records existing modules already produce (overdue service, low inventory, tasks and program passes due, fired grain alerts). Today is read-only: it must not replay queues, write caches, or generate due items during an ordinary read, consistent with the July Farmer Simplicity snapshot rule. Role-shaped: a member without financial access never sees a grain line.
- **FD-2 Grain line and phone navigation.** For members with financial access, one plain-English grain line on Today (percent sold vs plan, latest local bid and its change) reading the same values the Grain Overview shows. Phone bottom bar becomes Today · Grain · Fields · Record · More; Inventory and Programs leave the More menu where role allows.

### Initiative GL — Grain Live (three sequenced tranches)

- **GL-1 USDA MARS basis feed.** A scheduled Supabase edge function pulls the daily USDA AMS cash-grain-bid report for the farm's region and writes rows to `cash_bids` with the existing `[USDA MARS 2850]` provenance marker, once per market day, cached server-side. Feed rows remain display-and-history only: the existing `isMarsBid` fences stay, no feed row may trigger a write, and staleness is shown in plain words. Basis history grows from the feed without farmer typing.
- **GL-2 Server-side alerts.** Extend the existing `scheduled-alert-sweep` to evaluate marketing alert rules once per market day after GL-1 lands, delivering through the existing `send-push` and `deliver-grain-alert` functions with the same owner-only, farm-fenced, revocation-denying semantics. Price rules may evaluate against MARS rows as well as farmer-typed bids. The on-page disclaimer changes from "check-on-open" to the true schedule. Barchart and any board-price computation remain absent per decision 2.
- **GL-3 Dead ends and position card.** Type-ahead buyer entry (free text with suggestions) replacing the empty dropdown; remove the hardcoded "Cargill - Olney" default; crop and crop-year picker on the Contracts tab; totals row; edit and delete for a contract with no deliveries, with confirmation and a reason; "Add another crop" after the first production estimate; position card reduced to one hero line, three tiles, and a *More details* disclosure. No change to contract math or to the one-shot price-leg finalization rule.

### Initiative LD — Loads (three sequenced tranches; top priority per decision 4)

- **LD-1 Load record.** A new farm-scoped `grain_loads` table and screen: date, truck (free text or existing Equipment asset), origin (a bin or a field crop assignment), destination (a buyer/elevator, a contract, or a bin), gross, tare, net bushels, moisture, ticket number, optional photo, notes. Private financial data under the existing `can_read_private_financials` fence. Append-only with void-and-reason, matching the bin ledger.
- **LD-2 Load effects, explicit.** On the load form the farmer sees exactly what saving will do and can uncheck any of: record a delivery against the chosen contract; append a bin-out movement from the origin bin; append a bin-in movement to a destination bin; add net bushels to the field crop's harvest actual. Each effect is a separate visible write that the farmer confirmed on that save. Nothing happens silently. Capability truth item 4 below is amended: a load may perform both a bin movement and a contract delivery **only** as farmer-confirmed effects of one saved load record.
- **LD-3 Committed vs free.** Derive committed bushels per commodity from undelivered contract bushels and show free = on hand − committed on Bins and on the position card, replacing the unwritable `bin_inventory.committed_bushels` display. Read-only derivation; no new write.
- **Fence:** LD may change Grain, Harvest, and bin/contract/delivery code because the Harvest→Grain / Bin-out→Delivery work referenced in the 2026-08-10 CW fence is merged; that fence is retired for LD. LD must not change Inventory or Programs tables.

### Initiative CM — Connect the Money (four sequenced tranches)

- **CM-1 Inventory costs into budgets.** An importer, modeled on the existing equipment-cost snapshot importer, that reads the existing `application_cost_lines` view and writes `source_kind = 'inventory'` budget cost lines with provenance on explicit farmer confirmation.
- **CM-2 Planned vs actual.** Show Programs' planned $/ac and applications' actual $/ac beside the budget on the Profitability crop card. Read-only.
- **CM-3 Land-arrangement comparison.** A Profitability section calling the existing tested `planProfitUnderArrangement` to show owned / cash rent / flex / crop share side by side for an allocated field, with 2/3–1/3, 60/40, and 50/50 presets. Adds an `other` budget cost category by migration so the landlord "other inputs %" can apply.
- **CM-4 Export.** CSV download on every Profitability and Grain table; a generated, Crop RX-branded PDF for the banker report and landlord settlement replacing print-to-PDF; Simple/Advanced cost toggle; regional U of I defaults.

### Initiative IP — Inventory Planner (four sequenced tranches)

- **IP-1 Catalog link.** Program product lines may reference an Inventory product through the reserved `catalog_product_id`, with a picker and inline "Add new"; numeric rate + unit replaces free text for linked lines; free-typed lines remain valid.
- **IP-2 Planned vs on hand vs remaining.** Planned need = rate × assigned acres per linked product; a per-product view of planned, on hand, applied, remaining, and a *Short list*. Read-only derivation; no order is placed and nothing leaves the farm without an explicit, separate farmer action outside this initiative's scope.
- **IP-3 Mark applied carries products.** Prefill product, rate, and computed total from the pass into the created application record; allow one pass to both create the record and draw down inventory on confirmation, replacing today's either/or.
- **IP-4 Shed management and safety.** Add/edit product screens; multi-line receipts using the existing RPC; per-product reorder point; write the existing lot, expiration, and invoice columns; storage location; show cost per unit; applicator roster; REI re-entry and PHI harvest-safe dates per field; void/correct a spray record with a reason; compliance PDF.

### Verification tiers (decision 8)

- **Full runbook discipline** ([`season-readiness/ORCHESTRATOR-RUNBOOK.md`](season-readiness/ORCHESTRATOR-RUNBOOK.md): one tranche, one immutable commit, fresh-context read-only Sol review of the exact commit, repairs as new commits, disposable-backend database assertions) applies to any tranche that adds or changes a migration, Row Level Security, a permission or capability check, grain or financial privacy, money math, an edge function, or anything that writes to bins, contracts, deliveries, or on-hand quantities. In this amendment: FS persistence and seed migrations, GL-1, GL-2, all of LD, CM-1, CM-3's migration, IP-1's schema use, IP-2, IP-3, IP-4's write paths.
- **Screen tier** applies to tranches that only change presentation, navigation, labels, layout, or read-only display of existing data: forced TypeScript (`npx tsc -b --force`), `npm run regression`, `npm run build`, browser proof at one desktop and one phone size, and one fresh-context read-only review. In this amendment: FS dialog/label/layout work, FD-1, FD-2, GL-3's presentation changes, CM-2, CM-4's export UI.
- Every initiative keeps its own append-only ledger at `docs/initiatives/<initiative>/LEDGER.md`.

### Shared rules

Each initiative runs on its own branch cut from current `main`. Season proof, when a tranche requires it, uses synthetic fixtures and a disposable local backend. All approval gates in this document remain: no push, pull-request mutation, merge, deploy, live migration, live data, secret/auth/permission, customer, or destructive action without Mason's named approval.

## Current capability truth

These statements are the baseline. A test must not claim more coupling than the product has.

1. Marking a Program pass applied may create a new **draft** application record or link an existing application record. Separately, an exact existing Inventory product may be matched and drawn down only when the farmer explicitly confirms the match and quantity. Free-typed, unmatched, ambiguous, or unconfirmed Program products do not change Inventory on-hand.
2. Weather guidance and spray records both exist. A fresh field forecast may open the existing spray form with the field, forecast-local date, temperature, wind speed, and compass direction prefilled. The farmer can review or change every value and must explicitly save; stale Weather offers no prefill, the blank manual path remains available, and no navigation, provenance, provider, or background write is created.
3. Harvest writes update the crop assignment's harvest actuals. Grain reads the harvest total, but the user must explicitly choose **Use harvest total as Grain actual** before Grain actual production changes. That action does not change bins.
4. A manual bin-out movement and a contract delivery are separate user actions and separate writes. Neither silently creates or performs the other. Under Initiative LD (2026-09-05 amendment), one saved load record may perform both only as effects the farmer saw and confirmed on that save; no load effect is silent.

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
