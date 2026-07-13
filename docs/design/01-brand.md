# 01 — Brand

Source: handoff Part 5. These tokens come from Crop RX's print standards (tank labels).
Customers have read this visual language for years. Use them verbatim.

## Color tokens

| Token | Hex | Use for |
|---|---|---|
| `CRX_GREEN` | `#28A26A` | Primary buttons, active nav, positive values, total bars |
| `DEEP_GREEN` | `#218A5C` | Section headers, secondary emphasis, links |
| `CHROME_GREEN` | `#17513A` | Large dark surfaces only (sidebar, login panel) |
| `CHARCOAL` | `#2E2E2E` | Primary text |
| `MATTE_GRAY` | `#4E4E4E` | Labels, secondary text |
| `LIGHT_GREEN` | `#E8F5EE` | KPI/stat card fills, selected-row tint |
| `PREMIX_BG` | `#F5F5F5` | Page background, zebra stripes |
| `WARN_RED` | `#C62828` | Overdue, unpriced, below breakeven. Red = money/deadline problem, nothing else |
| `WARN_BG` | `#FFF3E0` | Alert card fill |
| `AMBER` | `#E8A33D` | "Heads up" state. If everything non-green is red, farmers tune red out |
| `HAIRLINE` | `#E3E6E4` | Borders, dividers |

Rules:
- **One green family, used with restraint.** Green means "brand / good / active." If a whole
  screen is green, nothing is.
- **Red is earned.** Red appears only when money or a deadline is at risk. Everything
  merely noteworthy is amber.
- **No new colors** without updating this file first. No purple, no blue accents, no gradients
  that aren't built from these tokens.

## Type

- **Headings + logo lockup:** Helvetica-style face (`Helvetica, Arial, sans-serif`). Matches the printed labels.
- **Body + ALL numbers:** Inter, with `font-variant-numeric: tabular-nums` so columns of
  bushels and dollars line up. (This overrides any skill guidance that bans Inter — brand rule.)
- **Base size 18px.** Nothing the farmer must read is smaller than 16px.
- Numbers are the product. Big numbers (stat values, totals) get the Helvetica face,
  bold, and generous size (32 to 44px).

## Logo and co-branding lockup (the hierarchy that makes Rule 2 credible)

- **Farm's own logo (or farm name in bold) — TOP-LEFT of the sidebar.** This is *their* software.
- **Crop RX mark — pinned to the BOTTOM of the sidebar:** "Powered by Crop RX." Always
  visible, never in the way.
- **Login screen is the ONE place to go full Crop RX brand:** big ℞ / Farm Rx mark, CRX green
  panel, the slogan `INNOVATIVE SOLUTIONS. UNMATCHED RESULTS.`, and "by Crop RX Solutions."
  The instant they log in, it becomes their farm.
- Logo asset: `https://croprxsolutions.com/wp-content/uploads/2025/10/logo-1.png` (960×300).

## Light branding — where Crop RX shows up ("a little here and there")

Allowed, in this order of prominence:
1. Login screen (full brand, per above).
2. "Powered by **Crop RX**" sidebar footer with the green RX accent.
3. The ℞ glyph as a small watermark on generated PDFs (banker report footer).
4. Loading / empty states may use the ℞ mark as the icon.

Not allowed:
- Medical metaphors in navigation or feature names ("Prescriptions", "Diagnosis", "Treatment").
  Brand the wrapper, never the buttons.
- Crop RX branding inside the farmer's data (tables, charts, exports of THEIR numbers —
  except the small PDF footer mark).
