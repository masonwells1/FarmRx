# Grain marketing: what we have, what's missing, what to build (2026-10-21)

Mason's goal: grain sales tracking is the #1 feature and must be top-notch — logging HTA, purchase
contracts and the rest, building sales plans, and keeping **old crop and new crop separate**.

Method: code/schema inventory at `01dba58` → Claude gap brainstorm → Codex Sol (gpt-6.1-sol, high
effort, read-only) adversarial review → Claude re-verified the load-bearing claims by hand.
"(verified)" = re-read in source by Claude. Codex reproduced several in synthetic tests.

## What we already have

- Contract types: spot cash, forward cash, basis, HTA. One-shot "set basis" / "set futures".
  Correct/delete with reason + audit — but crop year, crop, type and prices can't be corrected, and
  nothing can be corrected after any delivery.
- Partial deliveries; scale-ticket loads (weights, moisture, truck, origin bin/field, destination
  buyer/contract/bin) with void-and-reverse.
- Bins with per-crop-year lots, moisture, committed vs free per crop and crop year.
- Every contract, plan, offer, alert and estimate carries a `crop_year`; Overview shows one card per
  crop year; Contracts/Plan/Offers/Alerts filter to one crop+year.
- Month-grid sales plan with templates, firm offers → contracts, price / %-marketed / deadline alerts,
  storage-cost calculator, breakeven from budgets, RP coverage estimate.

## Phase 1 — trust repairs (wrong numbers or access holes today)

1. **Premium counted twice (verified).** Finalizing a basis/HTA stores `cash_price = futures + basis +
   premium` (migration 0033:58); `finalCashPrice` (`grainPosition.ts:22`) adds premium again.
   $5.00 − $0.30 + 10¢ shows $4.90 instead of $4.80 — $1,000 too high on 10,000 bu.
2. **Workers can set prices and record deliveries on private contracts (verified).**
   `finalize_contract_price_leg` and `record_grain_contract_delivery` check only "can edit farm," not
   "can read private financials." GL-3 fixed this exact gap for edit/delete; these two were missed.
3. **"0 bu still unpriced" when nothing is priced (verified).** The hero line subtracts partly priced
   bushels too, so a crop that is 100% on basis contracts reads "0% priced · 0 bu still unpriced."
4. **New-crop HTAs valued with old-crop basis (verified).** `latestBasis` takes the newest hand bid for
   the crop regardless of crop year, delivery window, buyer or age, and falls back to $0.
5. **Plan-target price alerts ignore crop year** (Codex, reproduced): a 2026 spot bid can fire "2027 Corn
   reached your target." Also accepts future-dated bids. The newer alert-rule path is fine.
6. **Scheduled alerts can fire without ever emailing** (Codex): the server sweep records the event and
   sends push only; email is sent by the browser only on a fresh transition, with no retry.
7. **Totals may be silently cut off** (Codex; conditional on the server's row cap, default 1,000):
   deliveries and bin movements are read in one unpaged query and summed as complete; Harvest's
   "use load total" can certify a partial total.
8. **Today pairs a 2027 position with a 2026 spot bid; the plan grid confuses Jan 2026 with Jan 2027**
   (Codex) — both old/new crop leaks.
9. Smaller: zero-production alert disagreement browser vs server; offer expiry and bin dates use the
   device day instead of farm time zone; carry calculator allows negative harvest value and rounds away
   small differences; load retries can drop corrected ticket details.

**Phase 1 status (2026-10-21, first PR):** #1–#5 fixed, plus #8's Today pairing. The bid form now takes an
optional delivery month, so a new-crop bid can be entered. Still open in Phase 1: #6 alert email delivery, #7
paged totals, #8's plan-grid year aliasing (lands with Phase 5's plan window), #9, and the same crop-year
check inside the `deliver-grain-alert` edge function (needs an edge-function deploy). Separately, the
existing `TodayModule.sprayClock` regression already fails on `main` (unrelated to grain).

**Phase 1 status (2026-10-22):** #7 paged totals in PR #79. App-only parts of #9 in the next PR: a 0 bu
estimate no longer trips a %-marketed alert the server can't judge; firm-offer expiry, the offer fill day and
bin dates use the farm's time zone; Carry gives a negative harvest price no interest, treats float dust as a
tie, and shows up to four decimals. Still open, each needing a database change: #6 server-sent alert email
with retry, #9's load-retry check (the reused-ID comparison skips weights, moisture, ticket, truck, photo,
notes), and the plan-target crop-year check in `deliver-grain-alert`.

