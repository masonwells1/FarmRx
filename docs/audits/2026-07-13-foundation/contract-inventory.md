# Farm Rx Contract Inventory — 2026-07-13

This is a source-of-truth inventory of promised features, behaviors, business rules, data requirements, and UI rules. It is not a built-state review.

## 1. Product, platform, and ship objective

1. **Ship objective:** Put Fields and a usable Grain page in front of a handful of real Crop RX customers before expanding scope. `docs/GOAL.md:5-12`; `docs/farm-rx-handoff.md:393-403`

2. **Audience:** Corn, soybean, and wheat growers in southeastern Illinois and western Indiana, often using a phone outdoors, in sunlight, with gloves. `docs/farm-rx-handoff.md:6-10,18-23`; `docs/design/02-experience-principles.md:3-4`

3. **Platform:** React, TypeScript, Supabase/Postgres/Auth/RLS, Vercel, Recharts, and PWA delivery rather than app stores. `docs/farm-rx-handoff.md:37-46`

4. **Offline tolerance is mandatory:** Writes must survive poor rural connectivity; a dropped connection must not lose a sale, spray record, scouting note, or other entered record. `docs/farm-rx-handoff.md:48-52`

5. **Future integrations must remain possible:** CRX Manager delivery sync, Barchart cash bids, Leaf machine-data sync, soil tests, and DOT compliance are future seams, not necessarily V1 features. `docs/farm-rx-handoff.md:416-421`

6. **Medical branding is prohibited in navigation and feature names:** Use Fields, Grain, Inventory, Profitability, Equipment, and Tasks; never “Prescriptions,” “Diagnosis,” “Treatment,” “Vitals,” or “The Chart.” `docs/farm-rx-handoff.md:32-34`; `docs/design/01-brand.md:78-82`

## 2. Cross-cutting experience and visual rules

7. **Minimum text size:** Use an 18px base and treat 18px as the minimum farmer-facing text size for this inventory. `docs/farm-rx-handoff.md:18-23`; `docs/foundation-design.md:14-19`; `docs/design/02-experience-principles.md:6-14`

   - **Document contradiction:** The brand document says base size is 18px but allows non-load-bearing text down to 16px. `docs/design/01-brand.md:49-58`; `docs/design/02-experience-principles.md:6-10`
   - The stricter 18px rule is repeated by the foundation, module designs, and mission instructions.

8. **Touch targets:** Buttons, inputs, links, row actions, and common controls require at least 48px tap targets. `docs/farm-rx-handoff.md:18-23`; `docs/design/02-experience-principles.md:6-14`

9. **Numeric typography:** All numbers use `tabular-nums`; bushels, dollars, and numeric columns must align. `docs/farm-rx-handoff.md:18-23`; `docs/design/01-brand.md:49-58`; `docs/design/03-components.md:37-44`

10. **Plain English:** Farmer-facing wording must use ordinary language such as “Fields,” “Grain,” and “What you owe,” avoiding technical or financial jargon. `docs/design/02-experience-principles.md:11-14`

11. **Two-tap rule:** Everyday actions such as logging rain, entering a load, or checking a bid must be reachable from the dashboard in two taps. `docs/design/02-experience-principles.md:8-14`

12. **Status is never color-only:** Red, amber, and green states must also include words or icons such as “Overdue,” “Heads up,” or “Sold.” `docs/design/02-experience-principles.md:16-21`; `docs/programs-design.md:418-425`

13. **Contrast:** Use charcoal text on white or cream surfaces; do not use gray-on-gray, text over imagery without a scrim, or low-contrast secondary text. `docs/design/02-experience-principles.md:16-21`

14. **One hero question per screen:** Dashboard answers “Am I okay today?”, Grain answers “What’s sold, what’s open, what’s it worth?”, and Fields answers “What’s planted where?” `docs/design/02-experience-principles.md:23-31`

15. **Calm visual hierarchy:** Neutral surfaces are the default; red is reserved for money or deadline risk; amber means noteworthy but not urgent; normally only one red element should appear per screen. `docs/design/01-brand.md:17-20,41-47`; `docs/design/02-experience-principles.md:33-39`

16. **Motion:** Use only functional 150–200ms ease-out transitions, visible press feedback, and honor `prefers-reduced-motion`. `docs/design/02-experience-principles.md:41-46`

17. **Empty, loading, and error states:** Empty states must teach and offer one add action; loading uses layout-shaped skeletons; errors explain what happened and what to do next in plain English beside the failed item. `docs/design/02-experience-principles.md:48-53`

18. **Trust cues:** Grain and financial screens visibly state whether information is private or shared, and sync status is always one glance away. `docs/design/02-experience-principles.md:55-60`

19. **Offline status wording:** Use “Saved,” “Saving…,” and “Offline — will save when you’re back in coverage,” distinguishing device persistence from server synchronization. `docs/design/02-experience-principles.md:55-60`; `docs/foundation-design.md:456-475`

20. **Receipt-backed offline writes:** Every offline-capable write must either confirm the server result, confirm a durable queued copy on the device, or show an error while preserving the form values. `docs/foundation-design.md:384-390`

21. **Receipt wording:** The durable local-save state must say “Saved on this device — waiting for signal,” not “Synced.” `docs/foundation-design.md:7-12,468-475`

22. **Buttons:** One primary action per screen region; labels are verbs of at most three words; all buttons have press feedback and a visible amber focus ring. `docs/design/03-components.md:6-18`

23. **Cards and tables:** Cards use a 16px radius, hairline border, white surface, and soft shadows. Tables use zebra striping, right-aligned tabular numbers, a green total bar, rows at least 56px high, and card-style collapse on phones. `docs/design/03-components.md:29-44`

24. **Forms:** Labels sit above inputs; inputs are at least 48px high; helper text and validation are plain English; placeholders cannot substitute for labels. `docs/design/03-components.md:46-52`

25. **Alerts:** Red means money/deadline risk, amber means “act this week,” and green means confirmation. Alert copy states what happened, what to do, and uses at most one button. `docs/design/03-components.md:54-62`

26. **Money and quantities:** Dollars use `$` and thousands separators; cents appear only where meaningful; positive and negative changes carry explicit signs; bushels use whole-number separators. `docs/design/03-components.md:74-80`

