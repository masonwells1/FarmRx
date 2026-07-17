Model: GPT-5 (Codex), assigned Terra worker. Reasoning effort: Medium.

## 1. Current farmer journey

1. Sign in at `/login`.
2. Access gate either:
   - creates the initial farm (farm name, operating name, entity type),
   - asks the user to choose a farm, or
   - opens the existing farm.
3. The app currently sends the farmer to `/fields`, not a daily home.
4. On phone, primary navigation is Fields, Grain, Tasks, Weather, and More; More exposes the remaining eight destinations.
5. The first useful current action is adding a field. That is correct for a new farm, but wrong as the default daily landing point once setup is complete.

Recommendation: make `/today` the post-sign-in and default-route destination; keep Fields as the first setup task.

## 2. Today hierarchy and Quick Record

Today must answer “Am I okay today?” in this order:

1. Greeting, date, selected farm, one-line weather/spray condition.
2. One urgent alert only, if a money, deadline, or safety issue exists.
3. Three daily stat boxes:
   - Work due today
   - Grain priced / still open
   - Weather or spray window
4. Today’s work: due tasks and planned passes.
5. Grain snapshot: plain-language priced/open position and bid movement.
6. First-week setup checklist only while the farm is incomplete.
7. Quiet “all clear” state if nothing needs action.

Quick Record should have no more than these six destinations, each opening an existing workflow:

1. Add rain → Field Log, rain entry.
2. Add field note → Field Log, note entry.
3. New scouting note → Scouting form.
4. Log spray → Inventory, Spray record tab.
5. Enter harvest → Harvest field/crop entry.
6. Add task → Tasks form.

Do not put “receive product,” contracts, programs, or machinery in Quick Record. They matter, but are not the most common in-the-field, gloved-phone records.

## 3. First-week setup and canonical completion

| Step | Completion signal from canonical data |
|---|---|
| Name the farm | Active farm exists and `selectedFarmId` is set |
| Add first field | At least one canonical field exists |
| Add crop to the field | At least one crop assignment exists for the current crop year |
| Set field location | At least one active field has saved latitude and longitude |
| Set grain expectation | Current-year crop assignment has expected yield/price, and Grain has a production estimate |
| Add the first task or planned pass | At least one non-complete task or program assignment/pass exists |
| Record a first inventory item, only if useful now | A product plus a receipt/on-hand record exists |

The checklist must derive from these records at render time. Do not add a separate “setup complete” flag that can drift away from the actual farm data.

## 4. Basic / More details priorities

Start progressive disclosure here:

1. Inventory “Receive product” — currently mixes receipt, optional pricing, package conversion, new-product creation, EPA data, seed data, and fertilizer analysis in one form. Basic: product, quantity, unit, date, receive/draft. More details: vendor, price, conversion, and new-product compliance facts.
2. Spray record — required compliance information is legitimate, but the form should begin with field, date, acres, product, rate, and Save. Put weather, applicator/license, time, target pest, multi-product adjustments, and package conversion in More details.
3. Field add/edit — basic first: field name, acres, crop, operating entity. More details: arrangement, legal/FSA details, yield, contacts, and share economics.
4. Program pass editor — basic: pass name/type, timing, and product/rate. More: planting offsets, notes, pricing, and advanced product rows.
5. Grain contract entry — basic: buyer, crop, bushels, price/type, delivery window. More: contract number, basis/futures legs, premium, and settlement details.

Do not start with Harvest, rain, scouting, or task entry. They are already short, field-oriented forms and should stay fast.

## 5. Existing design system to reuse

Reuse:

- `tokens.css` colors, cream background, charcoal navigation, 16px cards, soft shadows.
- Existing `.primary-action`, `.secondary-action`, `.text-action`, stat boxes, cards, alerts, empty states, `SaveReceipt`, `SyncNotice`, and `OfflineDataNotice`.
- Desktop sidebar and phone bottom bar pattern.
- Existing 18px type and 48px minimum control baseline.
- Existing language for recovery:
  - “All changes synced.”
  - “Saved on this device — waiting for signal.”
  - “Nothing was deleted.”
  - “Needs attention.”
