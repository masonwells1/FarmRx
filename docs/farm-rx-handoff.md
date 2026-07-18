# FARM RX — BUILD HANDOFF
### A customer-facing farm management platform, by Crop RX Solutions

**Hand this document to a fresh build session. It is self-contained.**

- **Product name:** Farm Rx
- **Parent brand:** Crop RX Solutions (Robinson, IL)
- **Audience:** Corn / soybean / wheat growers in southeastern Illinois & western Indiana
- **Owner:** Mason Wells
- **Status:** Production PWA deployed at **https://farm-rx.vercel.app**. Fields, Grain, and the broader farm workflow exist; current release work is customer-zero trust, onboarding recovery, device proof, and field feedback.
- **Provisioning guard:** the owner-provisioning CLI takes no customer-email command argument.
  Use the documented create flow or resend mode and enter the email only at its prompt; never put a
  customer email in terminal history or a copied command.

---

## PART 0 — THE THREE RULES

Every decision in this build defers to these.

**RULE 1 — Simplicity beats features.**
The user is a 55-year-old farmer, in a truck, in July sun, possibly with gloves on, possibly without his reading glasses. He is *not* tech-savvy and he will abandon this app the first time it confuses him.
- Base font **18px**, not 14px. Tap targets **48px minimum**.
- All numbers in tabular figures (`font-variant-numeric: tabular-nums`) so bushels and dollars align in columns.
- **Two-tap rule:** any common action reachable in two taps.
- Plain English everywhere. If a screen needs a manual, it's wrong.

**RULE 2 — The data is theirs, and they must be able to SEE that it's theirs.**
Farm Rx is Crop RX-branded, but a farmer's grain position is the most private number on his farm. If the software is named after his chemical supplier, he will quietly wonder whether his supplier can see what he made. Kill that doubt explicitly:
- Grain and financial modules default to **PRIVATE**.
- An explicit per-farm toggle: **"Share my grain position with my Crop RX rep — OFF."**
- Enforced in the database with Postgres Row Level Security, not just in the UI.
- Build this on day one. It is a signup driver, not a setting.

**RULE 3 — Brand the wrapper, never the buttons.**
The RX personality lives in the name, the login screen, the ℞ icon, and the green. It does **not** live in the navigation. Nav items are: *Fields. Grain. Inventory. Profitability. Equipment. Tasks.* **Never** call the dashboard "Vitals" or records "The Chart." The medical metaphor will feel clever for ten minutes and will cost real users forever.

---

## PART 1 — STACK & PLATFORM

- **Frontend:** React + TypeScript
- **Backend / DB / Auth:** Supabase (Postgres + Row Level Security + Auth)
- **Hosting:** Vercel
- **Charts:** Recharts
- **Delivery:** **PWA — not the app stores.**

### Why PWA (decided)
No App Store review, no Apple developer account, no 30% cut, **instant updates** (critical when fixing a bug during planting), one codebase, installable to the home screen with the ℞ icon, works offline in bad cell coverage. iOS supports Web Push for installed PWAs, so alerts work. Wrap in Capacitor later *only if* app-store presence becomes necessary. **Mobile-first is not a nice-to-have — most sessions will be on a phone.**

### Offline tolerance is a hard requirement
Rural connectivity is bad. Never lose a half-entered sale, spray record, or scouting note because a bar dropped. Queue writes locally and sync.

### RLS is the technical backbone of Rule 2
Every table is farm-scoped. A Crop RX rep sees a farm's private data **only** if that farm flipped the share toggle. Mason's prior CRX Manager audits surfaced RLS holes — treat this as a known risk area and get the policies independently reviewed before any customer touches it.

---

## PART 2 — CROP TYPES (get this right in the schema first)

Supported crops:
- **Yellow Corn**
- **White Corn**
- **Conventional Corn (Non-GMO)**
- **Soybeans**
- **Double-Crop Soybeans**
- **Wheat**

**Critical, non-obvious:** White corn and Non-GMO corn are **not "yellow corn with a tag."** They carry:
- their own **premiums** ($/bu over the board),
- their own **buyers** (fewer of them),
- **identity-preserved delivery requirements** (segregated bins, segregated trucks).

Model them as **distinct marketable commodities** with their own contracts, premiums, and cash bids. A contract for white corn is not interchangeable with a contract for yellow corn. Getting this wrong is a painful retrofit.