27. **App shell:** Desktop uses a 262px dark sidebar; phones use a bottom tab bar with four or five common modules plus More; the sticky top bar contains page context, sync status, and alert bell. `docs/design/04-page-patterns.md:3-11`

28. **Dashboard layout:** Greeting/date/weather, alerts when present, three daily stat boxes, today’s work, then Grain snapshot. `docs/design/04-page-patterns.md:13-22`

29. **List layout:** Heading, one-line summary, one primary action, optional filtering for lists over roughly ten rows, table/cards, and a meaningful green total bar. `docs/design/04-page-patterns.md:24-29`

30. **Detail layout:** Back link, title, secondary actions, two-column information grid, then newest-first history and related records. `docs/design/04-page-patterns.md:31-36`

31. **Login and print layout:** Login is the full Crop RX brand moment; banker PDFs use white/black print styling, limited brand tokens, an ℞ watermark, and the farmer’s name more prominent than Crop RX. `docs/design/04-page-patterns.md:45-54`

32. **Brand colors and semantics:** Green is brand/good/active, red is money/deadline risk only, amber is “heads up,” and new colors require updating the brand specification first. `docs/design/01-brand.md:6-20,41-47`

33. **Co-branding:** Farm identity appears top-left; “Powered by Crop RX” remains at the sidebar bottom; Crop RX dominates only on login and appears lightly in PDFs or loading states. `docs/design/01-brand.md:60-76`

34. **Typography:** Headings use Barlow Semi Condensed; body text and all numbers use Inter with tabular numerals; large KPI numbers are 32–44px and bold. `docs/design/01-brand.md:49-58`

35. **Design-system contradiction:** The original handoff specifies `CHROME_GREEN` and one hairline color, while the later brand decision adopts `NAV_DARK`, cream neutrals, and a different hairline token. The later Modern Farmstead token set should be treated as the current UI contract. `docs/farm-rx-handoff.md:353-376`; `docs/design/01-brand.md:22-39`

## 3. Authentication, onboarding, privacy, and authorization

36. **Owner-provisioned accounts:** V1 has sign-in and sign-out but no public sign-up; Crop RX provisions customer accounts outside the browser app. `docs/foundation-design.md:122-129`; `docs/onboarding-design.md:11-24`

37. **Authentication provider:** Restore the session, subscribe to auth changes, expose sign-in/sign-out, persist sessions across PWA closes, refresh tokens, and avoid duplicate Supabase clients. `docs/foundation-design.md:120-149`

38. **Routing:** While restoring, show “Opening your farm…” without flashing login or private content; signed-out users redirect to login; signed-in users visiting login go to Fields; expired sessions show a plain-English sign-in-ended message. `docs/foundation-design.md:151-168`

39. **Sign-in UX:** Trim email input, disable the button during submission as “Signing in…,” use farmer-friendly errors, and never expose raw Supabase/Postgres/RLS messages. `docs/foundation-design.md:147-168`

40. **Farm bootstrap:** A first owner may create exactly one farm and first operating entity, with trimmed non-empty names, an allowed entity type, owner membership, and sharing off by default. `docs/foundation-design.md:170-211`; `docs/schema-fields-support.md:29-35`

41. **Bootstrap safety:** More than one accessible farm fails closed; a failed entity creation must not create another farm; retries resume setup without data loss. `docs/foundation-design.md:174-211`

42. **Farm tenancy:** Every private record is farm-scoped, and cross-farm references must be rejected by composite relationships and authorization checks. `docs/schema-module1.md:16-24`; `docs/schema-module2.md:17-25`

43. **Module 1 role rules:** Active members may read Fields data; owners, managers, and workers may edit; read-only members cannot edit. Representatives are read-only and require deliberate access. `docs/schema-module1.md:16-24`

44. **Representative access:** Grain and financial data require both the farm’s share toggle and an enabled named representative grant; either being off blocks access on the next request. `docs/schema-module1.md:20-24`; `docs/foundation-design.md:539-546`

45. **Financial privacy:** Grain and Profitability default private; owners/managers may read, and a specific active employee may receive a “View financials” permission. Suspended or revoked memberships immediately lose access. `docs/foundation-design.md:525-546`

46. **No self-granting:** Employees cannot grant financial access to themselves; membership-setting policies allow only owners/managers to change the permission. `docs/foundation-design.md:529-537`

47. **Inventory privacy distinction:** Inventory and spray records are ordinary operational data; active members may read, and owners/managers/workers may edit. Inventory does not depend on the financial privacy gate. `docs/schema-module3.md:17-29`; `docs/inventory-live-design.md:36-38,145-148`

48. **Secret handling:** Service-role credentials and private push/email keys must stay outside the browser, repository, committed files, and customer-path tests. `docs/onboarding-design.md:118-123,194-201`; `docs/reminders-design.md:39-58`

## 4. Fields and foundation

49. **Field data model:** Fields contain name, legal/location data, acres, optional FSA numbers, productivity index, and operating entity. `docs/farm-rx-handoff.md:83-101`; `docs/schema-module1.md:5-15`

50. **Crop assignments:** Crop is stored as separate yearly assignment rows keyed to field, year, commodity, and planted acres, allowing wheat followed by double-crop soybeans on one field. `docs/farm-rx-handoff.md:66-74`; `docs/schema-module1.md:11-14`

51. **Supported commodities:** Yellow corn, white corn, Non-GMO corn, soybeans, double-crop soybeans, and wheat are distinct marketable commodities with separate premiums, buyers, contracts, bins, and delivery rules. `docs/farm-rx-handoff.md:56-74`; `docs/schema-module1.md:12-14`

52. **Operating entities:** Multiple entities are supported; fields and reports must be filterable by entity. `docs/farm-rx-handoff.md:89-101`; `docs/schema-module1.md:26-32`

53. **Land arrangements:** Support owned, fixed cash rent, flex cash rent, and crop share, including 2/3–1/3, 60/40, 50/50, and custom splits. Crop-share inputs may have separate landlord percentages. `docs/farm-rx-handoff.md:89-101`; `docs/schema-module1.md:14,26-32`

54. **Fields screens:** Provide a sortable field list with acreage statistics, field detail with crop history, arrangement, acres, and yield history, plus fast add/edit. `docs/farm-rx-handoff.md:99-102`

55. **Fields feeds:** Planted acres feed Grain expected bushels; arrangements and acres feed Profitability share economics. `docs/farm-rx-handoff.md:99-102`

