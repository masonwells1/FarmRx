# 04 — Page Patterns

## App shell

- **Sidebar (desktop):** 262px, `CHROME_GREEN`. Farm identity top, nav middle,
  "Powered by Crop RX" pinned bottom. Active nav item = solid `CRX_GREEN` pill.
- **Phone:** bottom tab bar with the 4-5 most-used modules + "More". Same 48px targets.
- **Topbar:** white, 72px, page context left, sync status + alert bell right.
- **Content area:** max-width 1320px, 32px padding (16-20px on phone).

## Dashboard ("Am I okay today?")

Order, top to bottom:
1. Greeting + date + weather one-liner (plain words).
2. Anything red or amber (alerts) — only if there is one.
3. Three stat boxes: the numbers the farmer checks daily.
4. Today's work (tasks due, passes due).
5. Grain snapshot (sold vs open, today's bid move).

If nothing is wrong, the dashboard should feel like a calm "all clear."

## List pages (Fields, Contracts, Inventory)

1. Page heading: title + one-line summary ("14 fields · 2,240 acres") + ONE primary action.
2. Filter bar only when the list can exceed ~10 rows.
3. Table (desktop) / cards (phone) with zebra striping.
4. `CRX_GREEN` total bar pinned to the bottom of the table when a sum is meaningful.

## Detail pages (one field, one contract)

1. Back link + title + secondary actions.
2. Info grid: 2-column label/value cells with hairline dividers.
3. History/related records below, newest first.
4. Max content width 900px — detail pages read, they don't sprawl.

## Forms (add/edit)

1. One column on phone, max two on desktop.
2. Group related inputs in bordered fieldsets with a green legend.
3. Submit button bottom-left, sticky on long phone forms.
4. Save feedback is explicit: "Saved" in green next to the button, then navigate.

## Login (the full-brand moment)

- `CHROME_GREEN` panel, large ℞ mark, "Farm Rx" with green Rx, slogan, "by Crop RX Solutions."
- White login card, oversized inputs (52px+).
- This is the only screen where Crop RX is the star. See 01-brand.md.

## Print / PDF (banker report)

- White, black text, brand tokens for the total bars and section headers only.
- ℞ watermark bottom-right, small. The farmer's name is bigger than ours.