**Double-crop soybeans** mean a single field carries **two crops in one year** (wheat, then DC beans). Do not model crop as a column on the field. Model **crop assignments as their own rows** keyed to `field_id + year + crop`. This breaks naive schemas and is expensive to fix later.

---

## PART 3 — THE MODULES

Build in this order. **Do not build them all at once — that is how farm software projects die.**

---

### MODULE 1 — FIELDS *(foundation — build first)*

Everything else reads from here.

**Port the engine from CRX Manager.** The field / acre / billing-split logic already exists in Mason's CRX Manager app. Analyze that repo and reuse the schema and logic rather than rebuilding from scratch. *(A preliminary task for this build is to point Claude Code at the CRX Manager repo and extract/document the reusable Fields and Inventory engines.)*

**Objects:**
- **Field** — name, location/legal description, total acres, FSA farm/tract number (optional), soil productivity index (optional).
- **Crop assignment** — `field_id + year + crop + planted_acres`. Multiple rows per field per year (see double-crop above).
- **Arrangement** (per field) — how the ground is held:
  - Owned
  - Cash rent (fixed $/acre)
  - Flex cash rent (base + configurable bonus formula on price / yield / revenue)
  - Crop share — **2/3–1/3, 60/40, 50/50, custom** (store landlord % of crop AND landlord % of each specified input)
- **Entity** — fields roll up to an operating entity. Mason runs several (Wells Farm Group, Next Generation Farms, etc.). Support multiple entities per user and **filter every report by entity.**

**Screens:** field list (sortable by crop/entity/arrangement, with total-acre stat boxes at top) · field detail (crop history, arrangement, acres, yield history) · fast add/edit.

**Feeds:** planted acres → expected bushels (Module 2). Arrangement + acres → share economics (Module 4).

---

### MODULE 2 — GRAIN: HEDGING & SALES *(the flagship — give it the most polish)*

**This is the module that makes farmers log in daily. It is the reason the product exists. A dedicated, well-built page.**

#### 2.1 Expected production (auto-calculated)
- Pull planted acres by crop from Fields.
- × **APH / expected yield** per crop (user-set, editable per field, sensible defaults).
- → **expected bushels** per crop, per entity, per whole farm.
- Handle double-crop soybeans as their own production line.
- Handle white / non-GMO corn as **separate commodities** with their own expected production.

#### 2.2 The projected → actual switch *(explicit requirement)*
Every production figure has two states, toggled per crop:
- **Projected** (pre-harvest) = acres × expected yield
- **Actual** (post-harvest) = real harvested bushels

The marketing plan, % sold, and breakevens **recalculate against whichever is live.** Pre-harvest the farmer markets against projected; at harvest he flips to actual and everything downstream updates.

**Store both. Never overwrite projected with actual** — both are needed for season review. Design as `expected_bushels` + `actual_bushels` + a per-crop flag choosing which drives the math.

Actual bushels arrive from: yield-monitor import (Module 7) or manual entry.

#### 2.3 Market data *(see PART 4 for the vendor decision)*
- **Futures:** delayed CBOT quotes — corn (ZC), soybeans (ZS), Chicago wheat (ZW). Front months plus new-crop contracts (Dec corn, Nov beans, Jul wheat).
- **Local cash bids:** nearest elevators by farm ZIP — elevator name, cash price, basis, delivery window.
- **Delayed is fine and decided.** Label the delay in the UI.
- Cache server-side. Never call the API per page load.

#### 2.4 Position view — the heart of the page
Per crop, at a glance:
- Total production (projected or actual)
- Bushels **priced vs. unpriced** (both bushels and %)
- **Average sold price**
- **Blended expected revenue** = (sold bu × sold price) + (unsold bu × live board/cash)
- **Overlaid against BOTH:**
  - **Breakeven** (from Module 4)
  - **Crop insurance guarantee** (see 2.7)

The single sentence a farmer should be able to read in two seconds:
> *"I'm 62% priced at $4.71. Breakeven is $4.28. Insurance floor is $4.31. 47,500 bu still open with Dec at $4.68."*

#### 2.5 Contracts
Log a sale in ~15 seconds. **Contract types (final list — no options):**
- **Cash / spot**
- **Forward cash**
- **Basis**
- **HTA (Hedged-to-Arrive)**