56. **Missing round-trip columns:** The live Fields contract requires landlord phone, landlord contact notes, harvested bushels, expected yield per acre, and expected price per bushel, preserving nullability and nonnegative/positive constraints. `docs/foundation-design.md:27-41`; `docs/schema-fields-support.md:5-10`

57. **Atomic field save:** A field save includes the field, current arrangement, and relevant crop assignments in one transaction, with a write receipt and replay by operation ID. `docs/foundation-design.md:43-51`; `docs/schema-fields-support.md:7-17`

58. **Field-save authorization:** The save RPC binds to `auth.uid()`, requires farm edit permission, ignores nested user/farm stamps, validates every parent and child against the selected farm, and permits no direct client receipt-table writes. `docs/foundation-design.md:43-49`; `docs/schema-fields-support.md:19-25,37-41`

59. **Arrangement history:** Same-date or unchanged edits update the current arrangement in place; later effective dates close the prior arrangement one day earlier and insert the new one; changed earlier dates reject; only one arrangement remains open. `docs/foundation-design.md:300-305,319-320`

60. **Crop-assignment save semantics:** Empty assignment arrays mean no assignment change; non-empty arrays affect only included years; existing IDs must belong to the exact field and farm; omitted rows are deleted only in affected years; other years remain unchanged. `docs/foundation-design.md:300-306`

61. **Fields repository behavior:** Queries must be farm-filtered, complete, strictly mapped, preserve nulls, reject unknown enums/non-finite numbers, and never return partial workspace data or mock fallback. `docs/foundation-design.md:271-286`

62. **Fields/Grain separation:** Grain may read live Fields through dependency injection, but each repository writes only its own backend; Grain saves must never overwrite Fields storage. `docs/foundation-design.md:311-335`

63. **Fields offline queue:** Use a versioned, farm/user/project-specific queue with byte-for-byte write/read verification, FIFO replay, stable operation IDs, multi-tab coordination, and preservation of corrupt bytes. `docs/foundation-design.md:392-418,432-455`

64. **Queue classification:** Transport failures queue; authentication, RLS, validation, conflict, malformed-server, and canonical-confirmation failures block without being silently retried. `docs/foundation-design.md:420-430,450-454`

65. **Fields conflict policy:** Within V1, the last valid replayed write wins for the same field, while arrangement history and incompatible crop-array rules remain enforced. `docs/foundation-design.md:477-481`

## 5. Grain, marketing, storage, and alerts

66. **Expected production:** Calculate planted acres × expected yield by crop, entity, and farm; double-crop soybeans and white/Non-GMO corn remain separate production lines. `docs/farm-rx-handoff.md:109-115`

67. **Projected versus actual:** Store both projected and actual bushels, let each crop select which drives current math, and recalculate marketing percentages, plans, and breakevens against the selected value. `docs/farm-rx-handoff.md:116-125`; `docs/schema-module2.md:7-10,27-34`

68. **Market data:** Support delayed CBOT corn, soybean, and wheat quotes, new-crop contracts, visible delay labeling, and local cash-bid context. `docs/farm-rx-handoff.md:127-132`

69. **Cash-bid phasing:** V1 may use manual basis/cash-bid entry; a later Barchart feed requires written confirmation that commercial end-user display is licensed, and scraping is prohibited. `docs/farm-rx-handoff.md:321-349`

70. **Position view:** Show production, priced/unpriced bushels and percentages, average sold price, blended expected revenue, breakeven, insurance floor, and remaining open bushels. `docs/farm-rx-handoff.md:133-145`

71. **Contracts:** Support cash/spot, forward cash, basis, and HTA only. Capture buyer, commodity, bushels, price or futures+basis, delivery window, contract number, and white/Non-GMO premium. Options are out of scope. `docs/farm-rx-handoff.md:146-155`; `docs/schema-module2.md:27-34`

72. **Marketing plans:** Support monthly percentage targets, absolute prices, breakeven-relative percentages, and deadlines, with a grid as the primary view. `docs/schema-module2.md:7-10,27-38`; `docs/grain-live-design.md:83-111`

73. **Marketing-plan replacement:** A single edit must be normalized into a complete scoped bundle; total planned percentage cannot exceed 100%; empty replacement intentionally clears only that exact scope; replacement is atomic and idempotent. `docs/grain-live-design.md:87-111`

74. **Insurance:** Store APH, insured acres, coverage percentage, revenue guarantee, and calculate guarantee dollars per bushel and safe-to-forward bushels. `docs/farm-rx-handoff.md:163-165`; `docs/schema-module2.md:9-15,34-38`

75. **Bins:** Track on-farm/commercial storage, capacity, commodity identity, bushels, and committed/free quantities. White and Non-GMO grain must remain segregated. `docs/farm-rx-handoff.md:167-171`; `docs/schema-module2.md:11-15,35`

76. **Basis history:** Store dated cash bids as append-only observations by elevator and commodity so history charts build from ordinary use. `docs/farm-rx-handoff.md:173-174`; `docs/schema-module2.md:13,36`

77. **USDA calendar:** Provide WASDE, Grain Stocks, Prospective Plantings, and Crop Progress dates, with optional reminders and public read-only access. `docs/farm-rx-handoff.md:176-177`; `docs/schema-module2.md:14-15,25`

78. **Marketing disclaimer:** Grain and Profitability show numbers and targets but never tell a farmer to sell; the product must not imply Mason is a licensed advisor. `docs/farm-rx-handoff.md:179-180`

79. **Grain privacy:** Production estimates, contracts, targets, insurance, bins, bin balances, and cash bids are farm-private and require the established financial-sharing rules for representatives. `docs/schema-module2.md:17-25`

80. **Grain repository:** Load all private row sets completely, filter by farm, validate relationships and enum/value rules, reject partial or malformed data, and use live Fields as the acreage authority. `docs/grain-live-design.md:15-25,51-79`

81. **Grain writes:** Production estimates, contracts, and cash bids use stable UUID upserts; marketing plans use complete desired-state replacement; bin writes are not part of the original repository swap. `docs/grain-live-design.md:83-95`

82. **Grain offline behavior:** Use a distinct queue key, strict discriminated entries, FIFO replay, exact scope overlays, stable IDs, and honest pending/syncing/blocked/synced states. `docs/grain-live-design.md:113-138`

