# TASK — Migration 0018: field location + set_field_location RPC (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human is watching; NEVER present a plan and wait for
approval — that is task failure. Everything below is PRE-APPROVED. Implement fully, then report
with proof. Do NOT apply anything to any database (the orchestrator applies after review).
Do NOT run servers. Do NOT git commit.

## Context
Farm Rx (C:\FarmRx). Read `docs/weather-spray-design.md` §1 and §5 FIRST — it is authoritative.
This is the database groundwork for Feature A (Weather + Spray Windows). Fields currently store
no location; weather needs a lat/long point. 17 migrations are already applied (through 0017).
Follow the conventions in the existing migrations exactly (read 0001, 0009, 0016, 0017 for the
house style: additive nullable columns, SECURITY DEFINER RPCs gated by membership predicates,
`set search_path = public, pg_temp`, revoke-then-grant, NO `SELECT ... FOR UPDATE` inside
SECURITY INVOKER paths — see 0017's header for why).

## Deliverable 1 — write `supabase/migrations/0018_field_location.sql` (DRAFT, do not apply)
Additive only. Safe to run after 0017.
1. `alter table public.fields` add three nullable columns:
   - `latitude numeric(9,6)` check (latitude is null or latitude between -90 and 90)
   - `longitude numeric(9,6)` check (longitude is null or longitude between -180 and 180)
   - `location_source text` check (location_source is null or location_source in ('gps','manual'))
   Add a table-level check: latitude and longitude are both null or both non-null (a half-set
   point is invalid). If location_source is non-null, latitude/longitude must be non-null too.
2. RPC `public.set_field_location(p_farm_id uuid, p_field_id uuid, p_latitude numeric,
   p_longitude numeric, p_source text) returns jsonb`:
   - language plpgsql, SECURITY DEFINER, `set search_path = public, pg_temp`.
   - `v_caller := auth.uid()`; raise if null ('authentication is required').
   - Gate: the SAME membership write-predicate the field-save path uses. Inspect 0002/0009 and
     the `can_edit_farm` function. Workers MUST be allowed to set a pin (they hold the phone in
     the field); read_only members and reps MUST NOT. If `can_edit_farm` already includes
     'worker', use it; if it does NOT, use whichever predicate authorizes ordinary member writes
     for workers. State in your report which predicate you used and why.
   - Validate the point (both non-null, in range; p_source in ('gps','manual')).
   - Verify the field exists AND belongs to p_farm_id; raise 'field does not belong to this farm'
     otherwise. (A plain UPDATE ... WHERE id=p_field_id AND farm_id=p_farm_id is fine — SECURITY
     DEFINER bypasses RLS, so no FOR UPDATE and no RLS-visibility trap.)
   - Last-write-wins UPDATE of latitude/longitude/location_source; the set_updated_at trigger
     handles updated_at. Return `to_jsonb(updated field row)`. Raise if no row updated.
   - NO write-receipt (idempotent by nature; re-setting the same point is harmless).
   - revoke all from public/anon/authenticated; grant execute to authenticated.
3. Header comment: what it does, why additive-safe, the 0017 no-FOR-UPDATE note, the predicate
   choice.

## Deliverable 2 — inventory label-limit finding (write `docs/build-notes/weather-inventory-findings.md`)
Read `supabase/migrations/0010_module3_inventory.sql`, `0011`, and `src/data/inventory.ts`.
Report: does the product catalog (or any product/label table) store ENVIRONMENTAL LIMITS usable
by a spray check — e.g. max wind speed, temperature range, rain-free hours, inversion/drift
restrictions? For each, give the exact table.column and type, or state "not present." This
decides whether Feature A's optional "check against a product" refinement (design §5) can be
built now or must wait for a future migration. Be exact; quote column definitions.

## Deliverable 3 — self-review
Adversarially review your own 0018 before finishing: RLS/permission holes (could a worker on a
farm they don't belong to move a pin? could a read_only or rep write?), the both-null/both-set
constraint correctness, cast-injection safety, idempotent-replay safety, and whether anything
here could break the already-applied 0001-0017. List findings + fixes.

## Proof / report
You cannot apply or run SQL. Instead: `git status` to show exactly which files you created,
and paste the FULL text of 0018 and the findings doc in your final message. Confirm you touched
ONLY `supabase/migrations/0018_field_location.sql` and the two docs. List deviations.