Fields: buyer/elevator (prefill from the cash-bid list), commodity, bushels, price (or futures + basis), delivery window, contract #, premium (for white/non-GMO). Editable, running list, clear total.

*Options contracts are explicitly OUT of scope.*

#### 2.6 Marketing plan targets + alerts
- Farmer sets a plan: *"sell 10% at $4.80, another 10% at $5.00, 20% by Sept 1."*
- Track progress against the plan.
- **Alert when a price or date target is hit** — in-app + email.
- This is what grain marketing advisors charge thousands a year for. It's the stickiest feature in the app.

#### 2.7 Crop insurance guarantee
Store per unit: **APH, coverage level, revenue guarantee $/acre → guarantee $/bu.**
Overlay it on the position view. Without it a farmer marketing against breakeven alone is seeing half the picture. This is what separates a real marketing tool from a spreadsheet.

#### 2.8 Grain bin / storage inventory
- Bushels in each bin. On-farm vs. commercial storage.
- **Committed vs. free** bushels.
- Segregation matters for white / non-GMO (identity-preserved).
- The hedging page is fiction without knowing what's actually sitting unpriced in a bin.

#### 2.9 Basis history charts
Historical basis by elevator and commodity. Answers the question that actually drives the decision: *"is basis historically strong or weak right now?"* Store every cash bid you pull; the history builds itself.

#### 2.10 USDA report calendar
WASDE, Grain Stocks, Prospective Plantings, Crop Progress. Farmers plan marketing around these dates. Simple calendar + optional reminder. USDA publishes the schedule publicly.

#### 2.11 Compliance
Farm Rx shows **numbers and the farmer's own targets.** It never says "sell now." Both Bushel and Harvest Profit are explicit that they do not offer marketing advice. Add a plain-language disclaimer on the Grain and Profitability pages. **Mason is not a licensed advisor and the product must not imply otherwise.**

---

### MODULE 3 — INVENTORY, SPRAY RECORDS & EPA COMPLIANCE

**Port and simplify from CRX Manager.** Farmers abandon complex inventory tools — keep this lean.

#### 3.1 Products
- Chemical, seed, fertilizer, other inputs.
- **Two sources:** (a) delivered by Crop RX, (b) **added by the farmer himself** (bought elsewhere). Both tracked.
- Tracking the farmer's *whole shed* — not just CRX purchases — is exactly what makes this a real compliance tool rather than a sales gimmick. Mirror CRX Manager's approach.

#### 3.2 Future CRX Manager sync *(design for it, don't build it yet)*
Eventually: a delivery entered in CRX Manager **auto-appears** in that customer's Farm Rx inventory. Design the schema now so this drops in cleanly — shared product IDs, a delivery-event table. **Do not build the sync in v1. Do not block it either.**

#### 3.3 Spray records / EPA compliance
Log applications: product(s), rate, **EPA reg #**, date, field, applicator, target pest, weather at application, REI/PHI. Pull product + EPA reg data from the inventory item so the farmer never retypes a reg number. Reuse the compliance-record structure from CRX Manager.

#### 3.4 Chemical-needed planner
- Given fields + planned programs → **how much product is needed to cover the farm.**
- As applications are logged, **draw down** needed/on-hand.
- Simple visual: **planned vs. applied vs. remaining**, per product, per acre remaining.
- Prevents the mid-season "we're short" phone call.

#### 3.5 Nutrient removal calculator
Bushels harvested → **lbs of N / P / K removed** per field. Standard removal coefficients per crop. Feeds next year's fertility plan — and it's a direct, natural hook back into Crop RX's agronomy business.

#### 3.6 Costs → Profitability
Inventory product costs feed Module 4's input-cost entry so chemical and seed costs are never entered twice.

---

### MODULE 4 — PROFITABILITY & SCENARIOS

A dedicated page. This produces the artifact a farmer hands his banker and his landlord.

#### 4.1 Input costs (per crop)
Per-acre categories: seed, fertilizer, chemical, fuel, labor/custom, crop insurance, cash rent, equipment/depreciation, interest, other. **Pull chemical and seed costs from Inventory** where available.

Support **2–3 comparable scenarios side by side** (e.g. "high fertilizer," "reduced pass," "aggressive yield").

#### 4.2 Land arrangement comparison *(explicit requirement)*
For a given field/crop, compare operator net $/acre across:
- **Owned**
- **Cash rent**
- **Flex cash rent** (configurable bonus formula)
- **Crop share — 2/3–1/3, 60/40, 50/50, custom**