83. **MARS feed:** Any USDA basis feed must be server-side, labeled as Iowa pilot data, deterministic and idempotent, display-only, and prohibited from silently populating contracts, targets, or manual bid forms. `docs/grain-live-design.md:140-157`

84. **Check-on-open alerts:** V1 alert evaluation is not continuous monitoring; it runs after a complete Grain load and must say so plainly. Price targets require fresh cash prices, deadlines notify seven days before and on the date, and USDA reports notify seven days before and on the date. `docs/grain-live-design.md:159-171`

85. **Phase-2 marketing alerts:** Add price-target, percentage-marketed-goal, and deadline rules, with break-even shown while configuring them, in-app evaluation, and email delivery through the existing owner-alert path. `docs/profitability-grand-plan.md:18-23,99-104`; `docs/schema-phase2-grain-marketing.md:13-19`

86. **Alert email settings:** Store up to three trimmed email addresses per farm, privately, with a second address explicitly approved for the phase-2 design. `docs/schema-phase2-grain-marketing.md:5-11`

   - **Document contradiction:** Earlier Grain design specifies owner-only email and no configurable settings; phase-2 documents supersede that for the later marketing-alert feature. `docs/grain-live-design.md:91-93,159-171`; `docs/schema-phase2-grain-marketing.md:5-19`

87. **Firm offers:** Track buyer, offer type, bushels, price/basis, optional contract month/expiration/location/notes, status, and linked filled contract. Open offers appear as pending, not sold, until filled or expired. `docs/profitability-grand-plan.md:20-23,84-91,106-109`; `docs/schema-phase2-grain-marketing.md:21-29`

88. **Cost of carry:** Provide storage settings, interest, second-haul trucking, month-by-month delivery comparisons, total carry, net versus harvest, best month, and a plain-English verdict such as “Deliver at harvest” or “Store until March.” `docs/profitability-grand-plan.md:18-20,73-82`

89. **Bin upgrade:** Add fill bars, moisture percentage and last-checked date, risk flags, locations, movement ledgers, and “in bins” quantities flowing into Grain marketing context. `docs/profitability-grand-plan.md:24-25,111-114`

90. **Insurance calculator:** Capture coverage percentage, APH, projected price, and premium reference; calculate revenue floor, dollars at risk, bushels at risk, and Safe-to-Forward bushels. `docs/profitability-grand-plan.md:26-29,116-122`; `docs/schema-phase2-grain-marketing.md:43-47`

## 6. Inventory, spray records, and compliance

91. **Product catalog:** Support chemical, seed, fertilizer, biological, adjuvant, and other inputs, including EPA registration, RUP flag, seed/fertilizer facts, label intervals, and one inventory unit. `docs/schema-module3.md:5-15`

92. **Inventory sources:** Track both Crop RX-delivered products and farmer-purchased products; the inventory represents the entire shed, not merely Crop RX sales. `docs/farm-rx-handoff.md:184-194`

93. **Receipts:** Support purchases, opening balances, and future deliveries; draft receipts do not affect inventory, received receipts do, and received receipts cannot be rewritten except through audited cancellation. `docs/schema-module3.md:7-9`; `docs/inventory-live-design.md:17-34`

94. **Adjustments:** Physical-count, loss, return, and transfer corrections are signed append-only entries; corrections add an opposite entry rather than editing history. `docs/schema-module3.md:8-14`

95. **Applications:** Each application belongs to exactly one field and crop assignment; each product line records rate, total, lot, regulatory snapshots, and optional cost snapshot. `docs/schema-module3.md:9-15`

96. **Historical snapshots:** Product name, EPA number, RUP flag, label intervals, maximum rate, inventory unit, and cost are snapshotted at application time so later catalog edits cannot rewrite history. `docs/schema-module3.md:25-29`; `docs/inventory-live-design.md:230-256`

97. **On-hand source of truth:** On-hand is always derived as received plus adjustments minus effective completed applications; no separately stored mutable on-hand total is authoritative. `docs/schema-module3.md:12-14`; `docs/inventory-live-design.md:397-423`

98. **RUP completeness:** Distinguish federal restricted-use record requirements from Farm Rx’s stronger operational checklist, including weather, target pest, rate, REI, and PHI. Missing federal fields must not be confused with general best-practice gaps. `docs/schema-module3.md:14-15,48-52`; `docs/inventory-live-design.md:425-436`

99. **Unit conversion:** Automatically convert only physically unambiguous same-family units; package/count conversions require an explicit snapshotted factor; volume-to-weight and weight-to-volume conversions are always rejected. `docs/schema-module3.md:31-46`; `docs/inventory-live-design.md:230-252`

100. **Unit immutability:** Once a product has receipt, adjustment, or application history, its inventory unit cannot change; a new catalog product is required. `docs/schema-module3.md:40-44`

101. **Chemical-needed planner and nutrient removal:** The product roadmap promises planned-versus-applied product quantities and N/P/K removal calculations from harvested bushels, but the current schema design intentionally leaves these coefficient/planner tables for a later phase. `docs/farm-rx-handoff.md:196-209`; `docs/schema-module3.md:54-64`

102. **Delivery-event seam:** Future CRX Manager delivery events must be idempotent inbox records; events alone never change on-hand, and only a reviewed received Farm Rx receipt affects inventory. `docs/schema-module3.md:10-14`; `docs/programs-design.md:376-388`

103. **Atomic inventory writes:** Receipt bundles and application bundles must be all-or-nothing, with server-generated snapshots and exact canonical response confirmation. `docs/inventory-live-design.md:30-34,260-376`

104. **Inventory offline ordering:** Product creation precedes receipts/applications; receipt draft precedes receive; receive precedes cancellation; application writes remain behind the receipt whose cost snapshot they need. `docs/inventory-live-design.md:440-487`

105. **Inventory UI:** Keep the workflow lean, show derived shelf totals and RUP warnings, preserve received/cancelled history, and never show mock seed stock after the live transition. `docs/inventory-live-design.md:10-38,501-508`

106. **Original handoff spray fields:** Spray records capture product, rate, EPA registration, date, field, applicator, pest, weather, REI, and PHI, with product facts pulled from inventory to avoid re-entry. `docs/farm-rx-handoff.md:196-203`

## 7. Profitability, scenarios, and reports

