# TASK — DESIGN REVISION 2 (do not build): multiple programs per crop (Sol)

CRITICAL EXECUTION RULE: headless, no human is watching. NEVER present a plan and wait for
approval — that is task failure. PRE-APPROVED. Do the design work, edit the deliverable on disk,
report. Where a real choice exists, pick the best, state it, note the alternative.

## Context
You already wrote the authoritative design at `C:\FarmRx\docs\programs-design.md` (read it first;
it is the source of truth). The owner has now made ONE decision that overrides your V1 choice:

**Programs must allow MULTIPLE active programs on the SAME crop assignment — remove the
"one active program per crop assignment" restriction.**

Owner's driver, in his words: *"We need to be able to have different programs per crop, sometimes
people run different programs primarily on lighter soil vs higher productive soil on the fertility
side."* So the real, common cases are:
- two (or more) **fertility** programs on the same crop, chosen by soil productivity (a
  lighter-soil program vs a high-producing-ground program), AND
- a separate **chemical/herbicide** program running alongside a fertility program on the same crop.

## Your job
UPDATE `C:\FarmRx\docs\programs-design.md` in place to make multiple-programs-per-crop the V1
design (not a "later" extension). Keep everything else that still holds. Add a clearly labeled
**"Revision 2 (2026-07-12): multiple programs per crop"** note near the top summarizing the delta,
and revise the specific sections below. Do NOT rewrite the whole doc; change what this decision
actually touches. Do NOT apply SQL, do NOT build, do NOT commit, do NOT start a server. You MAY
read any file.

## Decisions to make and specify (pick best, justify, note alternative)
1. **Uniqueness change.** Remove the partial unique `(farm_id, crop_assignment_id) where
   status='active'`. State exactly what replaces it (likely: no active-uniqueness at the crop
   level; instead a sane cap, e.g. max N active programs per crop, and/or uniqueness only on
   `(assignment_id)` identity). Prevent accidental double-assignment of the SAME program to the
   same crop while allowing DIFFERENT programs — recommend the exact constraint (e.g. partial
   unique `(farm_id, crop_assignment_id, program_id) where status='active'`).
2. **Grouping / category.** With several programs on one crop, the farmer must tell them apart at a
   glance. Decide whether to add an OPTIONAL `program_kind`/category on `programs` (candidate set:
   `chemical`, `fertility`, `fungicide`, `other` — or a small free-ish label). Recommend whether
   this is needed in V1 or whether the program NAME is enough. If you add it, keep it optional and
   additive; specify column + check + how the UI groups by it. Lean toward the smallest thing that
   makes two fertility programs on one crop unambiguous.
3. **Soil-productivity mapping — keep it SIMPLE and honest.** Farm Rx has NO sub-field management
   zones, and this revision must NOT invent them. Clarify how "lighter soil vs higher-productive"
   maps in V1. Likely answer: it's just two differently-named (and optionally categorized)
   fertility programs; the farmer assigns whichever one to each field's crop as appropriate, and
   MAY put more than one on the same crop when a field genuinely runs both. Do NOT add zone
   geometry, VRT maps, or soil polygons. If a light free-text soil/label field on the program or
   assignment genuinely helps, recommend it; otherwise say name+category is enough.
4. **Overlap semantics.** Two active programs on one crop may each have, say, a "Post" pass. That
   is INTENTIONAL, not a duplicate. Confirm dedupe stays per `assigned_pass` (so two real passes =
   two real cards/reminders is correct), and specify how tasks/notifications must NAME the program
   so two due "Post" passes are distinguishable (task title + notification body + dedupe keys
   stay unique per assigned_pass — verify the keys already are). Decide whether any soft "you
   already have a Post pass on this crop from program X" warning is worth showing (lean: gentle,
   non-blocking, optional).
5. **Tracker / assignment UI.** The Season-progress view now shows a crop with MULTIPLE program
   tracks. Specify how it groups (by program, showing program name + category), and that assign,
   reschedule, refresh, unassign, and reassign all operate on ONE specific assignment/program, not
   "the crop's program." Reassign replaces a single program's assignment, never all of them.
6. **RPC deltas.** List which RPCs change (assign_program now just adds another active assignment;
   unassign/refresh/reschedule already target one assignment; any that assumed one-per-crop). Keep
   receipt-idempotency, SECURITY DEFINER, advisory locks, no SELECT..FOR UPDATE.
7. **New pitfalls from multiplicity — rank P1/P2/P3** with concrete failures: e.g. two programs'
   passes cluttering one crop's board, a farmer confusing which program a card belongs to,
   accidentally assigning the same program twice, cost view now summing across multiple programs
   per crop (planned cost/acre should be per-program AND an optional per-crop rollup), refresh/
   unassign hitting the wrong program.
8. **Build-plan deltas.** Update the affected chunks (Chunk 1 schema: drop old unique, add the new
   constraint + optional category; Chunk 3 tracker: group by program, per-assignment actions;
   Chunk 5 cost: per-program cost + optional per-crop rollup). Keep chunks loop-sized + provable.

## Deliverable
Edit `programs-design.md` with the Revision-2 note + the section changes above. Then report a short
summary of exactly what changed and the top 3 new risks from allowing multiple programs per crop.
Do NOT apply SQL, build, run a server, or commit.
