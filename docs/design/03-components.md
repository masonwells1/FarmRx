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
- Number: Helvetica face, bold, 34 to 44px, `tabular-nums`.
- Direction-dependent: A uses the solid `DEEP_GREEN` label bar; B uses a quiet uppercase
  gray label on a white card; C uses a heavy top border and charcoal label.
- A stat box may carry ONE state color (red/amber number) when the number itself is the alarm.

## Cards

- Radius 16px (`--radius`), 1px `HAIRLINE` border.
- Shadows are tinted green, never gray/black: `0 3px 10px rgb(23 81 58 / 6%)` scale.
- Card headers: direction-dependent (A: green bar; B: plain bold text + hairline; C: block header).
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