Side by side, one screen. Reads arrangement definitions from Fields. This is what farmers use to evaluate a lease and negotiate with a landlord.

#### 4.3 Breakeven
- Per crop, per field, per whole farm.
- **Breakeven $/bu = total cost per acre ÷ expected yield per acre.**
- Recalculates live as inputs, yield, or arrangement change.
- **Feeds back into the Grain page** as the overlay line (2.4).

#### 4.4 PROFITABILITY MATRIX ⭐ *(the signature element — build this well)*
A grid / heat map:
- **X axis: grain price** (range around the current board)
- **Y axis: yield** (range around expected)
- **Each cell: profit or loss per acre** at that price × yield, given the scenario's input costs
- **Shade it:** green above breakeven, red below, a bright **breakeven contour line** between
- **Interactive:** change scenario or inputs → matrix updates live

This one visual is worth more to a farmer than ten reports. Make it the memorable thing about the page.

#### 4.5 Cost per acre BY FIELD
Falls out of this module nearly free — and most farmers genuinely do not know which fields make money and which ones bleed. **This is the number that changes what they're willing to cash-rent.** Surface it prominently.

#### 4.6 Reports
Every profitability view exports to a **clean, Crop RX-branded PDF.** This PDF is a marketing asset and a sales tool — treat its polish as a feature. Mason has an existing ReportLab-based branded PDF pipeline (the tank-label system); reuse that branding approach and token set.

---

### MODULE 5 — EQUIPMENT & MAINTENANCE

Mason runs ~22 semis (Detroit Diesel / Paccar), a RoGator 1100C sprayer fleet, a Case IH 8250 combine, a MacDon FD145 header, and a Stealth ZD tile plow. His customers have comparable fleets.

- **Asset record:** make, model, year, serial/VIN, purchase date, purchase price.
- **Hours / miles** tracking.
- **Service intervals** with reminders (oil change, filters, DEF, inspections) — reminders push to the Task Board (Module 6).
- **Repair history** — date, work performed, parts, cost, vendor.
- **Warranty** tracking with expiration alerts.
- **Cost per machine** — rolls into Profitability equipment costs.
- Document/photo attachment (receipts, manuals).

*Optional / assess later:* DOT fleet compliance (DVIRs, IFTA, CDL and medical-card expirations). Relevant for a 22-truck fleet but a distinct problem domain — confirm with Mason before building.

---

### MODULE 6 — TASK BOARD

Port the concept from CRX Manager.

- Create tasks, **assign to employees**, set due dates.
- **Tie tasks to fields and equipment** (*"spray Field 12," "service Truck 7"*).
- Reminders / notifications (in-app + email).
- Simple status: To Do → Doing → Done.
- Employee logins with restricted permissions (an employee must NOT see the grain position).
- Service intervals from Module 5 auto-generate tasks.

Keep it dead simple. This is a farm crew, not a software team. No sprints, no story points, no swimlanes.

---

### MODULE 7 — MACHINE DATA IMPORT ⭐ *(strategically important — read the build note)*

Farmers must be able to bring in **planting and harvest data** from **Climate FieldView, John Deere Operations Center, and AgFiniti (Ag Leader).**

This feeds:
- **Actual harvested bushels** → Module 2.2 (the projected→actual switch)
- **Seed variety by field** → 7.2
- **Planting dates** → GDD/crop staging → 7.3
- As-applied data → spray records (Module 3.3)

#### 7.1 How to build it — READ THIS BEFORE STARTING

**Do NOT build three separate OAuth integrations.** Each vendor requires separate developer registration, partner approval, and its own OAuth flow. John Deere's Operations Center API requires app registration, an OAuth handshake, and the user *separately* adjusting permissions at `connections.deere.com`. Climate FieldView requires its own client ID / client secret / API key and a "Log in with FieldView" OAuth flow. That's weeks of work plus vendor approval cycles.

**Use middleware instead. `Leaf` (leafagriculture) abstracts John Deere, Climate FieldView, and Trimble behind ONE API** with normalized **Plant / Apply / Harvest** operations. It handles the per-vendor OAuth and returns standardized data. This collapses the entire problem into a single integration.

