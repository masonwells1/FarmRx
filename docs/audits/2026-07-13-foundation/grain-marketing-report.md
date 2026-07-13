# Grain Marketing Foundation Audit — 2026-07-13

## Verdict

**Do not rely on the current Grain screen for safe-to-forward decisions or planned-revenue decisions until the P0 items are fixed.** The core carry arithmetic, plan-replacement transaction, tenant binding, and several validation layers are sound. However, the screen can understate planned cash revenue, overstate remaining safe-to-forward bushels, and duplicate a sale when filling a firm offer.

Scope was code and documentation only. No network or live-database calls were made. `npm run regression` passed, but its coverage does not exercise the failures below.

Severity counts: **P0: 3, P1: 7, P2: 4, P3: 1.**

## P0 — Money wrong / major position risk

### P0-1 — A cash-price target is treated as futures, then basis is deducted again

`target_price` is presented as a “Target price $/bu” and price alerts compare it to a cash bid, so it is clearly a cash-price target in the UI. The position calculation nevertheless adds latest basis and IP premium to it before valuing unpriced bushels. `src/GrainModule.tsx:37`, `src/GrainModule.tsx:202`, `src/GrainModule.tsx:238`, `src/data/marketingAlerts.ts:34-37`

Failure scenario: A farmer sets a corn cash target of **$4.80/bu**, has a current basis of **-$0.20**, and 10,000 open bushels. The screen values those bushels at **$4.60**, understating planned revenue by **$2,000**. If the target was meant to be futures, the labels and alerts are wrong instead.

Suggested fix: Define `target_price` as either `cash_price_target` or `futures_price_target` explicitly. For the current cash-price UI, value open bushels directly at `target_price + applicable IP premium`; do not add basis. Add regression cases for positive and negative basis.

### P0-2 — “Safe to forward” is a total guarantee in the fallback path, not remaining capacity

The legacy insurance-unit formula correctly calculates insured guarantee bushels, but the displayed fallback does not subtract already contracted bushels. Only the Revenue Protection budget path subtracts contracts. `src/GrainModule.tsx:202`, `src/GrainModule.tsx:214-218`, `supabase/migrations/0004_module2_grain.sql:271-292`

Failure scenario: 10 insured acres × 200 APH × 80% coverage = **1,600 safe-to-forward bushels**. After 1,500 bushels are already contracted, the fallback card still shows **1,600 bu safe to forward**, inviting another 1,600-bushel sale and a 3,100-bushel total against a 1,600-bushel limit.

Suggested fix: Calculate and display both:

- Guaranteed bushels
- Already contracted bushels
- Pending firm-offer bushels
- Remaining safe-to-forward bushels, clamped at zero

Enforce the remaining limit before a contract or firm offer can be saved, with an explicit override workflow if intentional over-marketing is allowed.

### P0-3 — Filling a firm offer is not atomic and can create duplicate contracts

The UI writes the contract first, then separately marks the offer filled. Its in-memory duplicate guard is lost on refresh or another device/session. `src/GrainModule.tsx:131-153`, `src/GrainModule.tsx:226`, `supabase/migrations/0028_firm_offers.sql:19-20`, `supabase/migrations/0028_firm_offers.sql:50-61`

Failure scenario: A 10,000-bushel offer is accepted. The contract insert succeeds, but the offer update times out. After a refresh, the offer still appears open; filling it again creates a second 10,000-bushel contract. The position now reports 20,000 bushels sold, while only one offer was accepted.

Suggested fix: Replace the two client writes with one database RPC/transaction that:

1. Locks the offer row.
2. Rejects already-filled or expired offers.
3. Inserts or confirms one deterministic contract ID.
4. Marks the offer filled with that contract ID.
5. Returns both canonical rows.

Add concurrent and post-timeout replay tests.

## P1 — Broken feature or material correctness failure

### P1-1 — Bin movements can create impossible balances and exceed physical capacity

The movement table enforces only positive bushels and same-farm bin ownership. It does not prevent an outbound movement larger than on-hand, an inbound movement beyond bin capacity, or a conflicting commodity. The client clamps negative balances to zero and caps the visual fill bar at 100%, masking the magnitude of the problem. `supabase/migrations/0029_bin_upgrades.sql:22-40`, `src/data/binLedger.ts:30-42`, `src/GrainModule.tsx:228`, `src/data/SupabaseGrainRepository.ts:80-82`

