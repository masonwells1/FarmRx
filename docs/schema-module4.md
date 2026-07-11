# Farm Rx Module 4 Schema — Owner Review Draft

These files are a database blueprint only. They have not been applied to a database.

## What each table does

- **Crop budgets:** One named profitability scenario for a crop year and commodity, with optional operating-entity and named-enterprise filters. It stores the expected yield and expected price that drive breakeven math. “Base,” “High fertilizer,” and “Reduced pass” are separate budgets that can sit side by side.
- **Budget cost lines:** The per-acre costs inside a budget: seed, chemical, fertilizer, fuel, repairs, labor, land, crop insurance, equipment/depreciation, interest, and custom lines. Every line also produces the competitor-inspired **BU TO COVER** number.
- **Profitability matrix steps:** The ordered price and yield values shown on the two axes of the heat map. The database crosses the price steps with the yield steps and calculates each profit/loss cell live, so stale answers are not stored.
- **Budget field allocations:** Connects a budget to a real crop assignment and records how many planted acres use it. A field may override the budget's expected yield or price without changing the shared crop scenario.
- **Budget analysis views:** Read-only calculations for total cost per acre, expected revenue and profit, breakeven price, breakeven yield, and bushels needed to cover each cost.
- **Arrangement comparison view:** Puts every saved arrangement for an allocated field into the same dollars-per-acre language. It shows equivalent cash rent, operator cost, and operator net for owned, cash-rent, flex-rent, and crop-share terms.
- **Field profitability view:** Uses the latest arrangement effective in the crop year to show cost per acre, net per acre, total allocated cost, and total allocated net for each field. If arrangement setup is incomplete, it keeps the field visible using the budget's planned land line.

## How privacy works

Budgets and costs are as private as grain. Every budget, cost line, matrix step, and field allocation is stamped with a farm workspace, and that stamp cannot be changed after creation.

The database checks the farm on every read and every change. An active farm member follows the same current rule as Module 2. A Crop RX representative can read profitability only when the farm's **Share with my Crop RX rep** toggle is ON **and** that exact representative has a separate active permission slip. Representatives cannot add, edit, or delete budgets or costs.

Every child link repeats the farm stamp on both sides. A cost line cannot point to another farm's budget, an allocation cannot point to another farm's crop assignment, and an entity-scoped budget cannot be allocated to a field owned by a different entity. The database checks crop year, commodity, entity, and planted acres when an allocation is saved.

All six calculation views use the signed-in person's permissions. They do not bypass row-level security or expose another farm's financial numbers.

There is one known privacy hook shared with Grain: today, every active farm member can read financial data. Before the first employee login, the planned FOUNDATION BLOCK must change both Grain and Profitability reads to owner/manager by default, with a deliberate per-member permission for anyone else. This draft marks that location; it does not invent a second, inconsistent employee rule.

## Decisions I made and why

- I made budgets first-class rows instead of attaching costs directly to a crop. That makes two or three side-by-side scenarios natural and lets next year's budget be copied without flattening its history. `copied_from_budget_id` records where a copy began; the application will copy its cost lines and matrix steps in one transaction.
- I kept optional operating entity and named enterprise as separate scopes, matching Module 2. The v1 screen can stay commodity-first, while “Corn on Corn” or a specific operating company remains possible later.
- I stored yield and price as budget inputs but calculate breakeven outputs in read-only views. Breakeven price is cost ÷ yield; breakeven yield is cost ÷ price. Neither answer can go stale after a cost changes.
- I stored only the matrix axes, not every cell. Price steps × yield steps are crossed live against current costs, which keeps the heat map and its breakeven contour accurate after any edit.
- I did **not** add a second arrangement or equivalent-rent table. `fields.arrangements` already owns lease terms. The comparison view joins those terms to the selected budget and normalizes each one to equivalent cash rent.
- For crop share, equivalent cash rent is the landlord's crop revenue share minus the input costs the landlord pays. For cash rent it is the fixed rent. For owned ground it is zero. For flex rent it is base rent plus the configured bonus.
- I defined the flex-bonus JSON contract in the view: `basis` is `price`, `yield`, or `revenue`; `trigger` is where the bonus begins; `rate_pct` is the landlord's percentage of revenue above that trigger; and optional `cap_per_acre` limits the bonus. Invalid formulas are flagged and return no financial answer instead of silently guessing.
- I exclude the generic budget land line during arrangement comparison and replace it with the selected arrangement's equivalent cash rent. Counting both would charge land twice. The ordinary budget total still includes its planned land line.
- I use crop assignments, not a duplicated field ID, for field allocations. That preserves wheat followed by double-crop soybeans and proves the allocated budget matches the real crop year and commodity.
- I included future Inventory and Equipment source hooks on cost lines without foreign keys to tables that do not exist yet. Module 3 can connect chemical and seed costs later without making this draft depend on an imaginary table.
- I did not reference any grain table from draft migration 0004. Module 4 can therefore be reviewed independently; Grain can later join a budget's farm, crop year, commodity, entity, and enterprise scope to read the breakeven overlay.

## Owner questions still open

- Should the v1 screen expose named enterprises such as “Corn on Corn,” or keep them hidden until after the commodity-only version ships? The schema safely supports either choice.
- Do real Crop RX flex leases fit the proposed trigger + percentage-above-trigger + optional per-acre cap formula, or does one use a different calculation that should be supported before this draft is applied?
- When the employee privacy foundation work is built, which non-manager employees, if any, should receive an explicit **View financials** permission?
