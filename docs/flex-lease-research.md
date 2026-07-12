# Flexible Cash-Rent Leases — University of Illinois Research

**Date:** 2026-07-11 · **Purpose:** ground Farm Rx's flex-lease feature in the actual lease
structures the University of Illinois publishes (farmdoc, farmdoc daily, Illinois Extension),
so the app's math matches what real Illinois/Indiana landlords and tenants sign.

**Sources used (all primary U of I):**

| # | Source | URL |
|---|--------|-----|
| S1 | Illinois Cash Farm Lease form CL 01-0912 ("ALL-IN-ONE" cash lease, incl. Section 2 Alternate flexible rent) | https://farmdoc.illinois.edu/assets/legal/form/Farmdoc_Form_CL01_0912.pdf (landing page: https://farmdoc.illinois.edu/publications/illinois-cash-farm-lease-form-pdf) |
| S2 | Variable Cash Rent Leases fact sheet (Dale Lattz, U of I Farm Business Management, 2017) | https://farmdoc.illinois.edu/assets/management/leasing-facts-prices/Variable_Cash_Rent_Lease_Fact_Sheet_2017.pdf |
| S3 | farmdoc daily: "Cash Rent with Bonus Leasing Arrangement: Description and Example" (Schnitkey, 2011) | https://farmdocdaily.illinois.edu/2011/09/cash-rent-with-bonus-leasing-a-1.html |
| S4 | farmdoc daily: "A Straight-Forward Structure for a Variable Cash Rent" (2021) | https://farmdocdaily.illinois.edu/2021/08/a-straight-forward-structure-for-a-variable-cash-rent.html |
| S5 | farmdoc daily: "Revised Variable Cash Lease Parameters" (Sept 2025 — current recommended parameters) | https://farmdocdaily.illinois.edu/2025/09/revised-variable-cash-lease-parameters.html |
| S6 | Illinois Extension, Acres of Knowledge: "What about a flexible cash rent lease" (2021) | https://extension.illinois.edu/blogs/acres-knowledge/2021-08-06-what-about-flexible-cash-rent-lease |