Failure scenario: A 30,000-bu bin has 25,000 bu recorded. A user logs a 15,000-bu inbound movement. The app derives 40,000 bu but displays a full 100% bin, not an over-capacity exception. A 50,000-bu outbound movement similarly becomes “0 bu” after clamping instead of being rejected.

Suggested fix: Use a transaction/RPC that locks the bin position, establishes commodity identity, rejects below-zero and above-capacity balances, and returns the canonical balance. Display the actual overage if legacy data is already invalid.

### P1-2 — Inventory snapshots and ledger movements have no reconciliation boundary

On-hand is always `bin_inventory.bushels + all matching ledger movements`, but there is no baseline date, opening balance, or rule that says whether a movement is already included in the inventory measurement. The migration itself says the ledger is additive and does not make existing inventory derivable from ledger rows. `src/data/binLedger.ts:30-35`, `supabase/migrations/0029_bin_upgrades.sql:19-21`

Failure scenario: A bin inventory measurement of 25,000 bu is entered after a 10,000-bu receipt. If that receipt also exists in the ledger, the app reports 35,000 bu instead of 25,000.

Suggested fix: Choose one source of truth:

- Make an inventory measurement a dated baseline and include only movements after `measured_at`; or
- Convert inventory into an opening ledger transaction and derive all balances from the ledger.

Add a reconciliation status that exposes, rather than silently combines, mismatched data.

### P1-3 — Movement-only bin commodity is determined by the newest movement, not the first

The code says it uses the “first ledger movement,” but the gateway loads movements newest-first. Therefore `transactions[0]` is the latest movement and can redefine the displayed commodity. `src/data/binLedger.ts:37-42`, `src/data/SupabaseGrainDataGateway.ts:25`

Failure scenario: A movement-only bin receives corn, is emptied, then receives soybeans. Depending on movement order and data reload, prior corn history can be silently excluded as “mismatched,” and the current commodity is inferred from an incidental latest row.

Suggested fix: Persist a bin commodity/opening state, or determine commodity from a chronological, fully reconciled balance—not array order.

### P1-4 — Movement-only bin bushels are counted in every crop year

The commodity rollup applies crop-year filtering only when a `bin_inventory` row exists. A movement-only bin has no crop year, so its current balance is included for any selected crop year of that commodity. `src/data/binLedger.ts:45-52`, `src/GrainModule.tsx:222`

Failure scenario: A 12,000-bu movement-only corn bin appears in both the 2026 and 2027 marketing-plan status cards, making each year look like it has stored inventory.

Suggested fix: Put `crop_year` on every movement or maintain a dated/crop-year inventory baseline; exclude movement-only balances from year-specific plan totals until their crop year is known.

### P1-5 — Basis and HTA contracts cannot be completed into a final cash price in the UI

A contract is either basis-only or HTA-only. The calculation can value a row only if it somehow contains both futures and basis, but the entry form never allows both and there is no contract editing/completion workflow. `src/GrainModule.tsx:31-35`, `src/GrainModule.tsx:93`, `src/GrainModule.tsx:226`, `src/data/grain.ts:123-136`

Failure scenario: A farmer has a 10,000-bu HTA at $4.80 and later sets basis at -$0.20. Farm Rx continues to show it as “basis open” rather than a final $4.60 cash contract, leaving fully priced bushels and revenue wrong.

Suggested fix: Model a contract with independently closable futures and basis legs, or provide an edit/finalize action that records the missing leg, locks an audit trail, and recalculates final cash price.

### P1-6 — Contract delivery tracking is only dates; it cannot track delivery quantities or remaining obligation

Contracts store total bushels and a delivery date range, but no delivered bushels, settlement status, delivery tickets, or link to bin outbound movement/commitment. `src/data/grain.ts:46-60`, `src/GrainModule.tsx:93`, `src/GrainModule.tsx:222`

