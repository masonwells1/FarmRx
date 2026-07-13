# 02 — Experience Principles

The user is a 55-year-old farmer, on a phone, in direct sunlight, possibly wearing gloves.
Every rule below exists because of that sentence.

## The non-negotiables (hard rules, already enforced in CSS)

1. **18px base font.** Nothing load-bearing under 16px.
2. **48px minimum tap targets** on every button, input, link, and row action.
3. **`tabular-nums` on every number.** Bushels and dollars must line up in columns.
4. **Two-tap rule.** Any everyday action (log rain, enter a load, check a bid) is reachable
   in two taps from the dashboard.
5. **Plain English.** "Fields", "Grain", "What you owe" — never "Entities", "Positions",
   "Liabilities." If a term wouldn't be said at a kitchen table, rewrite it.

## Sunlight contrast

- Body text is `CHARCOAL` on white or `PREMIX_BG` — never gray-on-gray.
- Secondary text (`MATTE_GRAY #4E4E4E`) passes WCAG AA at 18px; do not go lighter.
- Never place text over photos or gradients without a solid scrim.
- Status must never be color-only: pair red/amber/green with a word ("Overdue", "Heads up", "Sold").

## Hierarchy: one hero per screen

Each screen answers one question first:
- Dashboard → "Am I okay today?"
- Grain → "What's sold, what's open, what's it worth?"
- Fields → "What's planted where?"

The answer to that question is the biggest thing on the screen. Everything else supports it.
If two elements compete for "biggest," one of them is wrong.

## Calm by default, loud when it matters

- The resting state of every page is quiet: neutral surfaces, green used sparingly.
- Alerts earn attention through CONTRAST WITH the calm, not through volume. This is why
  we don't paint every card header green — it spends the brand color before an alert needs it.
- Maximum one red element visible per screen in the normal case. If everything shouts,
  the one overdue contract whispers.

## Motion

- Minimal and functional: 150 to 200ms ease-out on hover/press, nothing decorative.
- `:active` press feedback on all buttons (1px translate or 0.98 scale) — with gloves,
  visible confirmation that a tap registered matters.
- Honor `prefers-reduced-motion`.

## Empty, loading, and error states

- **Empty states teach:** show what the page will look like and one button to add the first
  record. Never a blank void.
- **Loading:** skeletons in the shape of the final layout, not spinners.
- **Errors:** plain-English sentence + what to do next, inline next to the thing that failed.

## Trust cues (Rule 2 made visible)

- The privacy/share state ("Only you can see this" / "Shared with your Crop RX rep") is
  shown in plain words on Grain and financial screens, not buried in settings.
- Sync status is always one glance away and worded plainly ("Saved", "Saving…",
  "Offline — will save when you're back in coverage").