**Phase it:**
- **Phase A (v1):** **File upload.** The farmer exports a shapefile/CSV from FieldView, Ops Center, or AgFiniti and uploads it. Works immediately. Zero partnerships, zero approvals, zero OAuth. **Ship this.**
- **Phase B:** Add **Leaf** for live sync once there are paying users. Verify Leaf's AgFiniti / Ag Leader coverage during Phase B — if unsupported, keep file upload for AgFiniti.

*Useful note: John Deere Operations Center can already ingest FieldView data via its Connections tool, so a single Deere integration may transitively cover FieldView users who have linked the two.*

#### 7.2 Seed variety tracking
- Hybrid/variety by field — **auto-populated from planter as-planted data**, or **manually tagged** if the farmer has no monitor.
- Link **variety → field → yield** so the farmer can answer *"what did that hybrid actually make on that ground?"*
- Multi-year variety performance history.

#### 7.3 Growing degree days / crop staging
- GDD accumulation per field from **planting date** (auto from planter data, or manual).
- Predict growth stage (V-stages, R-stages).
- Drives timing decisions — fungicide passes, post-emerge windows. Natural hook back to Crop RX agronomy.
- Needs a temperature source. **The NWS API is free** and sufficient.

---

## PART 4 — MARKET DATA: THE DECISION

Mason wants delayed futures **and** local elevator cash bids. These are two different problems.

### Futures — easy and cheap
Delayed CBOT quotes for corn, soybeans, wheat are widely available:
- **API Ninjas** — free tier gives 15-minute delayed data in bushels with OHLCV history *(note: the free tier rotates a limited set of commodities weekly — verify corn/beans/wheat availability, or take the cheap paid tier)*
- **CommodityPriceAPI** — Lite tier: 2,000 calls/month, 10-minute updates
- **Databento** — licensed CBOT distributor, carries ZC/ZW/ZS, offers free starting credits

Any of these covers it for roughly $0–30/month. **Not a blocker.**

### Cash bids — this is the real problem
**There is no free source of local elevator cash bids, and here is why:** DTN collects 36,000–40,000 bids per day from 4,200 grain buyers, gathered **by phone** — a dozen staff literally calling elevators every market day. They're explicit that competitors mostly *scrape* websites, and that scraped prices may be stale or merely "posted" rather than what the buyer will actually pay. Barchart scrapes. AgWeb's public cash-bid tool is Barchart underneath.

**Options:**

| Option | Cost | Verdict |
|---|---|---|
| **Barchart OnDemand** — `getGrainBids` returns the ~30 nearest elevators to a ZIP with name, price, basis, delivery window, contact | ~$650/yr | **Recommended.** Works immediately. |
| **DTN Grain Bids API** | Quote-based, likely higher | Better data (phoned, not scraped) but requires a site ID + portal config. Enterprise-y. |
| **Scrape local elevators yourself** | $0 + maintenance | Tempting — only ~15 elevators matter, not national coverage. But scrapers break silently, several elevators serve bids from third-party widgets behind session cookies and anti-forgery tokens, and it likely violates ToS. Debugging a broken parser during planting is a bad trade. |

### The phased plan (decided)
1. **v1:** Free/cheap futures API + **manual basis entry** (farmer types his local bid once). Ships now, costs nothing, proves the product.
2. **v2:** Add **Barchart** (~$650/yr ≈ $54/month) once there are paying users. Ten customers at $10/month covers it. **Do not scrape.**
3. **Abstract the market-data layer behind an internal service interface** so the vendor can be swapped without touching UI code.

**Hard gate before building the cash-bid feed:** confirm **in writing** with Barchart that their license permits displaying elevator cash bids to end-user farmers inside a commercial application. *(This is a real legal question — get it confirmed by Barchart, and ideally by counsel, before committing dev time.)*

---

## PART 5 — BRAND

Use these verbatim. They come from Crop RX's existing print standards — which means every customer already recognizes this visual language from the tank labels they've been handed for years.

```
CRX_GREEN     #28A26A   Primary buttons, active nav, positive values, total bars
DEEP_GREEN    #218A5C   Section headers, secondary emphasis
CHARCOAL      #2E2E2E   Primary text
MATTE_GRAY    #4E4E4E   Labels, secondary text
LIGHT_GREEN   #E8F5EE   KPI / stat card backgrounds
PREMIX_BG     #F5F5F5   Table zebra striping, page background
WARN_RED      #C62828   Overdue, unpriced, below-breakeven, late compliance
WARN_BG       #FFF3E0   Alert card fill

--- Added for app use (not in the print set) ---
CHROME_GREEN  #17513A   Deep green for large surfaces (sidebar). #218A5C vibrates at full height.
AMBER         #E8A33D   "Heads up" state. NOT everything non-green can be red — if it is,
                        farmers tune red out within a week and miss the one that mattered.
HAIRLINE      #E3E6E4   Borders / dividers
```