Failure scenario: A farmer contracts 20,000 bu for October–November and delivers 8,000 bu. The screen cannot show 12,000 bu remaining, cannot reconcile the delivery to storage, and cannot detect a bin commitment shortage.

Suggested fix: Add an append-only contract-delivery table with delivered bushels, date, ticket/reference, and optional bin movement link. Derive remaining commitment from deliveries.

### P1-7 — Quote selection is not crop-year or delivery-window aware; some alerts use stale quotes

`cash_bids` has no crop year or required delivery period, while `latestBasis` and marketing price alerts select only by commodity. Marketing-rule price alerts do not require freshness at all. `src/data/basisMath.ts:7-10`, `src/data/marketingAlerts.ts:19-22`, `src/data/marketingAlerts.ts:34-37`, `src/data/grain.ts:92`

Failure scenario: A 2027 corn target at $5.00 fires because the newest stored cash bid is a $5.10 2026 harvest bid. A stale $5.10 manual bid can keep generating alerts long after the elevator quote is no longer actionable.

Suggested fix: Require cash-bid crop year and delivery-window semantics, then select the newest fresh bid matching the rule/position scope. Show quote age and return “no actionable quote” rather than reusing history.

## P2 — Correctness and operational risk

### P2-1 — Generic plan-target price alerts can fire from display-only MARS data

The MARS helper explicitly classifies feed observations as display-only rather than manual bids, but generic target evaluation does not exclude them. `src/data/basisMath.ts:3-10`, `src/data/grainAlerts.ts:14-16`

Failure scenario: An Iowa pilot MARS cash observation reaches a target and triggers a farmer’s Illinois marketing alert, despite the basis-history UI saying the pilot feed is display-only.

Suggested fix: Apply `!isMarsBid(bid)` to target-alert candidates unless the product explicitly supports a farmer-enabled, location-matched feed as an alert source.

### P2-2 — Marketing-rule alerts repeat daily while the condition remains true

Rules are suppressed only for the local calendar day. Price, percent-marketed, and deadline rules then get a new daily alert key and can email again every day. `src/data/marketingAlerts.ts:25-45`, `src/data/grainAlerts.ts:19`, `src/data/grainAlerts.ts:29-34`

Failure scenario: A farmer is 40% marketed against a 60% goal. Opening Grain for seven days generates seven “below goal” emails, even though nothing changed.

Suggested fix: Persist a condition/observation transition receipt: fire when a price crosses a threshold, a marketed percentage crosses below goal, or at defined deadline windows only. Re-arm only after the condition clears or the quote changes.

### P2-3 — The Edge Function verifies rule existence, not whether marketing-rule conditions are currently true

For `marketing_*` alerts, the function checks active rule shape but does not re-read cash bids, calculate marketed percentage, or confirm the deadline window. `supabase/functions/deliver-grain-alert/index.ts:28`

Failure scenario: An owner can invoke a valid active price-target rule after the price has fallen below target; configured recipients receive a false “target reached” email.

Suggested fix: Recompute the exact condition server-side from authoritative data and validate the relevant quote freshness, scope, and date before sending.

### P2-4 — “Cash” firm offers with a future contract month become spot contracts

`offerToContract` maps every cash offer to `cash_spot`, even when its supplied contract month creates a future delivery window. `src/data/firmOffers.ts:53-57`

Failure scenario: A December cash offer becomes a spot contract in reporting, obscuring that it is a forward cash commitment.

Suggested fix: Map cash offers with a future delivery window to `forward_cash`, or ask the farmer explicitly whether the accepted cash offer is spot or forward.

## P3 — Polish / auditability

### P3-1 — Filled firm offers can be deleted, removing the offer-to-contract evidence

The offer list exposes Delete for every offer status, including filled offers. The contract remains, but its accepted-offer history is lost. `src/GrainModule.tsx:166-168`, `supabase/migrations/0028_firm_offers.sql:141-153`

Failure scenario: A farmer deletes a filled offer to tidy the list. The sale remains, but there is no longer a record of the buyer’s original offer, expiration, or delivery location.

Suggested fix: Disallow deletion once filled; use a hidden/archived presentation state while preserving the immutable offer-to-contract relationship.

## Numerical trace results

