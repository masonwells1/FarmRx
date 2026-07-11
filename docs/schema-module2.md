# Farm Rx Module 2 Schema — Owner Review Draft

These files are a database blueprint only. They have not been applied to a database.

## What each table does

- **Production estimates:** One yearly production line per commodity, optional operating entity, and optional named crop enterprise; it keeps projected and actual bushels side by side and records which number currently drives the Grain math.
- **Grain contracts:** The private sales ledger for cash/spot, forward-cash, basis, and HTA contracts, including buyer, bushels, pricing pieces, delivery dates, contract number, and identity-preserved premium.
- **Marketing plan targets:** One planned percentage in one calendar-month cell, with optional absolute price, percentage above or below breakeven, and deadline targets for the monthly plan grid.
- **Insurance units:** The APH, insured acres, coverage percentage, and revenue guarantee for each crop-insurance unit, from which the database calculates the insurance floor per bushel and safe-to-forward bushels.
- **Grain bins:** The list of on-farm and commercial storage locations and each location's capacity.
- **Bin inventory:** The commodity-specific balance and committed bushels inside a bin, keeping white corn, Non-GMO corn, and yellow corn as separate grain.
- **Cash bids:** Dated manual elevator basis and cash-price entries; keeping every row automatically creates the history needed for basis charts.
- **USDA report dates:** A shared calendar of reports such as WASDE, Grain Stocks, Prospective Plantings, and Crop Progress; it contains no farm-private information.
- **Insurance unit guarantees view:** A read-only calculation that shows guarantee dollars per bushel and the insured bushels considered safe to forward for each insurance unit.

## How privacy works

Grain positions are the most private records in Farm Rx. Every production estimate, contract, target, insurance unit, bin, bin balance, and cash bid is stamped with a farm workspace, and that stamp cannot be changed after the row is created.

The database checks the farm on every read and every change. An active farm member follows the same access rules established by Module 1. A Crop RX representative can read a farm's grain records only when the farm's **Share with my Crop RX rep** toggle is ON **and** that exact representative has a separate active permission slip. Representatives cannot add, edit, or delete grain data.

Links between private records carry the farm stamp on both sides. For example, a bin-inventory row cannot point to a bin from another farm, and an operating entity from Farm A cannot be attached to Farm B's grain position. This is enforced by database foreign keys as well as privacy policies.

USDA report dates are the exception because they are public calendar facts shared by every farmer. Signed-in users may read them but cannot change them. The insurance calculation view uses the signed-in person's permissions, so it does not create a back door around privacy.

## Decisions I made and why

- I stored projected and actual bushels in separate columns and made the live math choice a two-value switch. Harvest data never destroys the preseason estimate, so season review remains possible.
- I kept `expected_bushels` as an editable stored value instead of only calculating acres times APH. That supports incomplete field setup, farmer overrides, and future machine-data imports without making the Grain page wait on every field.
- I separated an optional operating entity from an optional crop-enterprise label. Wells Farm Group is an ownership/report filter; “Corn on Corn” is a possible named planning enterprise. Both are allowed, but neither is required for the v1 commodity-only screen.
- I limited contract types to cash/spot, forward cash, basis, and HTA. Options, firm offers, true board hedges, NPE, and “other” are deliberately outside this draft.
- I modeled marketing targets by the first day of a calendar month so the Jan-Dec grid is the primary plan, not a display reconstructed from loose deadlines. Each cell can still carry an absolute price, a breakeven-relative percentage, and a date deadline.
- I added insured acres because “Safe to Forward” needs real bushel math: insured acres × APH × coverage percentage. The separate guarantee-per-bushel figure is revenue guarantee per acre ÷ APH.
- I kept commodity identity on every bin balance. White and Non-GMO corn cannot be merged with yellow corn through a free-text label.
- I made manual cash bids append as dated rows instead of updating one current bid. That makes the basis-history chart build itself from ordinary use.
- I kept USDA dates global but did not put reminder preferences there. A future farmer reminder must be a separate farm-private record.
- I used a read-only, permission-respecting view for insurance calculations. The database does the repeatable math while the existing row-level privacy rules remain in force.
