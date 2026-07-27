# TASK — DESIGN (do not build): "Programs" (planned application programs) for Farm Rx (Sol)

CRITICAL EXECUTION RULE: headless, no human is watching this run. NEVER present a plan and
wait for approval — that is task failure. Everything below is PRE-APPROVED. Do the full design
work, read the real code yourself, and WRITE the deliverable to disk, then report. Do NOT ask
questions mid-run; where a real decision exists, pick the best option, state it, and note the
alternative.

## Your job (design only — NOT a build)
Design the "Programs" feature end to end and WRITE the full design to
`C:\FarmRx\docs\programs-design.md`. You MAY also write a DRAFT migration SQL file
(`supabase/migrations/0024_programs.sql`) but it is a DRAFT ONLY — do NOT apply it, do NOT run
any migration, do NOT touch the live Supabase project (applying migrations is a hard stop that
waits for the owner). Do NOT run a dev server. You MAY read any file in the repo and run
`npx tsc -b --force` if useful. Do NOT git commit.

## What "Programs" is (owner's words + intent)
In CRX-Manager (our READ-ONLY sister app at `C:\CRX_Manager`, the business-side spray-service
app) an "application program" is a PLAN: a named recipe of the applications a grower intends to
make on a crop over a season, in order — typically:
- **Pre** (pre-emerge herbicide, at/before planting)
- **Post** (post-emerge herbicide, after emergence)
- **Fungicide** (mid-season)
- **Planter fertility** (starter fertilizer in-furrow at planting)
- plus room for custom passes.

The grower builds the recipe once, then **assigns it to fields**, and tracks each pass from
**Planned → Applied** through the season. "Plan once, apply to many acres" is the whole value.

This is the customer-facing (farmer) version in Farm Rx — NOT the business dispatch version.

## Owner decisions already locked (build to these)
1. **Products are FREE-TYPE for now.** The farmer types product names, rates, and units as
   plain text. Do NOT wire this to the inventory product catalog yet. BUT: shape the schema so
   a future catalog match is a no-migration change — include a nullable `catalog_product_id`
   (or equivalent) reserved column on program product lines, unused for now.