| Scenario | Result |
|---|---|
| Futures $4.80 + basis -$0.20 | Correct cash convention is **$4.60/bu**. `finalCashPrice` performs this correctly when both legs exist. `src/GrainModule.tsx:31-35` |
| Cash target $4.80 + basis -$0.20 | Current planned-revenue path produces **$4.60/bu**, although the target UI and alert language identify $4.80 as cash. This is P0-1. `src/GrainModule.tsx:202`, `src/GrainModule.tsx:238` |
| Monthly carry: $4.00 harvest, $4.45 later, 2 months, 4¢/bu/month, 6% interest, 12¢ trucking | Storage $0.08 + interest $0.04 + trucking $0.12 = **$0.24 carry**; net is **+$0.21/bu**. The implementation matches this arithmetic. `src/data/costOfCarry.ts:26-35`, `src/data/costOfCarry.regression.ts:9-14` |
| RP guarantee: 10 ac × 200 APH × 80% | **1,600 bu guaranteed**. With 1,500 already contracted, only **100 bu remain**, but the insurance-unit fallback displays 1,600 as safe-to-forward. `src/GrainModule.tsx:202`, `src/GrainModule.tsx:214-218` |
| Bin snapshot 25,000 plus historic +10,000 receipt | Current formula reports **35,000 bu**, even if the snapshot already included the receipt. `src/data/binLedger.ts:30-35` |

## Checked and found good

- **Cost-of-carry arithmetic has zero real issues under its stated assumptions.** Monthly storage converts cents to dollars, interest uses annual-rate × months/12, trucking is charged only after harvest, and the verdict compares every stored row to the harvest baseline. `src/data/costOfCarry.ts:24-51` The focused regression suite passed its hand-calculated cases. `src/data/costOfCarry.regression.ts:9-35`

- **Futures-plus-basis cash math is correct where both price legs are present.** `src/GrainModule.tsx:31-35`

- **Contract price-type and delivery-date validation is solid.** Cash/forward contracts require cash price, basis contracts require basis, HTA contracts require futures, and delivery end cannot precede delivery start. `src/data/grain.ts:123-136`, `supabase/migrations/0004_module2_grain.sql:90-97`

- **Marketing-plan replacement is properly atomic and scope-bound.** The RPC authenticates, validates the exact nullable scope, locks that scope, validates the complete bundle, upserts, deletes omitted rows, and returns canonical results in one transaction. `supabase/migrations/0012_grain_live_support.sql:41-46`, `supabase/migrations/0012_grain_live_support.sql:80-93`, `supabase/migrations/0012_grain_live_support.sql:213-329`

- **Private grain data has meaningful tenant safeguards.** Core records are farm-stamped, same-farm foreign keys are used for bins/contracts, and repository reads re-check farm, commodity, entity, and capacity relationships before exposing the workspace. `supabase/migrations/0004_module2_grain.sql:41-48`, `supabase/migrations/0004_module2_grain.sql:194-203`, `src/data/SupabaseGrainRepository.ts:48-60`

- **The MARS feed is excluded from latest position basis and manual marketing-rule price selection.** `src/data/basisMath.ts:3-10`, `src/data/marketingAlerts.ts:19-22` The generic target-alert exception is called out separately in P2-1.

- **Bin movement history is append-only at the database permission boundary.** Authenticated users receive only select/insert, with no update/delete grant. `supabase/migrations/0029_bin_upgrades.sql:47-57`

- **Moisture entry validation and warning thresholds work as coded.** The UI requires paired moisture/date fields, rejects future dates, flags moisture over 15%, and flags readings older than 30 days. `src/data/binLedger.ts:7-16`, `src/data/binLedger.ts:55-64`

- **Alert rule shapes are validated consistently in client and database.** Price, percentage-marketed, and deadline rules have mutually constrained fields. `src/data/marketingAlerts.ts:14-17`, `supabase/migrations/0027_marketing_alerts.sql:80-102`

- **The alert Edge Function has no obvious unauthenticated farm-data bypass.** It authenticates the caller, requires active owner membership, checks farm-scoped referenced rows for legacy target alerts, sanitizes inputs, and always includes the owner’s authenticated email. `supabase/functions/deliver-grain-alert/index.ts:14-30`