107. **Budget model:** A crop-year/commodity budget may have named scenarios, optional entity/enterprise scope, expected yield, and expected price. `docs/schema-module4.md:5-14`

108. **Cost lines:** Support seed, chemical, fertilizer, fuel, repairs, labor, land, crop insurance, equipment/depreciation, interest, custom lines, and BU TO COVER. `docs/farm-rx-handoff.md:213-220`; `docs/schema-module4.md:7-11`

109. **Arrangement comparison:** Compare owned, cash rent, flex rent, and crop share in operator cost/net dollars per acre, using equivalent-cash-rent normalization and preventing double-counting land. `docs/farm-rx-handoff.md:222-229`; `docs/schema-module4.md:11-14,33-36`

110. **Breakeven:** Calculate per crop, field, and farm; breakeven price is total cost per acre divided by expected yield per acre; it updates with inputs, yield, and arrangement changes and feeds Grain. `docs/farm-rx-handoff.md:231-235`; `docs/schema-module4.md:27-32`

111. **Profitability matrix:** Use grain price on the X axis and yield on the Y axis; each cell shows profit/loss per acre; shade above/below breakeven and draw a breakeven contour; changes update interactively. `docs/farm-rx-handoff.md:237-245`

112. **Field profitability:** Surface cost per acre by field and retain fields with incomplete arrangements by using the budget’s planned land line. `docs/schema-module4.md:11-14`

113. **Privacy:** Budgets, cost lines, matrix steps, and allocations are as private as Grain and must obey financial access rules. `docs/schema-module4.md:15-25`

114. **Live repository contract:** Use strict farm-bound mapping, Fields cross-checks, exact canonical confirmation, and a shared Profitability repository instance for Grain breakeven calculations. `docs/profitability-live-design.md:39-68,151-173,440-457`

115. **Atomic profitability writes:** Matrix replacement and budget copying are transactional; ordinary budgets, cost lines, and allocations use single-row operations. `docs/profitability-live-design.md:177-220`

116. **Copy semantics:** Copying a budget creates new UUIDs for the budget and every child, re-parents children, records the source budget, and shares no mutable references. `docs/profitability-live-design.md:232-241`

117. **Profitability offline queue:** Use an isolated versioned queue, FIFO replay, guarded persistence, stable IDs, optimistic overlays, transport-versus-blocked classification, and aggregated sync status. `docs/profitability-live-design.md:245-293`

118. **V1 derived calculations:** Client-side calculations remain the source of truth for matrix cells, breakevens, bushels-to-cover, and arrangement comparison until the flex formula contract is resolved. `docs/profitability-live-design.md:315-355`

119. **Flex formula contradiction:** Fields currently defines flex as `{type, trigger, bonus_rate}`, while the drafted profitability view expects `{basis, trigger, rate_pct, cap_per_acre?}`. The current live design preserves the Fields shape and computes client-side; the server-view shape must not be silently substituted. `docs/foundation-design.md:51`; `docs/profitability-live-design.md:337-352`; `docs/schema-module4.md:33-36`

120. **Banker report:** Profitability views promise a clean Crop RX-branded PDF with farm name, KPIs, cost tables, total bars, field-level economics, and the ℞ footer mark. `docs/farm-rx-handoff.md:247-251`; `docs/design/01-brand.md:70-76`

121. **Named plan comparison:** V1 supports several named budgets for the same crop-year/commodity, arrangement columns, expected profit per acre, winner badges, price cushions, and yield cushions. `docs/profitability-upgrade-spec.md:24-37`

122. **Input ROI Analyzer:** Compare two plans by cost difference, extra bushels needed to break even across a price ladder, crop-specific verdict tiers, and an editable what-if bushel gain/loss. `docs/profitability-upgrade-spec.md:39-46`

123. **Progressive cost depth:** Simple cash-cost mode is default; advanced mode reveals machinery, interest, labor, family living, management, and owned-land opportunity cost. `docs/profitability-upgrade-spec.md:12-18,48-62`

124. **University defaults:** Farmdoc regional defaults are versioned static data; every default shows a “university default” badge until overwritten, then “your number.” `docs/profitability-upgrade-spec.md:48-59`

125. **Coach and dual breakevens:** A dismissible “What am I forgetting?” coach nudges missing major costs; show both non-land and total-cost breakevens, with government payments separate from breakeven math. `docs/profitability-upgrade-spec.md:57-61`

126. **Cost of carry:** See item 88; it is explicitly approved as a Grain profitability upgrade and remains frontend-only in its specified chunk. `docs/profitability-grand-plan.md:71-82`

127. **Profitability Overview:** Per-crop cards show profit/ac, cost/ac, breakeven, top cost categories, acres/yield/price, and a View budget action; whole-farm totals must guard against duplicate field allocations. `docs/profitability-grand-plan.md:124-129`

128. **Landlord report:** A print report must show field plantings, inputs applied, yields, and crop-share expense settlement using arrangement percentages, with a page per landlord when requested. `docs/profitability-grand-plan.md:131-134,240-263`

129. **Upgrade timing contradiction:** The locked upgrade spec labels banker/landlord PDFs and insurance floor as explicitly out of V1, while the later grand plan and goal describe them as shipped or queued. Treat the locked spec as the earlier post-ship scope and the grand plan as the later phase-2 contract. `docs/profitability-upgrade-spec.md:63-77`; `docs/profitability-grand-plan.md:10-30,116-134`

## 8. Equipment and Tasks

130. **Equipment records:** Store name, category, make/model/year, serial/VIN, purchase date/price, meter unit, warranty dates/notes, status, and notes. `docs/equipment-tasks-design.md:48-67`

131. **Meter readings:** Meter history is append-only; readings may move backward because meters can be replaced; corrections add a newer reading rather than enforcing monotonicity. `docs/equipment-tasks-design.md:69-80`

132. **Service intervals:** Support meter-based and/or month-based intervals; due status is computed, not stored; never-serviced intervals become due only when the relevant threshold is crossed. `docs/equipment-tasks-design.md:82-100`

133. **Service due view:** A security-invoker due view is authoritative for due reason and overdue amount; generation must avoid duplicate open auto-tasks in the same cycle. `docs/equipment-tasks-design.md:90-100,140-156`

134. **Service log:** Record service date, work, parts, vendor, cost, optional meter reading, and optional completed interval; logging an interval updates its last-done state; cost per machine is the sum of service costs. `docs/equipment-tasks-design.md:101-115`