2. **Future roadmap item — DESIGN SO IT IS NOT PRECLUDED, do NOT build it:** later, when CropRx
   books an order with a customer in CRX-Manager, we want to "link"/push that order into the
   customer's Farm Rx account so the customer can see (a) what is *scheduled to be delivered*
   and (b) once it *leaves our warehouse*, it appears in THEIR inventory as on-hand ("on the
   floor"). Module 3 already left "an idempotent CRX delivery-event inbox hook" for this. The
   Programs product lines (free-type today) should be shaped so a future incoming order line can
   later reconcile against a planned program pass. Note in the design HOW a program pass would
   connect to that future order/delivery flow — but write no code for it now.

## Ground it in the REAL, ALREADY-LIVE tables (read them — do not invent)
Read these migrations and the client seam before designing:
- `supabase/migrations/0001_module1_fields.sql` — `fields`, `crop_assignments`
  (a crop-year row = field_id + crop_year + commodity_id + planting_sequence; the thing a
  program gets assigned TO). Double-crop = two rows, so a program assignment must target a
  specific crop_assignment, not just a field.
- `supabase/migrations/0010_module3_inventory.sql` — `application_records`
  (the ACTUAL, real-world application/spray record, already linked to crop_assignment_id).
  A pass marked "Applied" should be able to LINK to (or pre-fill) an application_record. The
  future delivery→on-hand flow also lives in this module.
- `supabase/migrations/0016_equipment_tasks.sql` — `farm_tasks` (the board; `source` check is
  currently `('manual','service_interval')` and was already widened to add `'scouting'` in 0020
  — you will need to widen it again for programs). Reuse the proven auto-card idempotency pattern
  (one open card per due pass, dedupe by a cycle/dedupe key).
- `supabase/migrations/0023_reminders.sql` — `notifications` + `create_notification`
  (dedupe-idempotent) + `generate_due_service_tasks`. A due pass should raise a deduped reminder.
- Feature A weather/spray (`docs/weather-spray-design.md`, `WeatherModule.tsx`) — a PLANNED
  spray-type pass (pre/post/fungicide) should be able to surface the field's "can I spray now?"
  light. Design the connection; keep it best-effort/non-blocking.
- Module 4 profitability schema (`docs/schema-module4.md`, migrations 0006/0007) — planned
  program cost/acre vs actual should be shaped to feed a cost line later.

## Follow the established codebase patterns (do not reinvent)
- RLS + membership gating exactly like field-log/scouting: owner/manager/worker may create/edit;
  read_only and reps excluded from writes. Farm isolation on every table.
- Write RPCs are **SECURITY DEFINER + receipt-idempotent** (advisory xact lock on
  farm_id+operation_id, return the prior result on replay) — the `repository_write_receipts`
  pattern. **NEVER use `SELECT ... FOR UPDATE` in a SECURITY INVOKER / RLS path** (the 0017
  lesson: RLS silently filters the locked row and a worker's write fails). Advisory locks only.
- Client seam: UI → Repository → Gateway → PostgREST/RPC, with a versioned offline write queue
  (FIFO, canonical echo, idempotent replay by operationId, blocked-vs-transport), plus a
  regression suite that drives every write. Mirror the existing modules.
- Brand rules: 18px base / 48px targets / tabular-nums / plain English / no medical metaphor in
  nav / 375px no overflow / two-tap. Products/passes must read like a farmer wrote them.

## Design decisions to make and JUSTIFY (pick the best; note the alternative)
1. **Data model.** Propose the tables. Likely shape: a `programs` template (name, optional
   commodity/crop scope, season/year, notes) → ordered `program_passes` (pass_type, planned
   timing as growth-stage text and/or target date and/or a relative anchor like "at planting",
   sequence) → free-type `program_pass_products` (product_name text, rate, unit, optional
   est_cost_per_acre, reserved nullable catalog_product_id) → `program_assignments` linking a
   program to a crop_assignment (or field+year). Decide whether assigning MATERIALIZES per-field
   pass instances (`assigned_passes` with status planned/applied/skipped, applied_date, optional
   application_record_id link) or derives them — argue the tradeoff (materialize is almost
   certainly right so a pass can carry its own status/date/actual link and drive tasks/reminders).
2. **Editing a template after it's assigned** — what happens to already-assigned passes? (Design
   for: template edits do NOT silently rewrite history of applied passes; propose the rule.)
3. **Task + reminder wiring.** When/how a due pass becomes a farm_tasks card (source 'program')
   and a notification, with exact dedupe keys, once-only, non-blocking, and how "Applied" closes
   the card. Reuse the service-interval auto-card idempotency shape.
4. **Weather spray-window connection** — how a planned spray-type pass reads the field's spray
   light; best-effort, never blocks.
5. **Applied → reality link** — how marking a pass Applied optionally creates/links an
   `application_records` row (free-type product now), and where the future delivery→on-hand and
   order-link hooks attach WITHOUT building them.
6. **RPC surface** — list every RPC (save_program, save_program_pass ordering, assign_program,
   mark_pass_applied, unassign, deletes), each receipt-idempotent, with the gating and the
   exact update scope (never overwrite unrelated columns — the harvest 0022 lesson).
7. **Edge cases / pitfalls — hunt hard and rank P1/P2/P3** with concrete failure scenarios:
   double-crop (two crop_assignments same field), reassigning/removing a program with applied
   passes, a pass with no date vs a growth-stage anchor, timezone/`current_date` boundaries,
   offline replay races, deleting a field/crop_assignment that has assigned passes (cascade vs
   restrict), cost rounding (the roundDecimalHalfUp lesson), and the free-type→future-catalog
   reconcile seam.

## Deliverable (write to `C:\FarmRx\docs\programs-design.md`)
1. One-paragraph plain-English summary a non-coder owner can read.
2. The data model (tables + columns + constraints + RLS), with rationale for each decision above.
3. The RPC surface (signatures + gating + idempotency + exact write scope).
4. The connection wiring (tasks, reminders, weather, application_records, profitability) with
   dedupe keys.
5. The future CRX-order-link / delivery→on-hand seam (how it attaches later; no code now).
6. Ranked pitfalls (P1/P2/P3) with concrete failures + the mitigation.
7. A BUILD PLAN broken into loop-sized chunks (schema → assign/track → tasks+reminders wiring →
   weather+applied links → polish), each chunk independently reviewable + browser-provable, so we
   can run a build loop over it. Note which model (terra/luna) should build each chunk.
8. Optionally write the DRAFT `supabase/migrations/0024_programs.sql` (clearly a draft; do not apply).

Report a short summary of what you wrote and the top 3 open risks. Do NOT commit. Do NOT apply SQL.