Related (found, not load-bearing): "Parameters for a 2016 Cash Rent with Bonus"
(https://farmdocdaily.illinois.edu/2015/09/parameters-for-a-2016-cash-rent-with-bonus.html),
2018 Extension blog (https://extension.illinois.edu/blogs/acres-knowledge/2018-08-17-what-about-flexible-cash-rent-lease).

---

## 1. Plain English: the flex lease types U of I actually publishes

U of I describes **four distinct structures**. Every one of them settles to a single number:
**dollars of rent per acre for the year**. All of them use the **farm's actual yield** and a
**local cash price averaged over an agreed window** (details in section 2).

### Type A — Percent of gross revenue, with a minimum (and usually a maximum)

*The farmdoc "flagship" — S2 Example 1, S4, S5. farmdoc daily calls this "a simple to
understand variable cash rent."*

**Formula in words:** Rent = an agreed percentage × (actual yield × average price).
If that lands below the agreed minimum, pay the minimum; above the maximum, pay the maximum.

**Worked example (central Illinois corn, farmdoc's own numbers, S5):**
244 bu/acre actual yield × $4.30 average price = $1,049 gross revenue.
30% rent factor × $1,049 = **$313/acre rent** (inside the min/max band, so it stands).

farmdoc's 2025 recommended rent factors: corn 21–30% and beans 27–38% depending on region
(Central-High Illinois: 30% corn / 38% beans). Recommended bounds: minimum = average local
cash rent − $100, maximum = average cash rent + $100 (S5). The 2021 version (S4) used higher
factors (32% corn / 43% beans north-central) with a minimum only.

### Type B — Base rent flexed by PRICE only (lease form "Option I")

*Straight off the ALL-IN-ONE lease form, Section 2 (Alternate), Option I — S1.*

**Formula in words:** Rent = base rent × (this year's average price ÷ the base price written
in the lease). Then clamp to the min/max written in the lease.

**Worked example:** Base rent $275, base price $4.50. Season average comes in at $5.00.
Rent = $275 × ($5.00 ÷ $4.50) = **$305.56/acre** (clamped if outside min/max).
Yield doesn't matter in this one — only price moves the rent.

### Type C — Base rent flexed by PRICE AND YIELD (lease form "Option II")

*Lease form Section 2 (Alternate), Option II (S1); same structure as S2 Example 2.*

**Formula in words:** Rent = base rent × (current price ÷ base price) × (current farm yield ÷
base yield). Clamp to min/max.

**Worked example (S2's numbers):** Base rent $225, base yield 185 bu, base price $3.50.
Actual: 220 bu at $3.25 average. Rent = $225 × (220 ÷ 185) × ($3.25 ÷ $3.50) =
**$248.46/acre**. (Good yield more than offset the weaker price.)

Note: the form has **no yield-only option** — Option I is price-only, Option II is
price-and-yield, Option III is a blank "other procedure" line. A yield-only flex would just be
Option II with the price ratio pinned to 1, or written under Option III.

### Type D — Base rent PLUS BONUS above a revenue trigger ("cash rent with bonus")

*farmdoc daily's long-running structure — S3; also S2 Example 3. This is the "hybrid base
rent + bonus" the Extension blog mentions (S6).*

**Formula in words:** Landlord always gets the base rent. If gross revenue (actual yield ×
average price) exceeds an agreed trigger, the landlord also gets an agreed percentage of the
excess. Total rent is capped at an agreed maximum.

**Worked example (S3's numbers):** Base rent $200, corn trigger $720/acre revenue, landlord
share 40%, max rent $550. Actual: 190 bu × $6.00 = $1,140 revenue.
Excess = $1,140 − $720 = $420. Bonus = 40% × $420 = $168. Rent = $200 + $168 =
**$368/acre corn** (under the $550 cap, so it stands).

How the trigger is set: either negotiated directly per crop (S3), or built from costs —
trigger = base rent + tenant's non-land costs, so the bonus is a split of profit above
break-even (S2 Example 3 uses trigger $725 = $200 base + $525 corn non-land costs, 50% share).

### Honorable mention — the Extension blog's "factor over base" hybrid (S6)

Rent = base rent, plus more if (yield × price × rent factor) exceeds the base — i.e.
**Rent = max(base rent, factor × gross revenue)**. Example: base $200; 220 bu × $5.00 × 33% =
$363 → rent $363 ($163 above base). This is mathematically just **Type A with the minimum set
equal to the base rent**, so it needs no separate machinery.

---

## 2. The math contract (per type)

Common input definitions across all U of I materials:

- **Yield** = the **actual farm yield** for the lease year (settlement sheets / scale tickets
  at harvest; agreed method for stored grain). County yields and insurance yields are *not*
  what the U of I forms reference. (S1 footnote: "The current yield shall be the 'farm' yield
  for the current lease year.")
- **Price** = an **average of local cash quotes at an agreed delivery point over an agreed
  window**, written into the lease. Examples U of I gives: close-of-day price over agreed
  period(s)/location(s) (S1); first-trading-day-of-month, March–November, Elevator A (S2);
  weekly Wednesday quotes March 1–Oct 31, using fall-delivery bids Mar–Aug and spot cash
  Sep–Oct (S3, S4). *Not* harvest futures averages and *not* crop-insurance prices — U of I
  deliberately uses local cash so basis is included. The window/location is free text in the
  lease; the app only needs the resulting average $/bu.
- All structures are **per crop** (corn and beans get separate parameters), and a field's rent
  is the acre-weighted result. Government payments are usually *excluded* so the lease stays a
  "cash lease" for FSA purposes (S2 explains the 7 CFR / FSA share-lease caution printed on
  the form, S1).

| Type | Inputs (parameters fixed in the lease) | Inputs (season results) | Output $/acre |
|------|----------------------------------------|--------------------------|----------------|
| **A. % of gross** | rate_pct (e.g. 30% corn / 38% beans); min_rent; max_rent (optional in older versions) | actual yield, avg cash price | clamp(rate_pct × yield × price, min, max) |
| **B. Price-only flex** | base_rent; base_price; min_rent; max_rent | avg cash price | clamp(base_rent × price ÷ base_price, min, max) |
| **C. Price+yield flex** | base_rent; base_price; base_yield; min_rent; max_rent | actual yield, avg cash price | clamp(base_rent × (price ÷ base_price) × (yield ÷ base_yield), min, max) |
| **D. Base + bonus** | base_rent (= the floor); trigger_revenue ($/acre); rate_pct (landlord share of excess); max_rent (optional) | actual yield, avg cash price | min(base_rent + rate_pct × max(0, yield × price − trigger_revenue), max) |

Sanity properties (useful as tests): every type is monotonically non-decreasing in price;
A, C, D are non-decreasing in yield; B ignores yield; rent never leaves [min, max]; with
rate/ratios at their base values, B and C return exactly base_rent; D returns base_rent
whenever revenue ≤ trigger.

---

## 3. Fit vs Farm Rx today

**What the app has now (verified in code, not from memory):**

- UI / Fields-owned shape — `src/data/fields.ts`: `flex_bonus_formula: {type: 'price'|'yield'|'revenue', trigger, bonus_rate}` alongside `cash_rent_per_acre` on the arrangement.
- Client math — `src/data/profitabilityCalculations.ts` (`equivalentCashRentForScenario`):
  - `revenue`: rent = cash_rent + max(0, yield×price − trigger) × bonus_rate/100 → **this is exactly U of I Type D** (minus the max-rent cap).
  - `price`: rent = cash_rent + max(0, price − trigger) × bonus_rate — a "$X per acre per $1 of price above trigger" bonus. **Not a structure U of I publishes** (U of I's price flex is the multiplicative ratio, Type B).
  - `yield`: same pattern per bushel above trigger. **Also not a published U of I structure.**
- Applied DB view — `supabase/migrations/0006_module4_profitability.sql` (`arrangement_comparisons`): expects `{basis: 'price'|'yield'|'revenue', trigger, rate_pct, cap_per_acre?}` and fails closed on the UI shape (documented in `docs/GOAL.md` item 2 and `docs/profitability-live-design.md`).

**Recommended single JSON schema** for `flex_bonus_formula` that represents ALL four U of I
types plus today's saved data:

```json
{
  "method": "base_plus_bonus | pct_of_revenue | base_flex_price | base_flex_price_yield",

  "base_rent_per_acre": 250,        // required for base_plus_bonus / base_flex_*; null for pct_of_revenue
  "rate_pct": 40,                   // base_plus_bonus: landlord % of revenue above trigger
                                    // pct_of_revenue: % of gross revenue. 0-100. null for base_flex_*
  "trigger_revenue_per_acre": 720,  // base_plus_bonus only, else null
  "base_price_per_bu": 4.50,        // base_flex_price / base_flex_price_yield only
  "base_yield_per_acre": 200,       // base_flex_price_yield only

  "min_rent_per_acre": 200,         // optional floor (U of I uses one on nearly every variant;
                                    //   for base_plus_bonus the base IS the floor — leave null)
  "max_rent_per_acre": 400,         // optional cap (S1 form and S3/S5 all carry a max)

  "price_source_note": "avg Wed close, Elevator A, Mar 1 - Oct 31"  // free text, display-only
}
```

Settlement inputs (actual yield, average price) already exist per crop on
`crop_assignments.expected_yield_per_acre` / `expected_price_per_bu`, so the calculator
signature doesn't change.

**Translation of existing saved shapes:**

| Existing field | New field |
|---|---|
| UI `type: 'revenue'` + `trigger` + `bonus_rate` + arrangement `cash_rent_per_acre` | `method: 'base_plus_bonus'`, `trigger_revenue_per_acre = trigger`, `rate_pct = bonus_rate`, `base_rent_per_acre = cash_rent_per_acre` — lossless, exact Type D |
| UI `type: 'price'` / `'yield'` | No honest U of I equivalent (per-unit additive bonus vs U of I's ratio flex). Migrate only if Mason confirms a real lease is written that way; otherwise drop at migration with a note. |
| View `basis: 'revenue'`, `trigger`, `rate_pct` | Same as UI revenue row: `method: 'base_plus_bonus'` |
| View `cap_per_acre` (cap on the bonus) | `max_rent_per_acre = base_rent_per_acre + cap_per_acre` |

Whichever side is aligned (fix the 0006 view's flex branch vs migrate the stored shape), this
schema is a superset of both, so the "views fail closed" reconciliation in GOAL.md item 2 can
land on it once instead of twice.

---

## 4. Recommendation (smallest honest v1)

**Support two methods in v1:**

1. **`base_plus_bonus`** (U of I Type D, "cash rent with bonus") — it is farmdoc daily's most
   promoted flex structure, and it's what the app's existing `revenue` type already computes.
   Add the optional `max_rent_per_acre` cap to be faithful to S3. Zero migration pain.
2. **`pct_of_revenue`** with `min_rent_per_acre`/`max_rent_per_acre` (U of I Type A) — the
   current farmdoc-recommended structure (S4/S5) and the one professional farm managers use
   most; also subsumes the Extension blog hybrid (min = base). It's one multiplication plus a
   clamp — cheap to add.

**Park for later:** `base_flex_price` and `base_flex_price_yield` (form Options I/II). They're
real and on the official form, but they're the older style; the schema above already reserves
their fields, so adding them later is UI work only, no data migration.

**Drop / decide:** the current UI `price` and `yield` per-unit bonus types. They don't match
any published U of I structure. **Ask Mason whether any real CropRx-area lease is written that
way** (this is the same "ASK MASON" already parked in GOAL.md item 2); if not, remove them
from the UI enum during the schema migration.

One more honesty note for the UI: rent parameters are **per crop** in every U of I source. If
v1 keeps one formula per arrangement (per field), label it as such — a corn/bean rotation
under one lease typically has two parameter rows (e.g. 30%/38% factors), and the annual rent
is the acre-weighted blend.