## Phase 2 — a real grain ledger, old crop and new crop clean

10. **Crop-year labels**: show "2025 crop · 2026 crop · 2027 crop" as the primary label, with a context
    tag ("in storage," "harvesting," "next harvest"). Never auto-relabel grain when a marketing year
    turns. A crop-year switch at the top of Grain scopes every tab.
11. **Carry-in / opening balances**: enter 2025 grain in bins, open contracts, delivered-unpriced grain
    and money owed without rebuilding 2025 field records (today you can't create a 2025 position
    without 2025 field assignments).
12. **Contract basics**: sale date, futures reference month (e.g. Dec '26 corn), buyer + location as a
    real list, pricing deadlines ("basis must be set by"), fees, a photo/PDF of the contract.
13. **Corrections after delivery**, audited (wrong crop year, wrong price).
14. **Clear position language**: committed / futures-open / basis-open / fully priced / delivered /
    paid — one consistent set, used on every screen.

## Phase 3 — the weekly loop: haul, deliver, get paid

15. Classify every load to a buyer: sale, applied to a contract, warehouse storage, or delayed price.
    (Don't assume every buyer load is a cash sale.)
16. Delivery schedule: what's due to whom by month; windows closing.
17. Settlements: wet vs dry vs paid bushels, shrink and discounts, checkoff, advances, payment received;
    flag mismatches.
18. Weekly to-do list: deadlines, open offers, payments due, missing tickets, settlement mismatches.

## Phase 4 — contract evolution

19. Pricing in pieces (set basis on 5,000 of 20,000 bu).
20. Rolls recorded as amendments (old/new month, spread, fee) — never overwrite history.
21. Delayed price (DP) and deferred payment (expected vs actual pay date, unpaid balance).
22. Landlord / crop-share ownership splits, if Mason's farms need it.
23. Elevator specialty contracts (minimum price etc.) recorded with their maximum bushel exposure — a
    record, not a pricing engine.

## Phase 5 — planning

24. Plan window that covers the real selling period (pre-harvest through the following summer), with
    each month tied to a specific year.
25. Actual vs plan by sale date; "price needed on the rest" to hit breakeven or a profit goal;
    shortfall scenarios. Price ladders only if farmers ask.
26. Lender position report (CSV/print first): owned grain, committed-undelivered, delivered-unpriced,
    receivables, assumptions shown.

**Cut / defer:** paid live futures feed, brokerage futures/options accounting, accumulator math,
buyer CRM, fancy insight strips, automatic old→new rollover.

## Owner decisions (defaults Claude will use unless Mason says otherwise)

- A. **DECIDED (Mason, 2026-10-21):** a purchase contract locks in both basis and price, and you must
  deliver to the elevator. That is the app's "Forward cash" type (`forward_cash`). Phase 2 #12 action:
  rename it on screen to "Purchase contract," and let its form record futures and basis separately
  (they add up to the cash price) plus the futures month, because that's how the paper contract reads.
  Seed and fertilizer prepay stay out of Grain.
- B. **DECIDED (Mason, 2026-10-21):** label crops by harvest year. **Old crop = grain already
  harvested: in bins, or delivered on deferred pay / delayed price, etc.** New crop = not yet harvested.
  Never auto-relabel.
- C. **DECIDED (Mason, 2026-10-21):** no live futures feed *for now* — a live feed will be added later.
  Until then farmers type a dated futures reference price and values built on it are labeled estimates.
  Build the valuation code so a feed can plug in later without rework.
- D. **DECIDED (Mason, 2026-10-21):** must support elevator minimum-price contracts, deferred pay, and
  basis contracts (basis already exists). Brokerage futures/options accounts stay out.

## Notes on the review

Codex corrected Claude's first draft in places: the buyer-load claim was half right (bins do go down;
the sale doesn't count); the "two % sold numbers" are labeled differently, but the words are
inconsistent; "insurance-safe to forward" wording is risky because RP pays dollars, not bushels; a
24-month fixed grid can't hold older carry-over; and phases should ship as several small database
changes, not one large one. Codex found no crop-year leak between contracts and loads (both sides reject
mismatches) and no cents/month error in the storage calculator.
