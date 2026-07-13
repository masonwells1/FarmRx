# Grain marketing foundation audit

**Date:** 2026-07-13  
**Scope:** Static code and documentation audit only. No network, live database, secrets, migrations, source files, packages, commits, or pushes were touched.

## Result

**2 P0, 5 P1, 5 P2, 1 P3 findings.** The most urgent risks are an unprotected firm-offer conversion that can create two sales, and a “safe to forward” fallback that reports the insurance guarantee instead of the remaining amount after contracts. The bin ledger also has no defined cutover/source of truth, so it can double-count physical grain.

## Severity guide

- **P0** — money-wrong, data-loss, or security exposure that can directly create a bad business record.
- **P1** — broken feature or material operational result that can mislead a farmer.
- **P2** — correctness risk or incomplete control that needs a planned repair.
- **P3** — polish or clarity issue.

## Findings

### P0 — Firm-offer conversion is non-atomic and can record the same sale twice

**Evidence:** The fill flow writes the contract first, then separately changes the offer to `filled`. If the second write fails, it deliberately leaves an open offer with an already-created contract; its duplicate guard exists only in React component state and is lost on reload. [src/GrainModule.tsx:131-153](../../../src/GrainModule.tsx#L131-L153) The database permits a filled offer to reference a contract, but has no uniqueness rule or transaction that makes the pair one action. [supabase/migrations/0028_firm_offers.sql:19-21](../../../supabase/migrations/0028_firm_offers.sql#L19-L21) [supabase/migrations/0028_firm_offers.sql:41-61](../../../supabase/migrations/0028_firm_offers.sql#L41-L61)

**Farmer failure scenario:** A $5.00/bu, 20,000-bu firm offer fills. The contract insert succeeds, but the offer-status save drops during a connection problem. After refreshing, the offer still looks open; “Mark filled” makes a second 20,000-bu contract. Position, marketed percentage, and planned revenue now count 40,000 bu for one buyer commitment.

**Suggested fix:** Replace the two browser writes with one security-invoker RPC/transaction: lock the offer row, reject a non-open offer, insert one contract with a durable `source_offer_id` (unique), update the offer, and return both canonical rows. Recovery must look up `source_offer_id` before inserting, not rely on page state.

### P0 — “Safe to forward” fallback does not subtract already contracted bushels

**Evidence:** The Revenue Protection (RP) aggregate path correctly computes `guaranteedBushels - contractedBushels`, but the insurance-unit fallback assigns the full guaranteed amount directly to `safeToForward`. [src/GrainModule.tsx:207-216](../../../src/GrainModule.tsx#L207-L216) The fallback therefore applies whenever the profitability workspace cannot be read, no qualifying allocation exists, or allocation is marked ambiguous. The lower-level RP calculator likewise names the raw guarantee `safeToForwardBushels`; it does not subtract contracts itself. [src/data/insuranceMath.ts:34-45](../../../src/data/insuranceMath.ts#L34-L45)

**Farmer failure scenario:** Insurance units guarantee 144,000 bu and the farm already has 120,000 bu contracted. An unavailable/ambiguous profitability allocation makes the card show “Safe to forward: 144,000 bu” rather than 24,000. A farmer can reasonably forward another 100,000 bu and become badly overcommitted.

**Suggested fix:** Compute one named `remainingSafeToForward = max(0, guaranteedBushels - contractedBushels)` for **every** source, display its source and inputs, and test normal, unavailable, no-allocation, and ambiguous-allocation paths. Make the contract form warn/block above the remaining limit unless an explicit documented override is supplied.

### P1 — Bin on-hand has no cutover rule and can double-count opening inventory plus ledger receipts

**Evidence:** Displayed on-hand is always `bin_inventory.bushels + all matching in/out ledger movements`, with no use of `measured_at`, `occurred_on` cutover, or `source_kind`. [src/data/binLedger.ts:30-42](../../../src/data/binLedger.ts#L30-L42) The screen explicitly presents this sum as on-hand. [src/GrainModule.tsx:228](../../../src/GrainModule.tsx#L228) Yet the approved design says the snapshot remains the displayed on-hand source until a cutover, opening entries, and derived-balance implementation are separately completed. [docs/schema-phase2-grain-marketing.md:37-41](../../schema-phase2-grain-marketing.md#L37-L41)

**Farmer failure scenario:** A bin snapshot is measured at 27,800 bu. The farmer later records the same harvest receipt history as a 27,800-bu ledger `in`, expecting the ledger to be the record. The card reports 55,600 bu. The “free” amount, stored-bushel display, and capacity decision are wrong.

**Suggested fix:** Choose and implement one source of truth before relying on the ledger: either (a) keep `bin_inventory` as the display source and show ledger only as non-balancing history, or (b) add a migration-backed cutover/opening balance and derive on-hand solely from immutable movements after it. Encode the invariant in database constraints/RPCs and regression scenarios; do not infer it in the UI.

### P1 — Bin capacity and commodity integrity are not enforced for appended movements

**Evidence:** The repository validates only an individual movement’s positive amount, date, and commodity text; it does not load the bin position, check capacity, or require the bin’s established commodity. [src/data/binLedger.ts:19-27](../../../src/data/binLedger.ts#L19-L27) [src/data/SupabaseGrainRepository.ts:81-82](../../../src/data/SupabaseGrainRepository.ts#L81-L82) The gateway performs a plain insert, and the migration’s insert policy checks only edit permission and same-farm parentage. [src/data/SupabaseGrainDataGateway.ts:49-50](../../../src/data/SupabaseGrainDataGateway.ts#L49-L50) [supabase/migrations/0029_bin_upgrades.sql:70-78](../../../supabase/migrations/0029_bin_upgrades.sql#L70-L78) The UI caps the fill graphic at 100%, so 1,200 bu in a 1,000-bu bin visually appears as “100%” rather than an over-capacity condition. [src/GrainModule.tsx:228](../../../src/GrainModule.tsx#L228)

**Farmer failure scenario:** An empty 1,000-bu IP corn bin receives a 1,200-bu `in` movement. The card shows 1,200/1,000 but the bar reads 100%; no guard prevents a later soybean movement through another client/API path. The physical capacity and IP segregation record are no longer trustworthy.

**Suggested fix:** Append through a server transaction that locks the bin/derived position, validates established commodity and `0 <= resulting_on_hand <= capacity`, and rejects the write on violation. Show an explicit over-capacity/error state for legacy bad rows rather than capping the visual at 100%. Add a source/cutover rule first, because capacity cannot be soundly enforced against an ambiguous balance.

### P1 — Cash/basis valuation has no delivery or futures-contract identity, so it can value a position with the wrong market

**Evidence:** `latestBasis` selects the newest manual bid for only farm and commodity; it ignores elevator, delivery window, crop year, futures month, and freshness. [src/data/basisMath.ts:6-11](../../../src/data/basisMath.ts#L6-L11) The position card injects that one basis into every HTA open leg and into planned cash/revenue. [src/GrainModule.tsx:202](../../../src/GrainModule.tsx#L202) The cash-bid entry creates no delivery window at all, despite the data model supporting one. [src/GrainModule.tsx:234](../../../src/GrainModule.tsx#L234) Contracts themselves also have no futures symbol/month field. [src/data/grain.ts:46-60](../../../src/data/grain.ts#L46-L60)

**Farmer failure scenario:** A farmer holds December HTA corn with a -$0.20 December basis. The newest manual bid is a +$0.05 nearby cash/harvest bid. The position uses +$0.05 for the December HTA, overstating 50,000 bu by $0.25/bu ($12,500) and making the wrong storage/sale choice look attractive.

**Suggested fix:** Record an explicit pricing identity on bids and contracts: elevator/location, delivery start/end, crop year, and futures contract/month where applicable. Require the valuation selector to match that identity (or show “no comparable quote”), and add an as-of/freshness bound. Do not use a commodity-wide “latest basis” for contract or revenue math.

### P1 — Planned revenue treats a labeled cash target as futures, then adds basis and premium again

**Evidence:** The editor labels the field simply “Target price $/bu” and calculates its ROI-derived value from break-even, with no futures/cash choice. [src/GrainModule.tsx:238](../../../src/GrainModule.tsx#L238) The position then defines planned cash as `target_price + basis + premium`; it also uses that target as the futures price for basis contracts. [src/GrainModule.tsx:37](../../../src/GrainModule.tsx#L37) [src/GrainModule.tsx:202](../../../src/GrainModule.tsx#L202) This conflicts with alert validation, which compares the same `target_price` directly to `cash_bids.cash_price` as a cash target. [src/data/grainAlerts.ts:14-16](../../../src/data/grainAlerts.ts#L14-L16)

**Farmer failure scenario:** A farmer enters a $4.80 **cash** target. With a -$0.20 basis, the revenue card values unpriced grain at $4.60 (or adds an IP premium on top), while the alert correctly treats $4.80 as a cash-price trigger. A 100,000-bu forecast is off by at least $20,000.

**Suggested fix:** Make `target_price` one unambiguous unit: preferably `target_cash_price_per_bu`, used directly for cash alerts and planned revenue. If futures targets are needed, add a separate futures field with contract month and only then compute `futures + matched basis + qualified premium`. Migrate/label existing values before release.

### P1 — IP premium forecast uses an arbitrary default and an unweighted average

**Evidence:** For an IP-eligible commodity, the estimator returns a default $0.25/bu when there are no premium contracts. With contracts, it averages premium cents per row rather than by contracted bushels. [src/GrainModule.tsx:38](../../../src/GrainModule.tsx#L38) That estimated premium is added to all planned unpriced bushels. [src/GrainModule.tsx:202](../../../src/GrainModule.tsx#L202)

**Farmer failure scenario:** One 1,000-bu contract has a $0.40 premium and one 99,000-bu contract has no premium. The app uses $0.20 rather than the $0.004 weighted average; on 100,000 unpriced bu it overstates planned revenue by about $19,600. With no contract, it invents $25,000 of revenue on 100,000 bu from the default.

**Suggested fix:** Never invent an IP premium. Use only a separately entered, delivery-qualified expected premium, or show it as unknown. When using confirmed contracts for reference, weight by bushels and restrict to the same identity-preserved program/delivery identity.

### P2 — Movement-only bin totals appear in every crop year for the same commodity

**Evidence:** `deriveCommodityBinTotal` filters snapshot inventory by crop year, but a bin without `bin_inventory` has no crop-year check and is included solely by commodity. [src/data/binLedger.ts:45-52](../../../src/data/binLedger.ts#L45-L52) `BinTransaction` has no crop-year column. [src/data/grain.ts:88-92](../../../src/data/grain.ts#L88-L92) The marketing plan status displays that total for the selected crop-year scope. [src/GrainModule.tsx:222](../../../src/GrainModule.tsx#L222)

**Farmer failure scenario:** A movement-only bin holds 5,000 bu of 2025 corn. Opening the 2026 corn plan reports 5,000 bu “in bins,” making old-crop stock look available for the new-crop plan.

**Suggested fix:** Add an immutable crop-year/lot identity to ledger movements (or a current lot table with a controlled transfer), then scope aggregation by that identity. Until then, display movement-only physical inventory outside crop-year marketing totals.

### P2 — Contracts can exceed production and the displayed safe-forward limit without an actionable guard

**Evidence:** Contract validation requires only positive finite bushels and type/price shape; it has no comparison to active production, existing contracts, or safe-to-forward capacity. [src/data/grain.ts:123-136](../../../src/data/grain.ts#L123-L136) The write path repeats only that validation. [src/data/SupabaseGrainRepository.ts:64-65](../../../src/data/SupabaseGrainRepository.ts#L64-L65) The position clamps unpriced bushels at zero after totaling contracts, so it does not surface the amount oversold. [src/GrainModule.tsx:202](../../../src/GrainModule.tsx#L202)

**Farmer failure scenario:** Projected production is 200,000 bu and 190,000 bu are contracted. A user enters another 50,000-bu sale; it saves, the card reports no unpriced bushels rather than 40,000 oversold, and the farmer misses the exposure.

**Suggested fix:** Before save, calculate active production, contracted quantity, and remaining insured safe-forward capacity. Warn prominently and require a reasoned override for legitimate bought grain/expected production cases; otherwise reject. Display `contracted`, `remaining`, and `overcommitted` quantities separately.

### P2 — Plan/status timing uses the device month without the selected crop year

**Evidence:** Plan status uses `new Date().getMonth() + 1` and includes every target whose month number is at or before that number, without comparing the target’s year to today or the selected crop year. [src/GrainModule.tsx:222](../../../src/GrainModule.tsx#L222) Targets are allowed from the crop year before through the year after. [supabase/migrations/0004_module2_grain.sql:125-133](../../../supabase/migrations/0004_module2_grain.sql#L125-L133)

**Farmer failure scenario:** In July 2026, a farmer opens a 2027 crop plan. The status calls January–July 2027 targets “planned through July” even though they are still future dates, falsely marking the plan behind.

**Suggested fix:** Compare full local calendar dates, not month numbers. For a future crop year, show “pre-season / no targets due”; for carryover grain, use each target’s real month/date and a clearly chosen marketing-year convention.

### P2 — Core target/report alerts use UTC days while rule alerts use the farmer’s local day

**Evidence:** Plan-target and USDA alerts derive `today` from `toISOString()` (UTC). [src/data/grainAlerts.ts:6-18](../../../src/data/grainAlerts.ts#L6-L18) Marketing-rule alerts deliberately use the device-local calendar. [src/data/marketingAlerts.ts:7-10](../../../src/data/marketingAlerts.ts#L7-L10) Both are evaluated together when Grain refreshes. [src/GrainModule.tsx:55](../../../src/GrainModule.tsx#L55)

**Farmer failure scenario:** At 7:30 PM Central on July 12, UTC is already July 13. The July 13 USDA/target alert can be emailed a local day early; at 7:30 PM July 13 it is treated as July 14 and the “today” alert is gone.

**Suggested fix:** Pass one `localCalendarDay(now)` into every client evaluator and test Central-time UTC-boundary cases for today, seven-days-out, weekends, and daylight-saving changes. The delivery function should revalidate the alert date against the same stated calendar policy.

### P2 — Delivery endpoint accepts stale or malformed price-target evidence

**Evidence:** The Edge Function confirms only that the referenced bid has cash price at least `target.target_price`; it does not require a non-null numeric target price, freshness, USDA-business-day eligibility, delivery identity, or a matching crop-year scope. [supabase/functions/deliver-grain-alert/index.ts:19-25](../../../supabase/functions/deliver-grain-alert/index.ts#L19-L25) The client evaluator has a 36-hour weekday freshness check, but the endpoint does not repeat it. [src/data/grainAlerts.ts:6-16](../../../src/data/grainAlerts.ts#L6-L16)

**Farmer failure scenario:** A signed-in owner can replay an old high cash bid with a plan row that has no target price, or use a stale/incorrect delivery bid, and cause a misleading “price target reached” email to all configured recipients. This is not cross-farm access, but it weakens the endpoint’s claimed canonical verification.

**Suggested fix:** Validate `target_price` is a finite number, re-evaluate the full condition server-side (date/freshness/calendar, commodity, intended delivery identity), and reject an expired/stale observation. Store a durable delivery receipt keyed by farm + deterministic alert key if duplicate suppression is meant to be dependable across function instances.

### P3 — Firm cash offers with a future contract month become “cash spot” contracts

**Evidence:** `offerToContract` converts every cash offer to `cash_spot`, even though it derives a future month delivery window from `contract_month`. [src/data/firmOffers.ts:11-18](../../../src/data/firmOffers.ts#L11-L18) [src/data/firmOffers.ts:53-57](../../../src/data/firmOffers.ts#L53-L57)

**Farmer failure scenario:** A December cash offer is filled and displayed/reported as a spot sale rather than a forward-cash contract. Price math happens to match today, but records, filtering, and later delivery reporting become misleading.

**Suggested fix:** Make the offer explicitly declare cash-spot versus forward-cash, or map a valid future delivery window to `forward_cash` and preserve that choice in the confirmation UI.

## Representative numerical traces

| Scenario | Expected business result | Actual traced result |
|---|---:|---:|
| 144,000 insured safe-forward bu; 120,000 contracted; RP workspace unavailable | 24,000 bu remaining | Card displays 144,000 bu because fallback skips contract subtraction. [src/GrainModule.tsx:202-216](../../../src/GrainModule.tsx#L202-L216) |
| 27,800-bu snapshot plus a later/duplicated 27,800-bu `in` ledger entry | One controlled balance, never 55,600 without a clear cutover | `27,800 + 27,800 = 55,600` displayed; dates/source are ignored. [src/data/binLedger.ts:30-42](../../../src/data/binLedger.ts#L30-L42) |
| 1,000-bu bin, 1,200-bu inbound movement | Reject or visibly flag 200-bu overflow | Plain insert succeeds under current validation/policy; UI caps fill at 100%. [src/data/SupabaseGrainDataGateway.ts:49-50](../../../src/data/SupabaseGrainDataGateway.ts#L49-L50) [src/GrainModule.tsx:228](../../../src/GrainModule.tsx#L228) |
| $4.80 target described to farmer as cash; -$0.20 basis; 100,000 bu open | $480,000 cash valuation before separate qualified premium | App calculates $4.60/bu planned cash, $460,000, because it adds basis to the ambiguous target. [src/GrainModule.tsx:202](../../../src/GrainModule.tsx#L202) [src/GrainModule.tsx:238](../../../src/GrainModule.tsx#L238) |
| 20,000-bu filled offer; contract write succeeds, offer update fails; user reloads | One 20,000-bu contract | A new fill can create a second contract because the recovery guard was only page state. [src/GrainModule.tsx:131-153](../../../src/GrainModule.tsx#L131-L153) |

## Checked and found good

- **Contract price shapes:** client and database require cash/forward-cash cash price, basis-contract basis, HTA futures price, positive bushels, nonnegative cash/futures values, and ordered delivery dates. No real issue found in these base shape checks. [src/data/grain.ts:123-136](../../../src/data/grain.ts#L123-L136) [supabase/migrations/0004_module2_grain.sql:90-97](../../../supabase/migrations/0004_module2_grain.sql#L90-L97)
- **Cash convention for complete contracts:** final contract cash is correctly `cash + premium` or `futures + basis + premium`; this part is separate from the planned-price ambiguity above. [src/GrainModule.tsx:31-35](../../../src/GrainModule.tsx#L31-L35)
- **Marketing-plan replacement:** scoped replacement uses a dedicated RPC, validates duplicate months/100% ceiling, and verifies returned canonical rows. No real issue found in plan replacement atomicity. [src/data/SupabaseGrainDataGateway.ts:39-42](../../../src/data/SupabaseGrainDataGateway.ts#L39-L42) [src/data/SupabaseGrainRepository.ts:66-68](../../../src/data/SupabaseGrainRepository.ts#L66-L68)
- **MARS exclusion from position basis:** `latestBasis` excludes tagged USDA MARS rows, and the regression explicitly checks a newer MARS row cannot replace a manual basis in position math. No real issue found in this boundary. [src/data/basisMath.ts:3-10](../../../src/data/basisMath.ts#L3-L10) [src/data/SupabaseGrainRepository.regression.ts:170-176](../../../src/data/SupabaseGrainRepository.regression.ts#L170-L176)
- **Firm-offer pending math:** open, expired, filled, and canceled statuses are distinguished for pending quantity; pending offers are not counted as sold. No real issue found in that calculation. [src/data/firmOffers.ts:44-50](../../../src/data/firmOffers.ts#L44-L50) [src/data/firmOffers.regression.ts:21-24](../../../src/data/firmOffers.regression.ts#L21-L24)
- **Ledger immutability and retry identity:** movement rows have insert/select only at the database layer, and queued replay reconciles an unknown successful append by exact immutable ID/fields before retrying. No real issue found in append retry deduplication. [supabase/migrations/0029_bin_upgrades.sql:51-78](../../../supabase/migrations/0029_bin_upgrades.sql#L51-L78) [src/data/QueuedGrainRepository.ts:24-31](../../../src/data/QueuedGrainRepository.ts#L24-L31)
- **Moisture validation:** the client rejects invalid/future dates, requires percentage/date together, flags moisture above 15% and readings older than 30 days, and has regression coverage for the 15.00/15.01 and 30/31-day boundaries. No real issue found in the client-side moisture rules. [src/data/binLedger.ts:7-16](../../../src/data/binLedger.ts#L7-L16) [src/data/binLedger.regression.ts:23-33](../../../src/data/binLedger.regression.ts#L23-L33)
- **Marketing-rule schema/type validation:** rule types, directions, thresholds, local-calendar same-day suppression, and orphan-scope handling have matching client validation and focused regression coverage. No real issue found in those rule-shape checks. [src/data/marketingAlerts.ts:15-17](../../../src/data/marketingAlerts.ts#L15-L17) [src/data/marketingAlerts.regression.ts:18-33](../../../src/data/marketingAlerts.regression.ts#L18-L33)
- **Cost-of-carry arithmetic:** storage, annual-interest prorating, one-time flat storage/trucking, harvest baseline, and verdict selection calculate consistently in the focused regression suite. No real unit/time-basis arithmetic issue found. [src/data/costOfCarry.ts:24-51](../../../src/data/costOfCarry.ts#L24-L51) [src/data/costOfCarry.regression.ts:9-35](../../../src/data/costOfCarry.regression.ts#L9-L35)

## Verification performed

Static tracing covered Grain UI, cost-of-carry, contracts, firm offers, basis/cash bids, bin ledger and callers, insurance/RP aggregation, alert evaluators and Edge delivery code, Supabase gateways/repositories/queues, migrations 0004/0012/0027/0028/0029/0030, and the grain design documents.

The following local, network-free suites all passed:

```text
src/data/costOfCarry.regression.ts
src/data/insuranceMath.regression.ts
src/data/marketingAlerts.regression.ts
src/data/firmOffers.regression.ts
src/data/binLedger.regression.ts
src/data/SupabaseGrainRepository.regression.ts
```

Passing tests do not cover the P0/P1 integration scenarios above: fill-status failure followed by reload, safe-forward fallback after contracts, ledger cutover/double count, transaction capacity enforcement, or cash/futures/delivery identity.

## Recommended repair order

1. Stop duplicate offer fills with an atomic server conversion and durable source-offer uniqueness.
2. Correct safe-to-forward to remaining capacity in every insurance path and add contract-entry protection.
3. Freeze or relabel bin movement balances until a single source of truth, crop-year lot identity, and server-enforced capacity/commodity rules exist.
4. Separate cash and futures target semantics; add delivery/futures identity before using bids in revenue valuation.
5. Make all alert date/freshness checks use one calendar policy and revalidate the full condition in the delivery endpoint.