135. **Task board:** Support To Do, Doing, Done; title, details, priority, assignee, due date, field/machine links, and server-stamped completion. `docs/equipment-tasks-design.md:117-138`

136. **Task links:** A task may link to a field, a machine, both, or neither. `docs/equipment-tasks-design.md:124-138`

137. **Auto-generated service tasks:** Generate one idempotent task per due interval/cycle, with deterministic cycle keys, high priority, and machine/interval linkage. `docs/equipment-tasks-design.md:140-156`

138. **Roles:** Owners/managers manage equipment and intervals and may delete; any active member may add readings, service logs, and tasks; workers may move tasks and log service. `docs/equipment-tasks-design.md:36-46`

139. **Equipment UI:** Machine cards show category, meter, status, warranty chip, service-due chip, and cost-to-date; detail supports editing, readings, intervals, service log, and linked service tasks. `docs/equipment-tasks-design.md:193-202`

140. **Tasks UI:** KPI filters are Open, Mine, Overdue, Done this week; phone layout stacks columns; overdue colors escalate amber under three days, red at three days, and critical at seven days; completed cards show who/when. `docs/equipment-tasks-design.md:203-217`

141. **Deliberate omissions:** No tags, comments, mentions, attachments, realtime, RRULE scheduling, email reminders, equipment documents/photos, or DOT compliance in V1. `docs/equipment-tasks-design.md:9-34`

## 9. Weather and spray windows

142. **Forecast source:** Use Open-Meteo without an API key for current, hourly, daily, and seven-day field-level forecasts. `docs/weather-spray-design.md:1-17,47-71`

143. **Field location:** Store nullable latitude, longitude, and `location_source` (`gps` or `manual`); latitude and longitude must be both null or both set. `docs/weather-spray-design.md:19-25`

144. **Location entry:** Primary action is “Use my current location”; manual latitude/longitude is the fallback; no map picker or county geocoding in V1. `docs/weather-spray-design.md:27-31`

145. **Location RPC:** Use a dedicated idempotent last-write-wins RPC, permit owner/manager/worker writes, reject read-only and representative writes, verify field/farm ownership, and support offline replay. `docs/weather-spray-design.md:33-45,122-128`

146. **Forecast cache:** Cache successful payloads by rounded coordinates; serve cache under 30 minutes, and on failure/offline show timestamp, staleness, and reconnection wording rather than blank or fabricated data. `docs/weather-spray-design.md:68-71`

147. **Spray light:** Every field shows a green/yellow/red “Can I spray right now?” light with a plain reason. `docs/weather-spray-design.md:8-17`

148. **Spray rules:** Calm under 3 mph is caution and may become poor at night; 3–10 mph is good; 10–15 mph is caution; over 15 mph is poor; near-term rain and temperatures over 85°F add caution/poor states. `docs/weather-spray-design.md:73-92`

149. **Inversion honesty:** Possible inversions are estimated from calm conditions near nighttime/sunrise and must be described as possible, never certain. `docs/weather-spray-design.md:89-92`

150. **Best window:** Scan remaining daylight, show the longest good run, and say “No good window today” when none exists. `docs/weather-spray-design.md:94-97`

151. **Weather page:** `/weather` shows field cards, location prompts, current conditions, spray light, best window, 12-hour strip, seven-day row, refresh, and “as of”/offline text. `docs/weather-spray-design.md:99-109`

152. **Product refinement:** If catalog environmental label limits exist, optionally tighten verdicts against them; otherwise omit the picker and retain product-agnostic guidance. `docs/weather-spray-design.md:111-120`

153. **Inventory weather tie-in:** “Use current weather” may fill wind speed, direction, and temperature on the spray form but must not alter application validation or persistence semantics. `docs/weather-spray-design.md:130-134`

154. **Weather scope guards:** No radar, county geocoding, map picker, historical weather page, forecast database storage, weather edge function, or push/email alerts inside the weather feature. `docs/weather-spray-design.md:152-157`

155. **Weather contradiction:** The original handoff lists weather/spray alerts as out of scope, but the later goal explicitly overrides that decision and makes Weather + Spray Windows a customer-value feature. `docs/farm-rx-handoff.md:407-421`; `docs/GOAL.md:202-228`

## 10. Rain gauge, field log, GDD, scouting, and harvest

156. **Rain gauge:** Per field, enter rainfall in inches, show calendar-year season total, and show a reverse-chronological timeline. `docs/rain-fieldlog-design.md:7-16,64-73`

157. **Field log:** The same timeline supports dated notes with optional category, edit/delete for editors, and read-only viewing for read-only members. `docs/rain-fieldlog-design.md:7-16,64-71`

158. **GDD:** Calculate growing-degree-days from planting date using historical Open-Meteo highs/lows and base 50°F for corn/soybeans; hide with a prompt if location or planting date is missing. `docs/rain-fieldlog-design.md:13-16,56-63`

159. **Field-log data rules:** Rainfall entries require valid nonnegative amounts and notes require non-empty text; future dates, oversized notes, and rainfall/note type mismatches reject. `docs/rain-fieldlog-design.md:18-46`

160. **Field-log offline behavior:** Use receipt-idempotent writes/deletes, a versioned FIFO queue, canonical echo validation, blocked-versus-transport classification, and sync status. `docs/rain-fieldlog-design.md:41-54`

161. **Scouting notes:** Support weed, disease, insect, and other categories; short notes; GPS location; phone photos; field timeline; and optional linked follow-up tasks. `docs/scouting-design.md:7-13`

162. **Scouting note rule:** A note requires either non-empty text or at least one photo; GPS coordinates are both-set-or-both-null. `docs/scouting-design.md:15-39`

163. **Private photos:** Photos belong in a private farm-scoped Storage bucket with signed URLs, farm-first paths, image MIME/size controls, and no public access. `docs/scouting-design.md:22-51`

164. **Photo offline rule:** Text-only/GPS scouting notes may queue offline; photo notes require connectivity for upload and must state “photos need a connection.” `docs/scouting-design.md:54-61`

165. **Scouting UI:** `/scouting` provides category chips, note input, location action, photo picker, follow-up-task checkbox, signed thumbnails, enlargement, timeline, and role-gated edit/delete. `docs/scouting-design.md:63-69`

166. **Scouting exclusions:** No AI identification, photo annotation, drawing, video, or public sharing. `docs/scouting-design.md:80-83`

