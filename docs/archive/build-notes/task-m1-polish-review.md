PRE-APPROVED TASK — do NOT ask for confirmation; EXECUTE end-to-end. You have READ-ONLY sandbox: do not modify files.

# Adversarial review: Module 1 Fields polish pass (uncommitted working-tree changes)

You are reviewing C:\FarmRx. The changes under review are the UNCOMMITTED modifications (run `git diff` and `git status`) plus the new file src/data/MockFieldsRepository.regression.ts. Baseline = HEAD (7b6d466).

Scope of the build you are judging (5 requirements):
1. Inline always-visible quick-add field row in the list (save on blur/Enter through the repository, inline validation errors, no modal).
2. Field detail page as 4 edit-in-place cards: Basics / Land agreement / Yield & price / Records. Arrangement close-and-insert history semantics in MockFieldsRepository MUST be preserved.
3. KPI row: total fields, total acres, "Crops assigned x/y" nudge that toggles a filter to fields missing a current-year crop assignment.
4. Landlord contact fields (phone, notes) added to the arrangement data model, optional/lazy so existing stored v2 envelopes still load; regression coverage required.
5. Equivalent-cash-rent estimate on the agreement card for share/flex arrangements (expected yield x price x share math), "—" with hint when inputs missing, plain rent shown for cash arrangements.

Hard rules to enforce:
- UI must talk ONLY to the repository interface via src/data/index.ts (no direct mock import in components).
- Grain compartment in the shared localStorage envelope must be untouched by any fields save path.
- Design brief (docs/design-brief-codex.md): >=18px user-facing text, >=48px interactive targets, brand tokens only, tabular-nums for numbers.
- No new dependencies, no network calls, TypeScript strict clean.

Attack it like you did the previous two reviews: wrong-math cases (equivalent rent with zero/missing yield, share percentages, flex terms), data-loss cases (per-card saves clobbering other cards' unsaved or saved values, close-and-insert regression, envelope corruption), UX lies (KPI counts wrong year, filter counts entities vs fields wrong, "Saved" shown when save failed), validation bypasses, and design-rule violations with exact px values and selectors.

Number every finding: **P1 (must fix)** / **P2 (should fix)**, each with file:line and a concrete fix. End with exactly one line: `VERDICT: COMMIT-READY` or `VERDICT: NEEDS FIXES (n P1)`.

Your FINAL message must be ONLY the markdown review document — no preamble, no sign-off.
