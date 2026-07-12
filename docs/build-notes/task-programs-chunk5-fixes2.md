# TASK — FIX Chunk 5 re-review blockers (round 2, Terra)

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED. Fix EVERY item, RUN checks yourself, report FULLY in your FINAL message (do NOT also write
a separate report file). Do NOT git commit. Do NOT edit `supabase/migrations/`. Do NOT run a dev server.
You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`. Prior findings that are already
CONFIRMED-fixed (full tracker restored, migration 0026, offline projection, cost $0, spray-word-once) must
STAY fixed — do not regress them.

## Blocker 1 — Link validation must be anchored to SERVER truth, not client-supplied canonical values
`src/data/SupabaseProgramsRepository.ts:94-98`: for `kind:'link'`, `canonicalAppliedOn`/`canonicalAppliedAcres`
come from the client-supplied `applicationLink` and are then used as the equality target for the RPC echo AND
the canonical reread. A wrong/stale/malicious client value is trusted; the check is effectively circular.
FIX: derive the link's expected date/acres from a SERVER source inside the operation — look up the linked
application record (id === applicationLink.applicationRecordId, farm === farmId, status <> 'voided') from a
server read the repository already has (`await this.canonical()` exposes `applicationRecords`, or add a
gateway read) and validate BOTH the RPC echo AND the reread against THAT server value. If the linked record
is absent/voided on the server, fail with a farmer-English error. The client-cached `canonicalAppliedOn`
may still seed the OFFLINE pending projection (QueuedProgramsRepository), but the ONLINE repository path must
NOT accept the server echo merely because it equals a client-sent number. Keep `none`/`create` validating
against the submitted/echoed values as today.

## Blocker 2 — Program application-product rows drop farm_id (no repository tenant check)
`src/data/SupabaseInventoryRepository.ts:32` (`mapProgramApplicationProduct`) omits `farm_id`, and the
`validate(...)`/`getWorkspace(...)` path never asserts these rows belong to `farmId` the way every other row
type does. RLS on the view is the primary guard, but this repository validates tenant ownership in depth on
all other rows. FIX: capture `farm_id` in `ProgramApplicationProduct` + its mapper, and in the validation
path fail if any `program_application_products` row's `farm_id !== farmId`. Add a regression with a
foreign-`farm_id` Program row that must be rejected.

## Blocker 3 — A product-less Program-created draft is not actually rendered in Inventory
The Inventory UI does not render a program-linked/created application record's free-typed lines, and a
product-less draft (zero catalog products) does not appear at all. Spec requires: opening such a record in
Inventory must render safely, read clearly as "Draft / un-posted", show the free-typed Program lines from
`program_application_products` as SEPARATE from inventory movement, and never imply on-hand changed. FIX:
render program application products against their application record in `src/InventoryModule.tsx` — a linked
COMPLETED record shows its normal inventory lines PLUS the separate Program free-type lines; a product-less
DRAFT shows as un-posted with its Program free-type lines and no inventory movement. Must not crash on zero
catalog products.

## Blocker 4 — Regressions must actually exercise the above (not source substrings)
`src/data/programsChunk5.regression.ts` and `SupabaseInventoryRepository.regression.ts` currently lean on
substring checks for the link-canonical and product-less-draft paths. Replace with behavior tests:
(a) a link operation where the client sends FALSE canonical date/acres (or omits them) and the server record
    holds the true values → the repository must REJECT a wrong server echo and ACCEPT only when it matches
    the SERVER record value; prove one idempotent receipt replay on the valid case.
(b) render/derive the Inventory workspace with a completed-linked record AND a zero-product Program-created
    draft → assert both render safely, are labelled draft/un-posted vs completed, Program lines are separate,
    on-hand is unchanged, and a foreign-farm Program row is rejected.
State the new coverage-group counts for every suite you touch.

## Rules / scope
- Additive; do not remove any restored tracker control or regress a CONFIRMED fix.
- Free-type stays free-type; never decrement inventory, write `application_products`, or post a draft.
- Brand/mobile: 18px/48px/tabular-nums/plain English/no medical metaphor/375px no overflow/status words.

## Proof (RUN yourself, paste real output in your FINAL message)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (STATE new counts).
`git status`. Do NOT commit. Per-fix: what changed + file:line. List the exact new regression cases.
Note: Opus will browser-prove on farm-rx TEST after this: product-less draft renders un-posted with on-hand
unchanged; a completed link shows separate Program lines; a stale/false client link value cannot be accepted.
