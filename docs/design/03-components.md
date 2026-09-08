# 03 — Components

How each building block is styled. Where the three example directions differ, the
winning option's spec replaces the "direction-dependent" notes after Mason picks.

## Buttons

| Kind | Style | Use |
|---|---|---|
| Primary | Solid `CRX_GREEN`, white text, bold, radius 9-10px, 52px tall | The one main action per screen ("+ Add field") |
| Secondary | 2px `DEEP_GREEN` border, green text on white | Supporting actions ("Edit", "Export") |
| Text action | Underlined `DEEP_GREEN`, bold | Inline, low-stakes ("Mark read") |
| Danger | `WARN_RED` text, never solid red fill unless confirming a delete | Destructive |

- One primary button per screen region. Two solid green buttons side by side is a bug.
- Labels are verbs, max 3 words, never wrap.
- All buttons: visible `:active` press feedback, 3px amber focus ring.

## Stat boxes (KPI cards)

The signature tank-label element. Label on top, huge number, unit below.
- **Final spec (Modern Farmstead):** white card, 1px hairline border, a **6px colored top
  border** (rotating `CRX_GREEN` / `AMBER` / `DEEP_GREEN` across a row — the Heritage accent
  Mason picked), quiet uppercase gray label, left-aligned.
- Number: Barlow Semi Condensed, bold, 42px, `tabular-nums`, charcoal.
- A stat box may carry ONE state color (red/amber number) when the number itself is the alarm.

## Cards

- Radius 16px (`--radius`), 1px `HAIRLINE` border, white surface on the cream page.
- Shadows: CRX Manager's soft pair (`--shadow-card` resting, `--shadow-card-hover`).
- **Card headers (final):** plain charcoal text (21px, weight 600) with a hairline
  border-bottom. The old full-width green header bars are retired; green bars now appear
  ONLY on the table total bar.
- Don't nest cards inside cards. Group inner content with hairlines and spacing.

## Tables

- Zebra striping with `PREMIX_BG`, header row in uppercase `MATTE_GRAY` small-bold.
- Numeric columns right-aligned, `tabular-nums`, so magnitude is scannable.
- **Total bar:** solid `CRX_GREEN` footer bar with white bold text — the tank-label totals
  row. This is a keeper in ALL directions; it's the most recognized brand element.
- Row height ≥ 56px; whole row tappable when it navigates.
- On phones, tables collapse to cards (label/value pairs), never horizontal-scroll-only.

## Forms

- Label ABOVE input, bold gray, plain sentence-case in B/C (uppercase allowed in A).
- Inputs: 2px `HAIRLINE` border, radius 9px, ≥48px tall, focus border `CRX_GREEN`.
- Helper text under the label in plain English ("The rent you'd pay if it were cash rent").
- Errors: `WARN_RED` text below the input + red border, never placeholder tricks.
- Never use placeholder text as the label.

## Alerts

| Level | Fill | Border/accent | Meaning |
|---|---|---|---|
| Red | `WARN_BG` | `WARN_RED` left bar + bold red title | Money/deadline at risk now |
| Amber | `WARN_BG` | `AMBER` left bar | Heads up, act this week |
| Green | `LIGHT_GREEN` | `CRX_GREEN` left bar | Confirmation, good news |

- Alert copy: first line says what happened; second line says what to do; one button max.

## Dialogs (confirm and prompt)

Farm Rx never uses the browser's `confirm()` or `prompt()`. Every "are you sure?" and every
"give me a reason" goes through `confirmDialog()` / `promptDialog()` in
`src/components/ConfirmDialog.tsx`, rendered by the one `ConfirmDialogHost` at the app root.

| Part | Rule |
|---|---|
| Title | A plain question the farmer would say out loud: "Delete this firm offer?" |
| Body | One or two sentences on what changes and what does not: "Only your record of the offer is removed." |
| Confirm button | Names the action, never "OK" or "Yes": "Delete offer", "Switch farms", "Use harvest total" |
| Cancel button | Default "Go back"; use a specific safe label when it reads better: "Keep it private", "Stay here" |
| Destructive | `destructive: true` gives the confirm a solid `WARN_RED` fill and starts keyboard focus on the safe button |
| Prompt | `promptDialog({ label, required })` adds one text field; a required reason keeps the confirm disabled until typed |
| Phone | Full-width stacked buttons, 52px tall, with the safe button on the bottom nearest the thumb so a stray tap never confirms; Escape and tapping the backdrop cancel |
| Keyboard | Tab and Shift+Tab stay inside the card while it is open |
| Stale questions | Leaving the route, switching or losing the farm, or signing out cancels any open dialog, so a question can never run its action against a record that is no longer on screen |

The host queues requests, so two questions never overlap; the second shows after the first is answered.

## Badges / chips

- Pill radius, 30px min height, bold, tinted fill + dark text of the same hue.
- Used for categories (crop names, program kinds, notification types) — not for decoration.

## Icons

- One family, consistent stroke width. No emoji in the UI shell. Line icons sized 22-24px
  in nav, 20px inline.

## Numbers and money

- Money: `$` + thousands separators, two decimals only where cents matter (bids), whole
  dollars elsewhere.
- Positive money/quantity deltas may be `CRX_GREEN`; negative are `WARN_RED`; both always
  also carry a +/- sign (never color-only).
- Bushels: whole numbers with separators ("48,000 bu").
