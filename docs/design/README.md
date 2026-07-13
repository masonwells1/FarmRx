# Farm Rx Design Guidelines

This folder is the source of truth for how Farm Rx looks and feels. It sits UNDER the
handoff (`docs/farm-rx-handoff.md` Part 5) — if anything here conflicts with the handoff,
the handoff wins.

## What's in here

| File | What it covers |
|---|---|
| [01-brand.md](01-brand.md) | Colors, type, logo, co-branding lockup, where Crop RX branding appears |
| [02-experience-principles.md](02-experience-principles.md) | The farmer-first rules: sunlight, gloves, phone, plain English |
| [03-components.md](03-components.md) | Buttons, cards, stat boxes, tables, forms, alerts — how each is styled |
| [04-page-patterns.md](04-page-patterns.md) | How whole pages are laid out: dashboard, list pages, detail pages, forms |
| [examples/](examples/) | Three clickable visual directions (open in any browser) |

## The three example directions (pick one)

All three use the exact same brand tokens and the exact same dashboard content —
only the styling differs:

1. **Option A — Tank Label Classic** (`examples/option-a-tank-label.html`)
   The current look, refined. Keeps the green header bars and zebra tables customers
   know from the tank labels, but fixes spacing, hierarchy, and polish.

2. **Option B — Modern Farmstead** (`examples/option-b-modern-farmstead.html`)
   A cleaner, airier, premium-software feel. Green becomes an accent instead of a
   paint bucket. White cards, big calm numbers, softer headers.

3. **Option C — Heritage Co-op** (`examples/option-c-heritage-coop.html`)
   Warmer and bolder. Paper-toned background, chunky type, strong field-sign blocks.
   The most character of the three.

## Decision log

- **2026-07-12:** Guidelines folder created; three directions presented to Mason.
- **Chosen direction:** _pending Mason's pick_ ← update this line when decided, then
  restyle the app to match and fold the winning option's specifics into 03/04.
