# Farm Rx — Design Brief (for every UI task)

Read `docs/farm-rx-handoff.md` Part 5 and open `docs/rx-one-brand-mockup.html` before building UI.
The mockup is the visual reference (it says "Rx One"; the name is now **Farm Rx**).

## Design read (fixed — do not re-infer)
Product UI / dashboard for a 55-year-old farmer on a phone in sunlight, possibly wearing gloves.
Trust-first, calm, legible. NOT a landing page, NOT Awwwards, NOT experimental.
Dials: VARIANCE 4 / MOTION 2 / DENSITY 4. The login screen may push VARIANCE 6 (it is the one
full-brand moment).

## Hard rules (from the owner's print standards — non-negotiable)
- Tokens verbatim, as CSS variables:
  CRX_GREEN #28A26A · DEEP_GREEN #218A5C · CHARCOAL #2E2E2E · MATTE_GRAY #4E4E4E ·
  LIGHT_GREEN #E8F5EE · PREMIX_BG #F5F5F5 · WARN_RED #C62828 · WARN_BG #FFF3E0 ·
  CHROME_GREEN #17513A (sidebar/large surfaces) · AMBER #E8A33D (heads-up state) ·
  HAIRLINE #E3E6E4 (borders)
- **Inter** for body and ALL numbers with `font-variant-numeric: tabular-nums`. (This overrides
  any skill that bans Inter.) Helvetica-style face for headings/logo lockup.
- Base font **18px**. Tap targets **≥48px**. Card radius **16px**.
- Red = genuinely wrong (overdue, below breakeven). Amber = heads-up. Never make everything
  non-green red or farmers tune it out.
- Co-branding: farm's own logo (or farm name in bold) TOP-LEFT of sidebar; "Powered by Crop RX"
  mark pinned to sidebar BOTTOM. Login screen is the one full-CRX-brand moment (℞ mark, green,
  slogan "INNOVATIVE SOLUTIONS. UNMATCHED RESULTS.", "by Crop RX Solutions").
- Nav items exactly: Fields · Grain · Inventory · Profitability · Equipment · Tasks.
  No medical metaphors anywhere in the UI.

## Taste rules (distilled from taste-skill — apply everywhere)
- No AI-slop defaults: no purple gradients, no glassmorphism-on-everything, no centered-hero-over-
  dark-mesh, no three-equal-feature-cards, no meta labels ("SECTION 01"), no emoji in UI.
- One palette (the tokens above). No pure #000 / #fff — use CHARCOAL and off-white PREMIX_BG.
- Spacing rhythm: consistent scale (4/8/12/16/24/32/48); sections breathe; never cramped.
- WCAG AA contrast on EVERYTHING, especially form inputs, placeholders, focus rings, error text.
  Audit every form. (Sunlight legibility is a product requirement, not a nicety.)
- Motion: subtle and purposeful only — 150–250ms ease-out on hover/press/expand. No scroll-jacking,
  no parallax, no infinite loops. A farmer's data page is not a showreel.
- Numbers are the product: right-align numeric columns, tabular-nums, thousands separators,
  consistent decimal places, units always shown (bu, $/bu, ac, $/ac).
- Tables: zebra stripe with PREMIX_BG, DEEP_GREEN section headers, CRX_GREEN total bars —
  this mirrors the tank labels customers already know.
- Empty states: every screen must look intentional with zero data (friendly one-liner + primary
  action, never a blank table).
- Mobile-first: design at 375px wide first, enhance upward. Bottom tab bar on mobile,
  sidebar on desktop.