167. **Harvest entry:** Per field/crop, enter actual bushels, harvest date, and optional actual price; show actual yield/ac, delta versus expected, and actual revenue. `docs/harvest-design.md:6-13`

168. **Harvest data rule:** Actual price is separate from expected price and falls back to expected when absent; harvest writes update only harvest columns and never planting, acres, or expected values. `docs/harvest-design.md:15-32`

169. **Harvest UI:** `/harvest` shows current-year crop rows, planted acres, expected yield, Enter harvest action, actual results, yield history, year selector, and read-only role gating. `docs/harvest-design.md:34-43`

170. **Harvest exclusions:** No scale-ticket capture, load-by-load tracking, moisture/shrink adjustment, grain-cart integration, or expected-value overwrite. `docs/harvest-design.md:45-56`

## 11. Notifications and phone push

171. **Notification center:** Provide a bell, unread badge, `/notifications` list, category chips, tap-through links, mark-read, and mark-all-read behavior. `docs/reminders-design.md:7-12,60-72`

172. **Notification privacy:** Each user reads and updates only their own notifications; dedupe keys prevent repeated logical alerts. `docs/reminders-design.md:14-37`

173. **Notification sources:** Service due, assigned/overdue tasks, spray windows becoming good, scouting follow-ups, and optionally rain/harvest confirmations. `docs/reminders-design.md:60-72`

174. **Phone push:** Opt-in phone push is best-effort and requires a secure HTTPS context; service-worker push opens the linked app route. `docs/reminders-design.md:39-58`

175. **Push subscription rules:** Users manage only their own endpoint/subscription rows; private VAPID material remains an edge-function secret. `docs/reminders-design.md:25-58`

176. **Closed-app limitation:** Scheduled pushes while the app is fully closed require a later scheduler; V1 supports server-side and client-triggered events when the relevant actor is online. `docs/reminders-design.md:74-83`

177. **Reminder channel contradiction:** Feature E explicitly excludes email and SMS, while Grain marketing alerts separately promise email. These are separate contracts: operational reminders are in-app/phone-push only; marketing-alert rules may email configured recipients. `docs/reminders-design.md:1-5,74-83`; `docs/profitability-grand-plan.md:18-23,99-104`

## 12. Programs and planned application workflows

178. **Program purpose:** Let farmers define reusable Pre, Post, Fungicide, planter-fertility, or custom recipes, assign them to exact crop rows, and track passes through the season. `docs/programs-design.md:7-25`

179. **Assignment identity:** Programs assign to `crop_assignment_id`, never only to a field, preserving wheat/double-crop independence. `docs/programs-design.md:15-25`

180. **Program scope:** Templates may be general, commodity-scoped, year-scoped, or both; assignment must enforce non-null scope. `docs/programs-design.md:27-36`

181. **Multiple active programs:** Multiple distinct programs may be active on one crop; the same program cannot be assigned twice; no more than 12 active programs may exist per crop assignment. `docs/programs-design.md:38-42`

182. **Program categories:** Optional category is chemical, fertility, fungicide, or other; program name remains primary identity, and there are no sub-field soil zones or VRT maps. `docs/programs-design.md:44-48`

183. **Free-type products:** Product names, rates, and units are farmer-entered text; no catalog lookup or fuzzy matching in V1; catalog linkage is reserved but unused. `docs/programs-design.md:50-52`

184. **Materialized snapshots:** Assignment creates durable field-specific pass/product snapshots; template edits cannot rewrite applied history. `docs/programs-design.md:13-25,218-233`

185. **Pass scheduling:** Passes may use a target date, planting offset, manual date, or no date; target date and planting offset are mutually exclusive; no automatic growth-stage date inference. `docs/programs-design.md:88-109,165-172`

186. **Applied reality:** Applying a pass may create no inventory record, link an existing same-farm application, or create a linked draft application. A product-less draft remains unposted and does not affect inventory. `docs/programs-design.md:54-64`

187. **Program application safeguards:** Never create fake catalog rows, decrement inventory from free text, or complete a product-less application. `docs/programs-design.md:56-64`

188. **Template editing:** Template changes affect future assignments unless the farmer explicitly refreshes an assigned field; refresh preserves terminal and field-overridden passes, updates only eligible planned snapshots, and archives removed planned passes rather than deleting them. `docs/programs-design.md:218-233`

189. **Program actions:** Support save/edit/archive templates, pass save/reorder/archive, assign, refresh, reschedule, apply, skip, unassign, reassign, and due-item generation. `docs/programs-design.md:261-340`

190. **Program task generation:** Due planned passes create one linked Program task and one deduped notification; task titles and notification bodies include program name, pass, field, and date. `docs/programs-design.md:321-340`

191. **Task-state separation:** Completing a task does not mark a pass Applied; the tracker must say the task was closed while the pass remains planned. `docs/programs-design.md:342-348`

192. **Weather integration:** Planned spray passes reuse the existing weather light and stale/offline wording; missing weather never blocks assignment, reschedule, or Apply. `docs/programs-design.md:350-356`

193. **Program costs:** Planned cost is complete only when every active planned line is priced; actual cost is complete only when every applied actual line is priced; missing costs never become zero. `docs/programs-design.md:364-374`

194. **Program cost rollups:** Show each program separately first; optional crop/category totals must identify included programs, preserve incomplete status, and state that totals cover the whole field rather than mapped sub-field acres. `docs/programs-design.md:364-374`

195. **Programs UI:** `/programs` contains My programs, Assign to fields, and Season progress; use large ordered cards and Move up/down controls instead of drag-and-drop; display field, crop, year, and planting sequence in choices. `docs/programs-design.md:429-443`

196. **Program role and mobile rules:** Read-only users can view but not mutate; actions target one exact assignment/pass; mobile uses stacked/collapsible tracks, 18px text, 48px targets, tabular numbers, plain English, and two-tap common actions. `docs/programs-design.md:429-443`

197. **Program exclusions:** No inventory picker, auto-match, label-rate validation, quantity conversion, inventory deduction, CRX order ingestion, scheduled-delivery UI, auto-apply, growth-stage prediction, or sub-field zones in V1. `docs/programs-design.md:506-513`