- **Radius:** 16px on cards (matches the print tank-label cards)
- **Type:** Helvetica-style face for headings and the logo lockup (matches existing labels). **Inter** for body and **all numbers**, with `tabular-nums`.
- **Logo:** `https://croprxsolutions.com/wp-content/uploads/2025/10/logo-1.png` (960×300)
- **Slogan:** `INNOVATIVE SOLUTIONS. UNMATCHED RESULTS.`

### The co-branding lockup (important)
- **The farm's own logo goes TOP-LEFT** in the sidebar. This is *their* software.
- **The Crop RX mark is pinned to the BOTTOM of the sidebar** — "Powered by Crop RX." Always visible, never in the way.
- If the farm uploads no logo, **fall back to their farm name in bold.** Never leave the slot empty.
- **The login screen is the one place to go full CRX brand:** large ℞ / "Farm Rx" mark, CRX green, the slogan, and *"by Crop RX Solutions."* The instant they log in, it becomes their farm and Crop RX steps back to a footer mark.
- That hierarchy shift is what makes the co-branding feel like a gift instead of a leash. It is also what makes Rule 2 credible.

**A working HTML mockup** (dashboard + login, real tokens, real logo, co-branding lockup, stat boxes, alert card, data table, total bar) accompanies this handoff — use it as the visual reference. *Note: the mockup file is labeled "Rx One"; the name is now **Farm Rx**. All tokens and layout still apply.*

### Design note
The stat boxes, `DEEP_GREEN` section headers, zebra-striped tables, `WARN_RED` alert boxes, and `CRX_GREEN` total bars in this app are **lifted directly from Crop RX's existing tank labels.** Customers have been reading this interface for years without knowing it was software. Preserve that.

---

## PART 6 — BUILD ORDER

1. **Preliminary:** Point Claude Code at the CRX Manager repo. Extract and document the reusable **Fields** (acres, billing splits) and **Inventory** (products, spray records, EPA compliance) engines.
2. **Module 1 — Fields.** Nothing works without acres.
3. **Module 2 — Grain.** The daily-use hook. Start with manual entry + free futures + manual basis.
4. **Module 4 — Profitability.** Ties Fields + Grain together. Produces the banker PDF.
5. **Module 3 — Inventory & compliance.**
6. **Modules 5 & 6 — Equipment & Tasks.**
7. **Module 7 — Machine data import.** Phase A (file upload) can land earlier if it unblocks actual-bushel entry.

**Ship Fields + a usable Grain page in front of a handful of real Crop RX customers before building the rest.** Their reaction will reorder everything below it. This is the most important sentence in this document.

---

## PART 7 — EXPLICITLY OUT OF SCOPE

Considered and cut. Do not build:
- Options contracts (puts/calls/collars) — cash, forward, basis, and HTA only
- Weather / spray-window alerts
- Landlord portal
- App store distribution (PWA instead)
- Scraping elevator websites

**Roadmap — not now, but do not design in a way that blocks:**
- Soil test storage per field *(Mason has an existing Kinsey-Albrecht interpreter to plug in)*
- CRX Manager → Farm Rx delivery sync
- Barchart cash-bid feed
- Leaf live machine-data sync
- DOT / fleet compliance

---

## PART 8 — OPEN QUESTIONS FOR MASON

1. **Scale tickets / load tracking** — 22 semis, and this was never decided. Ticket in/out, truck, field, buyer. It's the other natural source of actual harvested bushels alongside yield-monitor import. In or out?
2. **Prepay balance tracking** — Crop RX already processes prepay invoices, and farmers prepay for tax reasons. Showing a prepay balance and what it's drawn against ties Farm Rx to the invoicing. In or out?
3. **Pricing model** — free to Crop RX customers, or a subscription? Determines whether the $650 Barchart cost is trivially covered.
4. **Employee permissions** — how granular? At minimum, an employee must NOT see the grain position or financials.