- Existing weather, task, notification, grain, and Needs Attention components/data pathways.

Avoid:

- A generic analytics dashboard, tiny KPI grids, or a new color/icon system.
- Multiple green primary buttons in one region.
- Green header bars on every card; the chosen Modern Farmstead style uses plain card headers and reserves green for meaning.
- Horizontal-scroll-only phone tables.
- Medical wording in navigation.
- Hiding privacy, offline state, or failed-save recovery in settings.
- Mixing Today aggregation with write logic; its first slice should remain read-only.

## 6. Acceptance criteria

Desktop:

- Today opens after sign-in, with farm identity, sync state, and alert bell preserved.
- The first viewport answers “am I okay today?” without scrolling.
- Today uses the existing 1320px content width, sidebar, topbar, card, and stat-box language.
- Daily actions reach their existing forms without duplicating business rules.

390×844 phone:

- Base and load-bearing text are 18px; nothing required to read is below 16px.
- All actionable controls, cards acting as links, and nav targets are at least 48×48px.
- Each Quick Record action is reachable in two taps: Today → Quick Record → destination.
- The first screen has no horizontal overflow and leaves room for the existing bottom navigation.
- Charcoal text remains on white/cream; secondary text remains `#4E4E4E` or darker; status always includes words, not color alone.
- Save state is visible immediately near the action and globally: Saved, saved locally awaiting signal, or Needs attention with Retry/Keep options.
- Offline cached-data warning remains visible when relevant; no saved record implies it has reached the server until sync confirms it.
- Test the actual 390×844 layout plus keyboard focus, reduced motion, weak-signal, stale-session, and recovery paths.

## 7. Bounded implementation sequence

1. Today read model and `/today` route only.
   - Proof: unit/regression tests for empty, alert, and populated states; no writes or new permissions.

2. Today responsive UI and default-route integration.
   - Files likely: `App.tsx`, a new `TodayModule.tsx`, `app.css`.
   - Proof: desktop and 390×844 browser checks; sign-in now lands on Today.

3. Quick Record launcher wired only to existing routes/forms.
   - Proof: each of six paths reaches its existing form in two taps; no duplicate save path.

4. Canonical first-week checklist.
   - Proof: each checkbox flips only after underlying farm data exists; no independent completion persistence.

5. Shared Basic / More details component and one low-risk rollout, beginning with inventory receipt.
   - Proof: basic save, expanded save, validation, queued offline save, and retry all use the existing repository path.

6. Role-shaped navigation using current trusted access data.
   - Proof: owner/manager/worker screens show only permitted actions; direct-route checks remain enforced.

7. Recovery/help improvements.
   - Proof: pending, blocked, retry, revoked-access, and offline-copy messages remain clear and do not weaken authentication.

Before any commit, run the loop’s required typecheck, regression suite, build, audit, foundation script, and focused desktop/phone browser proof.

## 8. Files read and commands run

Read:

- `CLAUDE.md`
- `docs/farm-rx-handoff.md`
- `docs/design/README.md`
- `docs/design/01-brand.md`
- `docs/design/02-experience-principles.md`
- `docs/design/03-components.md`
- `docs/design/04-page-patterns.md`
- `docs/audits/2026-07-16-farmer-simplicity-loop/GOAL-AND-LOOP.md`
- `src/App.tsx`
- `src/styles/tokens.css`
- `src/styles/app.css` (targeted responsive/token/control inspection)
- Shared save, attention, and market components
- Fields, Weather, Equipment/Tasks, Inventory, Grain, Programs, Scouting, Harvest, Notifications, and Field Log modules.

Commands were read-only: `Get-Content`, `Get-ChildItem`, `rg --files`, targeted `rg` searches, and line counts. I also attempted the Product Design saved-context preflight; it could not run because `python` is unavailable on this machine.

No filesystem, git ref, database, service, deployment, or external-system mutation occurred.