198. **Future CRX delivery seam:** Expected orders appear as scheduled draft receipts, departures transition only shipped quantities to received/on-hand, and reconciliation requires explicit farm/product confirmation rather than free-text matching. `docs/programs-design.md:376-388`

## 13. Machine data import and future agronomy feeds

199. **Machine-data goal:** Support planting and harvest data from Climate FieldView, John Deere Operations Center, and AgFiniti. `docs/farm-rx-handoff.md:286-295`

200. **Machine-data outputs:** Imported data may feed actual harvested bushels, seed variety, planting dates/GDD, and as-applied spray records. `docs/farm-rx-handoff.md:286-295`

201. **V1 import path:** Start with farmer-uploaded shapefile/CSV files; do not build three separate OAuth integrations. `docs/farm-rx-handoff.md:296-306`

202. **Later live sync:** Add Leaf middleware later for normalized Plant/Apply/Harvest operations, verifying AgFiniti support before relying on it. `docs/farm-rx-handoff.md:296-306`

203. **Variety history:** Track hybrid/variety by field, link variety to field and yield, and preserve multi-year performance history. `docs/farm-rx-handoff.md:308-311`

204. **GDD/crop staging roadmap:** Accumulate GDD from planting date, predict V/R stages, and support timing decisions; the handoff originally names NWS, while the newer Feature B contract uses Open-Meteo archive data. `docs/farm-rx-handoff.md:313-317`; `docs/rain-fieldlog-design.md:56-63`

## 14. Ship and governance contracts

205. **Customer onboarding:** Provision the customer out of band, deliver the starting password by phone/text rather than email, have the farmer sign in, name the farm/entity, and verify they reach Fields with their farm name. `docs/onboarding-design.md:212-243`; `docs/ship-checklist.md:33-39`

206. **Public sign-up:** The intended customer model disables public signups; customer accounts come through the provisioning path. `docs/onboarding-design.md:98-103,246-259`; `docs/ship-checklist.md:11-16`

207. **Pre-ship checks:** Pick customers, verify email domain if email alerts are needed, optionally configure SMTP and phone push, consider Supabase Pro, and perform a real-device sunlight/gloves PWA pass. `docs/ship-checklist.md:18-31`

208. **Customer cleanup:** Test data may remain only by explicit decision; deleting test data is a separate destructive action. `docs/ship-checklist.md:41-44`

209. **Production safety:** Database migrations, production deployment, and outward-facing changes require explicit owner approval in the design documents. `docs/GOAL.md:14-22,446-452`; `docs/profitability-grand-plan.md:3-6,57-69`

210. **No silent mock fallback:** Live repositories must not import mock envelopes, seed fake data, or turn a live failure into a fake success. `docs/foundation-design.md:337-382`; `docs/grain-live-design.md:13-25`; `docs/inventory-live-design.md:67-75`; `docs/profitability-live-design.md:60-68`

211. **Verification standard:** Completion requires typecheck, build, regression coverage, real browser rendering, role/RLS checks, offline checks, and canonical database confirmation appropriate to the module. `docs/foundation-design.md:483-523`; `docs/grain-live-design.md:173-207`; `docs/inventory-live-design.md:512-625`; `docs/profitability-live-design.md:461-516`

## 15. Consolidated contradictions and precedence notes

212. **18px versus 16px:** The explicit house rule for this inventory is 18px minimum. The brand file’s “nothing smaller than 16px” allowance is inconsistent and should not weaken the stricter rule. `docs/design/01-brand.md:49-58`; `docs/design/02-experience-principles.md:6-14`

213. **Weather alerts:** The original handoff cuts weather/spray alerts, but the dated GOAL explicitly overrides that decision and the Weather design defines the feature. `docs/farm-rx-handoff.md:407-421`; `docs/GOAL.md:202-228`

214. **Email channels:** Feature E reminders prohibit email/SMS, while Grain marketing alerts support email. The correct interpretation is channel separation, not a global email prohibition. `docs/reminders-design.md:1-5,74-83`; `docs/profitability-grand-plan.md:18-23,99-104`

215. **Alert recipients:** Earlier Grain design says owner-only email; later phase-2 schema allows up to three addresses and explicitly approves a second recipient. The phase-2 rule supersedes the earlier V1 limitation for marketing alerts. `docs/grain-live-design.md:159-171`; `docs/schema-phase2-grain-marketing.md:5-19`

216. **Profitability upgrade timing:** The locked upgrade spec defers banker/landlord reports and insurance-floor work, while the later grand plan defines those as later completed chunks. This is a temporal roadmap change, not a single simultaneous V1 contract. `docs/profitability-upgrade-spec.md:1-6,63-77`; `docs/profitability-grand-plan.md:10-30,116-134`

217. **Flex-rent formula:** Fields’ stored formula and Profitability’s drafted server-view formula differ. V1 must preserve the Fields shape and avoid server-view calculations until the owner-approved formula is settled. `docs/foundation-design.md:51`; `docs/profitability-live-design.md:337-352`; `docs/schema-module4.md:33-36`

218. **Bin source of truth:** The phase-2 schema initially describes `bin_inventory` as the displayed source until ledger cutover, while the later bin-upgrade contract derives on-hand from inventory plus ledger movements. `docs/schema-phase2-grain-marketing.md:35-41`; `docs/profitability-grand-plan.md:192-208`

219. **Schema status language:** Several schema documents call migrations drafts/not applied, while the dated GOAL and grand-plan ledger describe later migrations as applied. This inventory records both contract versions and does not treat either status statement as implementation proof. `docs/schema-fields-support.md:1-4,43-47`; `docs/schema-module2.md:1-3`; `docs/schema-module4.md:1-3`; `docs/schema-phase2-grain-marketing.md:1-3`; `docs/GOAL.md:24-28,85-98,145-171`; `docs/profitability-grand-plan.md:139-152`

220. **Inventory planner scope:** The handoff promises a chemical-needed planner and nutrient-removal calculator, but the Module 3 schema explicitly excludes their coefficient/planner tables from the current migration. They remain roadmap contracts requiring later design work. `docs/farm-rx-handoff.md:199-209`; `docs/schema-module3.md:54-64`

221. **GDD weather source:** The original machine-import roadmap names NWS, while the newer customer-value field-log feature specifies Open-Meteo archive data. The newer Feature B design is the more specific current contract. `docs/farm-rx-handoff.md:313-317`; `docs/rain-fieldlog-design.md:56-63`

