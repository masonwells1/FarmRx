# Initiative LD — Loads ledger

This ledger is append-only. Never edit, reorder, or delete an earlier entry. If an entry is wrong, append a correction that cites it. Times use `America/Chicago`.

## LD-000 — Initiative context and LD-1 plan

- **Date/time:** 2026-09-20 07:05 -05:00 (`America/Chicago`).
- **Authority:** the `Initiative LD — Loads` section of the 2026-09-05 owner amendment in `docs/GOAL.md`, and decision 4 of that amendment, which authorizes scale tickets as a top-priority build sequenced immediately after FD and GL. Mason approved continuing through the remaining work in the working session on 2026-09-20 ("continue rest of work") after PR #49 merged into `main` as `efafc3a`. Merge, live migration, secrets, and scheduling remain Mason's decisions.
- **Starting point:** branch restarted from `origin/main` `efafc3a` (GL-2, GL-3a and GL-3b merged). Farm Rx has bins, bin movements, contracts and contract deliveries, and no record at all of a load. A farmer hauling grain has nowhere to put the ticket.
- **Tier:** full (a new table, row-level security, two `SECURITY DEFINER` RPCs, an append-only trigger, the access-epoch guard, and private financial data). Disposable-database assertions, fresh-context review of the exact commit, and the role matrix apply.
- **Scope boundary held deliberately:** LD-1 records the ticket and nothing else. LD-2 owns the farmer-confirmed effects (a bin movement, a contract delivery, a harvest contribution) and the crop year on `bin_transactions`. LD-3 owns committed-vs-free. The screen says so in words, because a farmer who assumed a load already moved bushels out of a bin would stop recording bin-outs and their stored bushels would drift.

## LD-001 — LD-1 built: the load record

- **Date/time:** 2026-09-20 08:40 -05:00 (`America/Chicago`).
- **Commits:** `9b3b0e0` (migration, assertions, allowlist) and the client commit that follows it.

### What was built

- **`supabase/migrations/20260920180000_ld1_grain_loads.sql`.** A `grain_loads` table with the ticket as the owner amendment describes it: date, truck, origin, destination, gross, tare, net bushels, moisture, ticket number, photo path, notes. Append-only with void-and-reason, matching the bin ledger. `authenticated` holds `select` and nothing else; the only writers are `save_grain_load` and `void_grain_load`.
- **The origin decides the lot.** A field origin takes the commodity and crop year from the crop assignment; a bin origin takes them from the bin's `bin_inventory` baseline. A client that sends a value contradicting the origin is **refused**, not overridden. Two independent evaluators of one fact is the defect GL-2 spent five rounds on, and the cheapest place to prevent it is the first commit.
- **A contract destination must match the lot**, by commodity and by crop year. Carry-over grain paying down a current-year contract is the specific failure LD exists to prevent, and it is now impossible through this path.
- **Both fences on both RPCs:** `can_edit_farm` **and** `can_read_private_financials`, plus a service-role refusal. These are security-definer functions, so they bypass row-level security and have to state their own fence; `can_edit_farm` alone admits a worker, and a scale ticket carries the farm's bushels and the buyer that bought them.
- **A lost response is not a lost ticket.** Every save carries a client-minted id that belongs to the ticket, not to the attempt. A retry with the same content replays the saved row; the same id carrying different content is refused as `FARM_RX_LOAD_ID_REUSED`. The void behaves the same way, with `FARM_RX_LOAD_ALREADY_VOIDED` for a conflicting second reason.
- **The void already answers in LD-2's shape** — a `status` and a `blocked_by` list — although an LD-1 load creates nothing else and nothing can block its void. The browser should not have to learn a second answer when loads gain their effects.
- **A Loads tab** in Grain, gated on a `grain_loads` capability so the merge-before-migration window offers no form that cannot save. The lot the origin decided is shown to the farmer rather than typed by them, and only contracts matching that lot are offered.

### Defects found and fixed while building, in order

1. **The 0043 definer allowlist caught the two new RPCs on the first disposable run** (58 → 60). Fixed by name, identity arguments and count in both the bash assertions and the PowerShell lane. The lane is doing exactly the job GL-3b built it for.
2. **The assertions presented no access-epoch header** and every write failed `FARM_ACCESS_EPOCH_CHANGED`. The fence was right; the fixture was not.
3. **A cross-farm assertion proved nothing.** It ran as the owner of the farm that owns the bin, so the call died on the permission fence before reaching the bin check. Rewritten to run as the *other* farm's owner, and to assert the message names the farm check.
4. **A static guard matched its own prose.** `/grant[^;]*(insert|update|delete)[^;]*on public.grain_loads/` matched the comment *"No insert, update or delete grant"* running into the next statement. Anchored to the start of a line.
5. **A trigger guard matched a prefix.** `public.grain_loads` is a prefix of `public.grain_loads_nothing`, so a mutation pointing the epoch guard at a different table was not detected. Both trigger guards now pin the whole statement through its closing `;`. The mutation drill found this, not review.
6. **The mutation count is pinned in two files** and I changed one. The guard that pins it failed the drill's own baseline. Fixed; this is the third time in two tranches that a count has had to agree in two places.
7. **The GL-3b `redraft()` guard counted file-wide.** LD-1's load form uses the same idiom for the same reason, so the count went to 8 and a GL-3b guard failed for an LD-1 change. Scoped to the `ContractRepair` body, which also closes the reverse hole: a GL-3b field losing its `redraft()` while some other component gained one.
8. **The trucks read broke a named rep's front door.** The Equipment truck picker was added to `loadWorkspace`, and `getSnapshot` — the path Today serves its front door from — shares it. The browser journey *"Today gives a named rep a view-only front door with grain alerts and no equipment or task reads"* failed, correctly. The read is now lazy to the Loads tab and is not part of the grain workspace at all. **This was a real privacy widening caught by an existing test, not a fixture problem.**
9. **The Grain header and the Grain router are two lists that must agree, and I changed one.** The Loads tab appeared and silently opened Overview. Fixed, and a new guard (`grain:every-tab-has-a-route`) pins every `GRAIN_TABS` slug against the router's whitelist so the next tab cannot repeat it.
10. **A mock handler claimed `equipment` by table name.** An entry keyed by table would have answered — and rejected — Equipment's and Profitability's own reads. Matched by exact query shape instead, ahead of the name-keyed handler.

**The pattern, again:** eight of these ten are *two things that had to agree, and I changed one*. Three were caught by guards and drills that earlier tranches built, one by a browser journey defending an invariant LD-1 had no idea it was touching, and one by the disposable database on the first run.

### Proof observed

- `npx tsc -b --force`: clean.
- All six disposable-database suites pass, including the new `LD1_GRAIN_LOADS_DISPOSABLE_PASS`.
- **Negative proofs:** removing the contract crop-year fence, the append-only trigger, or the financial fence each fails the assertions with its own message. Sending a crop year from the browser fails the new repository regression with its own message.
- `node scripts/foundation-static-guards.mjs`: PASS, with 14 new LD-1 guards.
- `node scripts/verify-foundation-mutations.mjs`: **306/306** (287 at branch point). 19 new controlled mutations, each turning the gate red.
- `npm run build`: clean. `npm audit --audit-level=high`: 0.
- Browser: all five specs on desktop and phone — **114 passed, 15 skipped, 1 failed**, retries 0. The one failure is the known flake below.

### Limits, stated rather than implied

- **A load is not queued offline.** Recording a ticket at the elevator with no signal is a real farmer case and this does not cover it. The server derives the lot from the origin and checks the contract against it under a row lock, so a ticket held for hours would be judged against a farm that may have moved underneath it — and LD-2 makes that worse by giving the load effects that must pass the bin guards at the moment they run. Offline load entry belongs with those effects, not ahead of them. The screen says "Connect to the internet before recording a load" rather than pretending.
- **A bin can name only one lot today.** `bin_inventory` carries `unique (grain_bin_id)`, so a bin has exactly one baseline commodity and crop year, and `bin_transactions` carries no crop year until LD-2 adds one. The owner amendment's "pick which crop year (lot) you are moving from the list of crop years present in that bin" is therefore a list of one until LD-2. The form defaults it and says what it decided; it never guesses.
- **The optional photo has a column and no upload.** `photo_path` is stored and never written by the client. Soil Rx owns the storage-upload pattern this would reuse, and wiring it is a separate piece of work, not a line in this form.
- **No lane renders the Loads tab on a phone**, so the one-column form is proven by the stylesheet and the desktop journey, not by a rendered phone assertion.
- **Known flake, sixth occurrence:** `Soil Rx drains custody after lost Storage and row-delete responses without unrelated writes` (phone) failed in the full run and passed alone immediately after, as it did in GL-009, GL-019, GL-022, GL-029 and GL-037. It is in code no LD tranche touches. Recorded, not explained.
- **`src/data/programInventoryCW2.regression.ts` fails on this machine**, and fails identically on `origin/main` `efafc3a` with none of this branch's changes. It needs a service this sandbox does not have. Unchanged by LD-1, and green in CI on `main`.

## LD-002 — CI caught the eleventh defect: six foreign keys with no covering index

PR #50's `foundation` check failed on `c658f73`, in the PowerShell-only 0043 advisor lane:

```
ERROR:  6 public foreign keys remain without a covering index
```

### What was wrong

`grain_loads` declares seven foreign keys and shipped with four indexes. The 0043 advisor rule wants,
for each key, an index whose **leading columns are exactly that key's columns, in the order the
constraint declares them**, and which is **not partial**. That rule exists so `on delete restrict`
can be checked with an index scan: without it, deleting an equipment asset, a bin, a field assignment
or a contract has to sequentially scan every load the farm has ever recorded.

Only `farm_id` was covered, by `grain_loads_farm_date_idx`. The other six were not, for two reasons
at once. Three indexes were written **farm-first** — `(farm_id, origin_grain_bin_id)` — because that
is the order the *application* queries in, which is the opposite of the order the *constraint* is
checked in. Those same three were also **partial** (`where ... is not null`), narrowed to save space
on nullable columns; a partial index does not satisfy the rule at all, and the two partial indexes
elsewhere in the schema that do pass are named exceptions in 0043's allowlist. The remaining three
keys — the truck, the destination bin, and the commodity — had no index of any kind.

The fix replaces them with seven non-partial indexes in constraint-column order, several carrying a
trailing `load_date desc` that the existing `bin_transactions_bin_history_idx` already models, so
they serve LD-2's per-bin and per-contract reads as well as the constraint checks.

### Why nothing on a development machine saw it

0043 is one of three lanes written only in PowerShell against a container, and this sandbox cannot
run them. LD-1 already knew that: section 13 of `scripts/sql/ld1-grain-loads-assertions.sql` exists
precisely because "the allowlist lane is PowerShell and cannot run on a development machine, so the
two things most likely to be wrong are checked here" — and it caught the definer count on day one.
The covering-index rule was simply the third such thing, and nobody had thought to copy it across.

So the fix is not only the indexes:

- **Section 14** of the LD-1 assertions now carries 0043's covering-index rule **copied whole** —
  global scope, both allowlisted partial-index exceptions — and the bash lane applies every migration
  to a real PostgreSQL, so it runs against a true catalog. Reverting the migration to its shipped
  indexes with section 14 in place reproduces CI's failure exactly, same count and same rule, on a
  development machine. **This now fails for any new table that forgets an index, not just this one.**
- **A static guard** (`ld1:every-foreign-key-has-a-covering-index`) pins the six leading-column
  prefixes and bans a `where` predicate on any `grain_loads` index, so the warning written into the
  migration is enforced rather than merely hoped for.
- **Two controlled mutations** prove the guard bites: one rewrites an index farm-first, one narrows
  an index to partial. Both turn the gate red.

### The pattern, for the eleventh time

*Two things that had to agree, and I changed one* — here the table's foreign keys and the advisor's
index rule. Nine of LD-1's eleven defects are now this shape. What is different about this one is
that it is the first to reach CI: every earlier instance was caught by a guard, a drill, a browser
journey or the disposable database before the branch was pushed. The gap was not carelessness about
the rule, it was a rule enforced **only** in a lane that cannot run here — and the remedy that
matters is section 14, which moves it to a lane that can.

### Proof observed on the fix

- All six disposable suites pass, including `LD1_GRAIN_LOADS_DISPOSABLE_PASS` with section 14.
- **Negative proof:** restoring the shipped indexes fails section 14 with `6 public foreign keys
  remain without a covering index (the 0043 advisor rule)` — the same six CI counted.
- `node scripts/foundation-static-guards.mjs`: PASS, with 15 LD-1 guards.
- `node scripts/verify-foundation-mutations.mjs`: **308/308**, including both new mutations.
- `npx tsc -b --force` clean; `npm run build` clean; `npm audit --audit-level=high` 0;
  `git diff --check` clean; the full chain prints `CHAIN_PASS`.
- **Browser journeys were not re-run, and did not need to be:** this change touches one migration,
  one SQL assertion and two build scripts. No file under `src/` changed, so nothing the browser
  loads is different from the run recorded in LD-001.

### Still owed

The other two PowerShell-only lanes (`verify-0040-disposable.ps1`, `verify-0033-disposable.ps1`)
remain unrunnable here, and their rules have not been copied across the way 0043's covering-index
rule now has been. That is the next instance of this defect waiting to happen, and it is worth a
deliberate pass rather than another tranche discovering it in CI.

## LD-003 — the two remaining PowerShell-only lanes, ported

LD-002 closed the covering-index gap by moving one rule out of a lane that cannot run on a
development machine. It also named the obvious next step: two more such lanes, `verify-0040-`
and `verify-0033-disposable.ps1`, whose rules nothing runnable here checked. Both are now ported
into the disposable database the bash lane already builds from every migration, and both run in
CI too — the PowerShell twin `verify-fs-persist-disposable.ps1` invokes the same two files, so the
rules the ports add are enforced where it matters rather than only locally.

### What each port covers

**`scripts/sql/epoch-fencing-assertions.sql` (0040, farm access-epoch fencing).** The catalog rules
that need no fixture — no Data API access to `farm_access_epochs`, the epoch RPC's grant shape, the
expected-user parser unreachable, **every farm-scoped table wearing the row guard**, every
client-writable table farm-scoped, the storage guard present. Then the behaviour: epochs advancing
monotonically across grant, revoke and the financial flag; the narrow first-farm bootstrap
exception; a stale epoch refused on all four write paths (direct, missing header, `SECURITY DEFINER`
RPC, storage) and the current epoch accepted on all four; the expected-user half of the header; both
farms judged on a storage move; and the service-role exemption.

**`scripts/sql/bin-and-contract-truth-assertions.sql` (0033, bin and contract truth).** The rules
that decide whether the bushels Farm Rx shows a farmer are the bushels they have: a bin's capacity
counts every crop in it and a refusal does not forget a lot; a bin holding a nonzero lot will not
take another crop, but an emptied bin will; movements and deliveries replay on a lost response
rather than double; the ledger and contract pricing each have one write path, with the privilege as
the outer fence; a bin cannot go negative or overflow; a price leg finalizes once; and a contract
cannot be overdelivered.

### Two things found while proving the ports bite

Neither came from reading the code. Both came from breaking it and watching what failed.

1. **0040's `guard_storage_object_farm_access_epoch` is dead code.** `soil_rx_storage` does a
   `create or replace` on the same name to add the soil-test bucket, so the later definition is the
   only one installed. Deleting the old-farm epoch check from 0040's copy changed *nothing* — the
   assertion stayed green, and it took a round of instrumented debugging to work out why. Anyone
   hardening the storage boundary by editing 0040 would get the same silence. The installed body is
   now pinned: it must still name all three buckets and still assert both farms on a move.
2. **`soil_tests` is the one client-updatable table whose `farm_id` no `prevent_farm_move` trigger
   protects.** It is not open — its own identity trigger refuses the move under a different name —
   so the farm boundary holds, and the row guard's old-farm branch is defence in depth rather than
   the thing standing in the way. Both halves are now asserted, plus a pin that `soil_tests` stays
   the only one, so a future table resting entirely on that branch is a decision rather than a
   migration nobody read.

### Proof observed

- Eight disposable suites pass together, the two new ones included.
- **Nine negative proofs, each failing with its own message.** 0040: dropping the expected-user
  comparison, removing the storage trigger, deleting the old-farm assert from the *live* storage
  guard, and letting `soil_tests` change farms. 0033: removing the bin capacity check, the
  one-crop-per-bin check, the negative-balance check, the overdelivery check, and the price-leg
  compare-and-set.
- `node scripts/foundation-static-guards.mjs`: PASS. `node scripts/verify-foundation-mutations.mjs`:
  308/308. `git diff --check` clean.

### Limits, stated rather than implied

- **The ports are twins, not replacements.** `verify-0040-` and `verify-0033-disposable.ps1` still
  run in CI and remain authoritative for their own containers; the ported files are a second copy
  of the same rules in a lane a development machine can run. Two copies of a rule can drift, which
  is the defect shape this whole exercise is about — the mitigation is that both now run in CI, so
  a rule dropped from one is still enforced by the other rather than silently lost.
- **The row guard's old-farm branch is still unproven at runtime.** No client-updatable table can
  actually change `farm_id` today, so the branch is unreachable from a browser and there is nothing
  to exercise. Section 11 fails the moment that stops being true.
- **The third lane, 0043, is only partly ported.** LD-002 moved its covering-index rule and LD-001
  its definer-allowlist essentials; its policy fingerprints and the rest of its catalog remain
  PowerShell-only.

## LD-004 — load effects, explicit and atomic

**Branch:** `claude/ld2-load-effects`, cut from `main` `36abdd6` (LD-1 merged as #50).
**Tier:** full. New migration, new RLS-adjacent write paths, money-adjacent bushel math.

### What a farmer notices

The load form now ends with **What saving this will do** — a short list of boxes, ticked, and one
sentence underneath saying what the ticked boxes will do in plain words. Saving takes the bushels
out of the origin bin, puts them into the destination bin, records them delivered against the
chosen contract, and counts them toward the field crop's harvest — each one only if its box is
ticked, and only if this load's shape can reach it at all. A load to an elevator is never offered a
contract delivery.

LD-1's sentence — *"It does not yet move bushels out of a bin…"* — is gone, because it stopped
being true. Voiding a ticket now reverses everything it did.

Harvest and the field record card show **bushels from loads** beside the harvest total the farmer
typed, with the difference when both exist, and Harvest offers one **Use load total** action.

### The four decisions that carry the weight

1. **The lot is (commodity, crop year), not commodity.** `bin_transactions` carried no crop year, so
   a bin-out of 2026 corn could be satisfied by 2025 corn in the same bin. Every load-created
   movement is now stamped, and the negative-balance guard holds at the lot. **The commodity guard
   is kept, not replaced**: rows written before this migration carry a null crop year and are their
   own bucket, so the lot figure alone would read high on a bin whose baseline was drawn down by
   them. Both guards must pass.
2. **The harvest contribution is derived and never written.** `crop_assignments.harvested_bushels`
   is one replaceable total the Harvest form overwrites whole, so a load increment would be erased
   by the next manual entry or double-counted by it. A load's contribution is a flag on the load and
   nothing else. "Use load total" writes the derived sum through `save_crop_harvest` as a
   replacement the farmer confirmed; voiding a load afterwards changes only the derived figure.
3. **A load's effects are found by link, not guesswork.** `bin_transactions.grain_load_id` and
   `grain_contract_deliveries.grain_load_id` say which rows a load created. A void reverses exactly
   those: the delivery is removed (a claim, not a physical event, so every existing reader of
   delivered bushels stays correct with no second rule about voided deliveries), and each movement
   is answered by its opposite through the same guards. A bin that cannot take the reversal makes
   the void **blocked** — nothing changes at all, and the answer names the later movements in the
   way.
4. **The effect flags are a preference, narrowed once at send time.** They survive a change of
   origin or destination, so a box the farmer never touched keeps its default and one they unticked
   stays unticked. Clearing them as the shape changed looked tidier and was wrong — see below.

### Defects found

| Found by | What was wrong |
|---|---|
| Disposable lane, first run | The new `assign_bin_movement_crop_year` took the 0043 definer allowlist from 60 to 61. That count turned out to be pinned in **three** files, not two; all three now carry it and each names the other two. |
| **Browser journey** | **The contract-delivery box defaulted ticked and was silently unticked before the farmer ever saw it.** Picking a bin called the form's update, which normalised the effects against a destination that was still "a buyer", clearing the contract default. By the time the farmer chose a contract the box they were promised would be ticked read as unticked. The flags are now a preference and the narrowing happens once, in the payload. |
| **Mutation drill** | The privacy gate read `profile?.capabilities.canReadPrivateFinancials` twice, so a mutation replacing the first occurrence left the second to satisfy the guard. The gate is now one expression, pinned whole. |
| **Mutation drill** | LD-2's harvest read reuses LD-1's `RECENT_GRAIN_LOAD_LIMIT`, so requiring that text once meant dropping the bound from *either* read still passed. The guard counts both reads now. |
| Browser journey | The e2e mock matches `grain_loads` by exact query shape. LD-2's narrower read is a second shape and was rejected as invalid — which is the mock behaving correctly. Both shapes are now declared, rather than claiming the table by name. |
| Harvest receipt regression | The first attempt called `useFarmAccess` inside `HarvestPage`; that regression renders the page with no provider and the hook is right to throw. The capability decision moved to the composition root, which is the better shape anyway. |
| Offline queue | The queue envelope validates its keys exactly. Requiring the two new ledger columns would fail the parse closed on a device holding a movement queued before LD-2 and tell that farmer their saved changes need attention. They are accepted as optional. |

### Proof observed

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` (0); `git diff --check` clean.
- **All nine disposable suites pass together**, the new `ld2-load-effects-assertions.sql` included,
  wired into both runners so CI enforces it too.
- **Seven negative proofs on the SQL**, each failing with its own message: both negative-balance
  guards, the effect gating, the void's movement lookup, the blocked-void classification, the
  crop-year assignment's short-year refusal, and a harvest effect that writes the manual total.
- `node scripts/foundation-static-guards.mjs`: PASS, with eight new LD-2 guards.
- `node scripts/verify-foundation-mutations.mjs`: **320/320** (308 at branch point). The count is
  pinned in two files and both were changed together.
- **Browser: 117 passed, 15 skipped, none failed** across desktop and phone, including a new LD-2
  journey that runs on both — which also closes LD-1's recorded gap that no lane rendered the Loads
  tab on a phone.

### Limits, stated rather than implied

- **A manual bin movement still carries no crop year.** LD-2 stamps every *load-created* movement,
  which is what the amendment requires, but the hand-entered bin-out form does not ask. Those rows
  join the unknown bucket, so the bucket keeps growing rather than only shrinking. Asking the
  farmer to confirm the lot on the manual form is the obvious follow-up and is **recommended before
  LD-3**, whose committed-and-free figures exclude unknown-year rows.
- **The reconciliation list is owner and manager only**, and is the only way to name a legacy
  movement. A farm whose owner never opens it keeps those bushels out of every year-specific figure
  — which is the deliberate fail-closed choice, not an oversight.
- **A load is still not queued offline.** Unchanged from LD-1, and LD-2 makes it harder, not easier:
  the effects must pass the bin guards at the moment they run.
- **`.sr-only` is referenced in `src/ProfitabilityModule.tsx` but defined in no stylesheet**, so
  text meant for screen readers is visible. Found while building the reconciliation picker, which
  uses `aria-label` instead. Not fixed here — it is unrelated to loads and changes what Profitability
  renders.
- **Known flake, seventh occurrence:** `Soil Rx drains custody after lost Storage and row-delete
  responses…` failed in one full run and passed alone immediately after, as in six earlier tranches;
  the final full run was clean. In code no LD tranche touches.
- **`programInventoryCW2.regression.ts` fails on the development machine** and fails identically on
  `origin/main` `36abdd6` with none of this branch's changes; verified in a clean worktree this
  session. It needs a service the sandbox lacks.

### CI caught a twelfth defect, and the reason it got that far

`npm run regression` chains 64 files with `&&`. The known-broken `programInventoryCW2` sits at
**position 48**, so the suite stops there on this machine and the last sixteen files never run. One
of them, `roundSevenSweep`, enforces the 18px farmer-text contract over every `font-size` in
`app.css` — and LD-2 had set the note under the harvest effect checkbox to 16px. CI ran the file
this machine could not reach and failed in four minutes.

The fix is one character of CSS. The finding is that **a known-failing regression early in a chained
suite silently hides every regression behind it** — the same shape as LD-002's covering-index
defect: the rule existed, and nothing here was asking it.

All 64 files have now been run individually on this branch; only `programInventoryCW2` fails, and it
fails identically on `origin/main`. Running them individually rather than through the chained script
is the way to run them here until that failure is fixed.
- **The browser suite ran against the sandbox's pre-installed Chromium** (build 1194) through a
  throwaway config, because the pinned Playwright expects 1228 and this environment forbids
  downloading a browser. Nothing about that config is committed; CI uses the repo's own.

### Live steps, still the owner's

Applying `20260921120000_ld2_load_effects.sql` is Mason's, and **merging deploys the client through
Vercel before that migration exists** — as it does every tranche.

Writing this section is what surfaced the gap and it is now closed rather than merely recorded.
LD-2's window is worse than LD-1's: the `grain_loads` table already exists, so the Loads tab opens
normally and only the effect columns are missing. A farmer would have ticked a box and been shown a
database error. The gateway now probes a column only this migration adds (`select('id,effect_harvest')`
— `select('*')` succeeds against an LD-1 database and proves nothing), and while that probe fails the
form offers no effects and says the rest arrives with the next database update. The reconciliation
list hides itself for the same reason.

So the order is safe either way, and the migration can be applied whenever suits.

## LD-005 — committed vs free

**Branch:** `claude/ld3-committed-free`, cut from `main` `11bd1e3` (LD-2 merged as #51).
**Tier:** full, per the amendment's "all of LD". No migration: LD-3 is a read-only derivation.
**Merge order:** cut in parallel with LD-006 from the same base. LD-006 merged first, as #53, so
this entry sits before it by number and after it in `main`'s history.

### What a farmer notices

The Bins page gains one short section, **Committed and free**, with a line per lot:

> **2026 corn** · 4,000 bu stored · 3,000 bu committed · **1,000 bu free**
> **2025 corn** · 6,000 bu stored · nothing committed · **6,000 bu free**

The position card gains the same sentence for the crop year that card is already about. Where a farm
owes more of a lot than it holds, the figure reads **short by N bushels** rather than a negative
"free", because that is what it means.

**The per-bin committed and free pair is gone.** It is removed rather than replaced.

### The three rules

1. **A lot is a commodity in a crop year.** A 2026 contract never reaches back into the 2025 crop.
   This is the defect the whole initiative exists to prevent, and LD-3 is where it becomes a number
   the farmer reads.
2. **The figure is farm-level and is never allocated per bin.** Contracts are written against the
   farm, not against particular bins, so splitting committed bushels across bins would be an
   invention — and the farm figure shown again on each bin is the same bushels counted twice. The
   old display read `bin_inventory.committed_bushels`, a stored per-bin number; LD-3 does not read
   that column at all and a static guard keeps it that way.
3. **A movement with no crop year joins no lot.** Those rows are named separately, in plain words,
   beneath the figures: *"1,200 bu of corn are in movements recorded before Farm Rx kept crop years,
   so they are in none of the figures above."*

Over-delivery is floored per contract. An over-delivered contract owes nothing; letting it read
negative would quietly pay down a different contract's obligation.

### The assertion that matters

LD-3 adds no SQL, so the disposable suite does not check that the derivation exists — it checks
that **the database agrees with it**. `scripts/sql/ld3-committed-free-assertions.sql` builds the
same fixture the TypeScript regression uses, computes the same figures in SQL, and then proves the
free figure is real **by hauling it**: taking exactly the 1,000 free bushels of the 2026 crop
succeeds, and taking one bushel past what that lot holds is refused by name — on a bin holding
10,000 bushels of corn, where a commodity-level figure would have called them all available.

Its fixture also sets the bin's `committed_bushels` column to a deliberately wrong 5,500, so any
figure that started reading it again would be caught there as well as by the guard.

### Proof observed

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` (0); `git diff --check` clean.
- **Ten disposable suites pass together**, the new LD-3 file included, wired into both runners.
- **Seven regression groups** for the derivation, and **six mutations against them, all six caught**,
  each with its own message: committed ignoring the crop year, an unstamped movement credited to a
  named year, the baseline swallowing another year's movement, over-delivery going negative,
  committed read from the per-bin column, and the farm figure reading only one bin.
- Static guards PASS with **four new LD-3 guards**; **mutation drill 325/325** (320 at branch
  point), count changed in both files that pin it.
- **Browser: 119 passed, 15 skipped, none failed** on desktop and phone, including a new LD-3
  journey that reads the two lots off the screen and asserts the old per-bin number appears nowhere.
- **All 65 regression files run individually**, per LD-004's finding. Only `programInventoryCW2`
  fails, and it fails identically on `origin/main`.

### One guard worth describing

The rule "no screen reads `committed_bushels`" cannot be written as a plain text search, because the
comment that explains the rule has to name the column it forbids — and LD-1 already shipped a guard
that its own comment satisfied. The guard strips comments before testing, which is the only way to
state this particular rule honestly.

### Limits, stated rather than implied

- **`bin_inventory.committed_bushels` still exists and is still written** by whatever wrote it
  before. LD-3 stops reading it for display; it does not drop the column, because dropping a column
  is a migration and LD-3 has none. It is now a value nothing shows, which is worth removing in a
  later tranche rather than leaving as a second answer to a question that now has one.
- **The unknown-crop-year bucket is still fed by the manual bin-out form**, which does not ask which
  crop year it is. LD-3's figures exclude those bushels honestly and say so on the screen, but the
  pile grows until that form asks. This was raised in LD-004 and is now visible to the farmer, which
  makes it more pressing rather than less. **Still the recommended next change.**
- **Free is farm-level and says nothing about which bin the grain is in.** A farm with 1,000 free
  bushels split across two distant bins is told it has 1,000 free bushels. That is correct for
  contract purposes and deliberately says nothing about hauling.
- **`programInventoryCW2.regression.ts`** fails on the development machine and identically on
  `origin/main` `11bd1e3`.

## LD-006 — three P1 findings Codex raised on the merged LD-2, and what came of them

**Branch:** `claude/ld2-codex-p1-fixes`, cut from `main` `11bd1e3`.
**Context:** Codex reviewed PR #51 when it was marked ready and finished at 20:56, about thirty
seconds after the PR merged. Its three findings therefore landed on `main`, not on an open PR. All
three were verified against the code rather than taken at face value. **All three are real.**

### Fixed here

**1. A page left open across the migration would have performed effects it never showed.** (P1)

The effect flags are a preference that survives a change of shape, and they default to ticked. While
`grain_load_effects` is false the form shows no effects at all and says the save records only the
ticket — but the flags underneath were still true, and `grainLoadPayload` narrows them by the load's
origin and destination, not by the capability. Pre-migration the old RPC ignores the extra keys, so
nothing happened. **The moment the migration is applied with that page still open, the next save
reaches the new RPC and moves bushels, pays down a contract and adds to a harvest, none of which the
farmer was shown.**

That is precisely the invariant LD-2 exists to hold — *nothing happens that is not on this list* —
and the window is not hypothetical: the migration had not yet been applied when this was found.

What the screen says it will do is now what gets sent: the save clears all four flags when the
capability is false, rather than trusting a narrowing that does not know about the migration.

**2. A summed figure was silently capped.** (P1)

`listHarvestLoads` reused `RECENT_GRAIN_LOAD_LIMIT`, the **display** cap of 500. Harvest and Fields
**sum** that answer. A farm with more than 500 contributing tickets — reachable in one harvest —
would have been shown an understated figure, and *Use load total* would have overwritten a typed
harvest total with a partial one.

The read now has its own bound (`HARVEST_LOAD_SUM_LIMIT`, 5,000) and asks for **one row past it**, so
a truncated answer can be told from a whole one. When the answer is short the screens say *"at least
N bu from loads"*, explain why, and **withhold *Use load total* entirely** — a sum that may be short
is never offered as a replacement for a number the farmer typed. Offline the queued repository
returns `complete: false` for the same reason: an empty list claiming completeness would read as
"no loads contribute" rather than "not known right now".

### Not fixed here, and why

**3. A bin origin can only ever haul its baseline's crop year.** (P1)

`loadLotFor` and `save_grain_load` both derive a bin origin's lot from `bin_inventory` alone. So a
bin filled only by LD-2's own bin-in effect has no baseline and cannot be chosen as an origin at
all, and a bin holding carry-over plus a newer stamped lot can only be hauled as the older year.

This is real, and **LD-3 makes it worse rather than academic**: the Bins page now tells a farmer they
have, say, 1,000 free bushels of the 2026 crop, and the load form will not let them record hauling
those bushels.

It is also, word for word, what the amendment asked of LD-1: *"a bin origin requires the farmer to
pick which crop year (lot) is being moved from the list of crop years present in that bin, defaulting
only when the bin holds a single lot."* LD-1 recorded it as a stated limit — *"a bin can name only
one lot today"* — because `bin_transactions` carried no crop year to enumerate. **LD-2 added that
column, so the deferral no longer holds.**

Fixing it needs the lot list derived from baseline plus transactions, a picker on the form when more
than one lot is present, and a `save_grain_load` that accepts and validates a chosen crop year for a
bin origin — which is a migration. That is a tranche, not a repair, and it is **the recommended next
piece of work**.

### Proof observed

- `npx tsc -b --force`; `npm run build`; `git diff --check` clean; all nine disposable suites pass.
- Static guards PASS with two new guards; **mutation drill 322/322**, count changed in both files.
- **Browser: 117 passed, 15 skipped, none failed** across desktop and phone.
- Three mutations cover the repairs: the harvest read losing its ability to detect truncation,
  *Use load total* offered on a possibly-short figure, and the effect flags sent despite the
  capability being false.

### What this says about the process

Codex's review ran on the draft being marked ready, which happened at merge time — so the findings
arrived after the merge rather than before it. Nothing was lost, but the review had no chance to
gate. Marking a PR ready a few minutes before merging, rather than as part of merging, would give it
that chance.

## LD-007 — the bin origin's lot, and the deferral LD-1 wrote down

**Branch:** `claude/ld4-bin-origin-lot`, cut from `main` `8716da0` (LD-3 merged as #52, the Codex
repairs as #53).
**Tier:** full. One migration, `20260921180000_ld4_bin_origin_lot.sql`.

This closes a deferral LD-1 recorded in its own words — *"a bin can name only one lot today"* — and
which the amendment had asked for by name:

> *"a bin origin requires the farmer to pick which crop year (lot) is being moved from the list of
> crop years present in that bin, defaulting only when the bin holds a single lot."*

LD-1 could not do it honestly, because `bin_transactions` carried no crop year and so there was no
list to offer. LD-2 added the column. LD-3 then made the gap visible to the farmer rather than
merely latent, which is what moved this from a nicety to a defect: the Bins page says a farm has
1,000 free bushels of the 2026 crop, and the load form would refuse to record hauling them.

### What a farmer notices

Picking a bin that holds one crop year changes nothing at all. The form says, in a line under the
bin, *"This bin holds one crop year: 2026 Corn, 20,000 bu"*, and asks nothing — which matters,
because the common case is a farmer in a truck cab who should be typing weights, not answering
questions.

A bin holding more than one asks: **Crop year**, with what each lot actually holds beside it —
*2026 Corn · 4,000 bu*, *2025 Corn · 6,000 bu* — so the choice is made against the bin rather than
from memory. Saving without answering says *"That bin holds more than one crop year. Pick which one
this load came from."*

Two things that were impossible are now ordinary: **hauling the newer lot out of a bin holding
carry-over**, and **hauling out of a bin that has never been measured** — which LD-2's own bin-in
effect creates, so LD-2 had been filling bins its own load form would not empty.

### Four decisions, each ruling out a cheaper thing that would have been wrong

1. **The lot list is one function, not an expression repeated where it is needed.** `public.bin_lots`
   is the only server answer to "what is in this bin, by crop year", and `deriveBinLots` is the only
   browser answer. Two evaluators is already one more than anyone wants, and it is unavoidable: a
   truck cab with no signal cannot ask the database. A third, inline, is how they would quietly
   stop agreeing. The disposable suite checks both against the same fixture.
2. **`save_grain_load` does not re-ask whether the bushels can move.** `append_bin_movement` already
   refuses to draw a lot below zero, under a row lock, stamped `FR001`. The new branch checks only
   that the chosen lot is one the bin has a record of. Two balance checks could race and disagree,
   and the farmer would be told different things by the same save. A static guard and a mutation
   both hold this.
3. **A movement with no crop year is still in no lot.** `bin_lots` returns the unstamped bucket as a
   null crop year row and the origin branch skips it. Those bushels are real and the bin balance
   counts them; what they are not is a year anyone may pick.
4. **`bin_lots` is `security invoker`.** It reads two RLS-protected tables, so the caller's own
   policies apply and it needs no rights of its own. **The SECURITY DEFINER allowlist is unchanged
   at 61**, in all three files that pin it.

### A lot the bin has emptied stays on the record

`bin_lots` keeps an emptied lot at zero rather than dropping it. *"This bin has no record of that
crop year"* and *"this bin is out of that crop year"* are different answers, and the farmer deserves
the right one. The picker still does not offer it.

### The assertion that matters

`scripts/sql/ld4-bin-origin-lot-assertions.sql`, thirteen sections. The sharpest is section 9: the
2026 lot is emptied while **5,500 bushels of 2025 corn remain in the same bin**, and the next
bushel of 2026 is refused by name. A bin full of corn that will not let out one more bushel of a
particular year is Initiative LD in a single assertion.

Writing it found something worth recording: emptying a bin *completely* is refused by the
**commodity** balance guard, which fires first and says "this movement would make the bin balance
negative" — true, but not the rule under test. The fixture was changed so only the lot guard can
possibly refuse, and the section now asserts the bin still holds 5,500 bushels so that a future
edit cannot quietly weaken it back.

### Proof observed

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` (0); `git diff --check` clean.
- **Eleven disposable suites pass together**, the new LD-4 file included, wired into both runners.
- **Seven SQL mutations against the migration, all seven caught**: the superseded-baseline rule
  lost, lots keyed by commodity alone, an emptied lot hidden, a two-lot bin picking for the farmer,
  a chosen year taken on trust, the unstamped bucket counted as a lot, and `save_grain_load`
  answering the balance question a second time.
- **Nineteen browser regression groups** across two files — ten in `committedFree.regression.ts`,
  nine in the new `loadOriginLot.regression.ts`, the ninth covering the repair below.
- Static guards PASS with **twenty-three new LD-4 guards** (eight, plus fifteen for the repairs below);
  **mutation drill 361/361** after merging the LD-3 repair and adding the repair mutations,
  count changed in both files that pin it.
- **Browser: 119 passed, 15 skipped** on desktop and phone, including a new LD-4 journey that reads
  both lots off the picker, is refused for not answering, and then proves the chosen year is what
  reaches the RPC.
- **All 66 regression files run individually.** Only `programInventoryCW2` fails, and it was
  confirmed to fail identically on `origin/main` `8716da0` in a clean worktree.

### The drill found two real guard weaknesses

Both are the same shape, and it is the shape this initiative keeps producing: **a guard that asks
whether a string appears, when the string appears twice.**

- `requireText(grainData, 'binLotsOnHand(')` stayed green while the bin origin went back to reading
  its baseline, because `originBinLots` calls `binLotsOnHand` too. Now pinned to the movements read
  inside `loadLotFor`, which is unique to it.
- `requireText(grainData, 'capabilities?.grain_load_bin_lot === false')` stayed green while the
  derivation stopped consulting the capability, because the validation still did. Now **counted**:
  it must appear exactly twice.

Neither was found by reading. Both were found by mutating, which is the argument for the drill.

### Limits, stated rather than implied

- **The manual bin-out form still does not ask which crop year a movement is.** Raised in LD-004,
  made visible in LD-005, and still not fixed here: LD-4 changed the load form, not the movement
  form. The unknown bucket keeps growing until that form asks. **Still the recommended next
  change**, and it is now the only place in Grain where bushels move without naming a lot.
- **A lot with a zero balance can still be chosen when the bin-out effect is unticked.** That is
  deliberate — recording a historical ticket that moves nothing should not be blocked by today's
  balance — but it means a saved ticket can name a lot the bin is out of. The ticket is a record,
  not a movement, so nothing is double counted.
- **`bin_inventory.committed_bushels` still exists and is still written.** Unchanged from LD-005.
- **Free is still farm-level and says nothing about which bin the grain is in.** LD-4 makes a
  specific bin's lots haulable; it does not tell a farmer which bin to drive to.
- **The browser suite ran against the sandbox's pre-installed Chromium** (build 1194) through a
  throwaway config, because the pinned Playwright expects 1228 and this environment forbids
  downloading a browser. Nothing about that config is committed.
- **The Soil Rx custody journey failed once on phone** in the full run and passed on rerun. Eighth
  occurrence; unrelated to LD-4 and still unexplained.

### The repair Codex found before this merged

Codex reviewed `ba64007` when the PR was marked ready and raised one P1, and it was right about
something LD-008 had got wrong. LD-008 recorded the PostgREST truncation risk as **display-only**,
reasoning that the database still guards every write. That is true of LD-3's figures. **It is not
true of LD-4**, and the difference matters:

`loadWorkspace` reads `bin_transactions` unbounded and newest first, so under the row cap the
**oldest** movements drop — and an older still-active crop year with them. Derived from that short
array a two-lot bin looks like a **one-lot bin**. The form then offers no choice and sends no crop
year; `save_grain_load` reads `public.bin_lots`, sees two lots, and refuses with *"pick which one
this load came from"* — **while the form is showing no picker to answer with.** The farmer cannot
record the load at all. LD-4 turned a wrong number into a blocked action.

The fix is the one this initiative keeps arriving at: **stop having two evaluators.** The picker now
calls `public.bin_lots` for the selected bin — the same function `save_grain_load` reads, at most a
handful of rows — so the two cannot disagree. The workspace derivation survives only as the
fallback for the cases where the server behaves the old way anyway: offline, or the migration not
yet applied. A load cannot be recorded offline at all, so that fallback never decides a real save.

When the capability says the server reads lots but that read **fails**, the form says so and the
save refuses, rather than falling back to a list that may be short — a short movement list and a
one-lot bin are indistinguishable, and guessing between them is the defect.

The browser journey was rewritten to prove it: its `bin_transactions` fixture is **deliberately
empty** for the carry-over bin while `bin_lots` declares both lots. The picker can only get its two
lots from the database. **Reverting the one-line change makes that journey fail.**

### Two more, from the review of the merge commit

Codex reviewed `da028bf` and found two more. Both are LD-4's own, and one is the more serious of
everything found on this tranche.

**A retry after a lost response stopped returning the ticket it had already saved.** (P1)

LD-1 guaranteed that a retry is the same ticket, not a second one and not a failure. LD-4 broke it
for exactly one case: **a one-lot bin hauled to exactly zero.** The first call commits the ticket
and its bin-out. The retry then finds no lot with anything left in it and is refused at *"that bin
holds no crop with a crop year"* — **seventy lines before the replay check it needed to reach.** The
farmer is told the load failed when it is already recorded, and retrying again never helps.

Before LD-4 this could not happen, because the bin's baseline row answered and movements never
remove it. The fix adopts the stored ticket's lot when the caller named none. Nothing is taken on
trust: the stored lot must still be one the bin has a record of, and the field-by-field replay
comparison still decides same-ticket versus reused-id.

**A crop year the save emptied was kept while the picker stopped offering it.** (P2)

The form deliberately keeps the origin for the next ticket. If that save emptied the chosen lot, the
picker drops to one lot and stops rendering — while the draft still holds the emptied year. Every
further save is then refused, and **the control that could fix it is no longer on screen.** A year
the bin no longer offers is now dropped, and the lots are read again after each save, because a save
changes what the bin holds.

**One mutation survives, and it is worth naming rather than hiding.** Removing `farm_id = p_farm_id`
from the replay lookup changes nothing observable: the replay comparison's first condition is
already `v_existing.farm_id = p_farm_id`, so a cross-farm id is refused either way. The filter is
defence in depth, not the thing that holds the rule, and no honest assertion can distinguish it.

### And two more, from the review of the first repair

The repair itself drew a third round. Both findings are about the same thing from opposite sides:
**a decision made against a bin that is not standing still.**

**The save was allowed while the lot read was still in flight.** (P1) `authoritativeLots` is
undefined until the answer lands, and the fallback while it is undefined is the derivation — the
truncated list the repair exists to stop trusting. The save guard only asked whether the read had
*failed*, not whether it had *finished*, so a farmer typing quickly could save inside that window
and get the original defect back. "Not answered yet" is not "answered with nothing", and the form
now distinguishes the four states rather than two. A null answer — no signal, or the function not
installed — is unavailable, not an empty bin.

**The bin was not locked while its lots decided anything.** (P1) `save_grain_load` counted the
on-hand lots and then, on the defaulting path, selected the single one — **two statements, two
snapshots, under read committed.** Another truck's movement committing in between meant the count
could say one lot while the select returned two, and a plain `SELECT INTO` over two rows takes
whichever arrives first. The load would then be filed under a crop year nobody chose: the silent
guess the amendment forbids, arriving through a door nobody had checked.

Fixed twice over, because each fix is worth having alone. The bin row is now taken `for update`
before its lots are read — the same row `append_bin_movement` locks — so the lot decision and the
movement sit in one serialised window. And the count and the default lot come from **one aggregate**,
which cannot disagree with itself, with `max()` returning the single lot's own values precisely when
the count is one.

**What is proved, and what is not.** The lock and the single read are asserted against the installed
`prosrc`, and both mutations are caught. **The race itself is not reproduced** — staging it needs two
concurrent connections and the disposable suite is one session. That limit is stated here rather
than left for a reader to discover.

### A fourth round, and one of them was a contradiction this ledger had already written down

**An emptied lot stopped being nameable.** (P2) This entry's own limits say that a lot with a zero
balance can still be chosen when the bin-out effect is unticked — a ticket that moves no bushels is
a record of something that already happened, and it should be filed under the year it really was.
`save_grain_load` was written to allow exactly that. **The browser repair then filtered zero-balance
lots out of the authoritative list before the form ever saw them**, so the path this entry promised
no longer existed. The repository now keeps every lot the bin has a record of, and the narrowing
moved to where the load's effects are known: **what a farmer may NAME is a wider list than what the
form may DEFAULT to**, and a year that moves bushels is only offered when the bin still holds some.

That is worth noticing as a pattern rather than a one-off. A repair aimed at one rule walked into
another rule written three sections higher in the same document. Prose in a ledger is not a guard;
the emptied-lot path now has an assertion.

**A void puts bushels back, and nobody told the form.** (P2) A void writes compensating movements,
so a lot the voided load had emptied is holding grain again. `onSaved()` refreshes the workspace,
but the authoritative lot read is separate and **wins over the workspace** — so the form kept
offering one lot where the server now saw two, and refused the next save with no picker to fix it.
The same refresh that follows a save now follows a void.

### A fifth round, and the same asymmetry a third time

**The lots were not read again after a save that failed.** (P2) A save refused because another truck
changed the bin is *exactly* the moment the form's lot list is known to be wrong — and it was the
one moment the list was not refreshed. The farmer retried against the same stale list until they
switched bins or reloaded.

Three findings on this tranche were this same asymmetry: refresh after a save, then also after a
void, then also after a failure. Each was patched where it was found. **That is the wrong shape, and
the third one made it obvious.** The rule was never "after a success" — it is *"after touching this
bin"*, and it is now one line in `finally` that covers every outcome, replacing the three special
cases. The void keeps its own refresh because it is a different handler touching the same bin.

Worth stating plainly for whoever reads this next: **when a third finding is a variation of the
first two, the fix is the rule, not the third case.**

### A sixth round, and this one reached the model

Two P1s, and unlike everything before them these are not UI states. They are the definition of a
lot and the arithmetic behind it.

**A lot was identified by crop year alone.** This initiative's first rule, written at the top of
`committedFree.ts`, is *"a lot is a commodity in a crop year"*. The lookup that resolves a farmer's
chosen lot keyed on the year and took `order by bushels desc limit 1`. A bin that held 2025 soybeans
and was later reused for 2025 corn has a record of both — so a ticket for the emptied soybeans would
have been **silently stamped corn**, because corn had more bushels. The commodity now travels with
the choice, from the picker's option value through the payload to a server that refuses an ambiguous
year rather than picking the fuller lot.

**Three places computed what a bin holds, and they disagreed.** `append_bin_movement`'s *commodity*
balance excludes every same-commodity movement at or before the baseline. Its own *lot* balance
excluded only the baseline's own crop year. `bin_lots` and the browser copied the narrower rule. So
a bin with a 5,000 bushel baseline and an older 800 bushel carry-over movement **reported 5,800 and
would release 5,000** — the farmer shown a lot they could not haul, which is the one thing this
initiative exists to prevent.

The narrower rule was wrong, and it was wrong in this ledger too. **LD-007's section 1b asserted it
at length**, calling it "the subtlest rule in the file" and warning that a baseline for one year
must not swallow another year's movements. That reasoning sounded careful and was backwards: a
baseline is the farmer walking out and measuring the bin, so it covers everything of that commodity
already in it. The assertion, its browser regression, and LD-3's own group 3 are all corrected.

One rule now, in all three places, with the baseline's *bushels* still belonging to its own
commodity and year — a separate question that LD-2 had conflated with supersession.

**This changes merged LD-3 behaviour.** `isLotMovementSuperseded` ships on `main`, and its figures
move for any bin with a pre-baseline movement of the same commodity in another year. The figures
were wrong before and are right now, but it is a change to something already merged and is called
out here rather than buried in a diff.

**What six rounds have actually shown.** The first five found defects in this tranche's own new
code. This one found a defect LD-2 and LD-3 already carried, which LD-4 inherited by copying the
rule rather than checking it against the guard that enforces it. That is the difference worth
recording: **copying a rule is not verifying it**, and the only reason this surfaced is that LD-4
put a third evaluator beside two that already disagreed.

### A seventh round: the lock was right, its edges were not

Three findings, and all three are the same lock from a different angle. Taking it was correct; what
was wrong was **what still sat outside it**.

**The replay lookup read before the lock.** (P1) The sixth round moved the stored ticket's lot into
`save_grain_load` so a retry on an emptied bin could replay. That lookup ran *before* the bin was
locked — so an overlapping retry could read "no such ticket", wait on the lock while the first call
committed and emptied the lot, then fail the zero-lot check anyway. The repair was right and its
placement was not; the lookup now reads inside the serialised window.

**Naming a crop year queued behind nothing.** (P2) `assign_bin_movement_crop_year` locked the
movement row only. But naming a year **creates a lot**, and `save_grain_load` defaults a load by
counting lots — so a manager could add one in the window between that count and the movement the
load appends, and the ticket would be filed under a year the farmer was never asked about. It now
takes the same bin row, and its baseline rule was corrected to match the sixth round's.

**A lone emptied lot could be shown but not chosen.** (P2) A bin whose only record is an emptied lot
renders one line rather than a picker — correctly, there is nothing to choose between — but
defaulting looked at what the bin still *holds*, which is nothing. So a ticket moving no bushels was
refused with no control on screen to answer with. Defaulting now uses the same list the form
offered, which is identical when the load moves bushels and wider when it does not.

**The guard trap, a fourth time.** The predicate the baseline rule turns on now appears in two
functions, and the guard pinning it passed while one of them reverted. That is the fourth occasion
on this tranche where *a guard asked whether a string appears when the string appears twice*. It is
counted now, and the comment says why — but the honest lesson is that `requireText` on a shared
idiom is a weak guard by construction, and the drill is what keeps finding it.

### An eighth round, and it overturns something LD-1 wrote down

**A single-lot bin sent no lot at all.** (P1) When the bin offers one lot the form shows it as a
sentence and asks nothing — and sent nothing, leaving the server to work the lot out again at save
time. Between the read and the save another device can empty that lot and add a different one. The
server then resolves to the **new** sole lot, and the ticket records a crop the screen never named,
with no error and nothing to undo it.

This overturns a principle LD-1 stated plainly and this ledger repeated: *"the browser never sends
a lot; two evaluators of one fact is the defect this tranche prevents."* That was right about the
danger and wrong about the remedy. **The browser still does not decide the lot** — the server
refuses any lot the bin has no record of, and `append_bin_movement` still refuses bushels that are
not there. What the browser now sends is *what it showed the farmer*, exactly as a contract edit
sends the `updated_at` it was shown. A stale expectation becomes a loud refusal instead of a quiet
wrong ticket.

**And the fix had the same flaw as the thing it fixed.** The first version filled the draft from
`originLots` whenever it held one lot — including while the authoritative read was still in flight,
when that list is the workspace derivation this repair exists to stop trusting. A bin that really
holds two lots looks like one for a few hundred milliseconds, so the form answered a question it was
about to ask. **The browser journey caught it; reading the code did not.** The picker still appeared,
which is why it looked right — it simply had a choice already made in it.

That is the second time on this tranche that acting on an unsettled list was the bug, after the save
guard in round five. The rule is now explicit in both places: **nothing reads `originLots` for a
decision unless `lotsState` is `ready`.**

### A ninth round: the previous fix created a deadlock

**Two functions took the same two locks in opposite orders.** (P2) Round seven made
`assign_bin_movement_crop_year` take the bin lock — correctly — but took it *after* the movement
row. `append_bin_movement` takes the bin first and the movement row second. That is a cycle: a
movement retry holding the bin and waiting for the row, against a crop-year assignment holding the
row and waiting for the bin. PostgreSQL breaks it by aborting one, so **a farmer's save would fail
with a deadlock for a reason they can neither see nor act on.**

The fix is an unlocked read to learn which bin, then bin, then row — the same order as the other
path. The order is now asserted against the installed body, because it is invisible at the call
site and a future editor has no way to know it matters.

**The mock did not answer like the database.** (P2) `MockGrainRepository.listBinLots` dropped
zero-balance lots, which the real function deliberately keeps. So the ticket-only path — the one
repaired two rounds earlier — **could not be covered by any mock-backed test at all**, because the
mock rejected what production accepts. The mock now returns every recorded lot and leaves the
balance filter to the form, which is where it belongs.

**A fifth guard passed while its rule changed.** The mock guard pinned the text the filter *starts
with*, so appending a balance test left the pinned string intact. It is written as an absence check
now. Five occurrences on one tranche is no longer a run of bad luck: **`requireText` on a string
another edit can extend is not a guard**, and every one of the five was found by the drill.

### A tenth round, and the point at which patching stopped being the answer

Two findings, and both were in the previous rounds' fixes again — the third consecutive round of
that. I had written down, before this round arrived, that a third fix-of-a-fix in this area would
mean stepping back rather than patching once more. **This is that round, and this entry is what the
step back produced.**

**A bin-to-bin transfer locked only its origin.** (P2) The destination is locked later, when the
bin-in movement is appended. So A→B held A and waited for B while B→A held B and waited for A, and
PostgreSQL aborted one farmer's save.

**A retry could change its own lot.** (P1) LD-1 keeps the ticket id after a failed save so a retry
replays rather than duplicating. But the post-attempt lot refresh, the effect that drops a vanished
year, and the effect that fills in a lone one were all free to run in between — so a retry could
reach the server under a *different* crop year, and `save_grain_load` would answer
`FARM_RX_LOAD_ID_REUSED`: **refusing a load that had already been recorded.**

#### What the step back actually changed

The two findings above are instances. What made them possible is that this module had **no stated
lock order and no stated rule about when a draft may change.** Ten rounds of review found three
deadlocks and three staleness bugs, each patched where it was found, each patch correct and each
one creating the conditions for the next.

So both are now rules with one home rather than fixes with several:

- **`public.lock_farm_bins`** is the only place bins are locked for a multi-bin write, and it locks
  them in **ascending id order**. `save_grain_load` and `void_grain_load` both call it before they
  decide anything. The module's full order is written there: bins, then `grain_loads`, then
  `bin_transactions`, then `grain_contracts`, then `grain_contract_deliveries`.
- **A draft's chosen lot is frozen while a ticket id is outstanding.** One flag, checked by both
  effects. The lot *list* still refreshes, because the picker should show the truth; what is frozen
  is the choice the outstanding ticket was sent with.

Three earlier patches are subsumed by these two rules rather than sitting beside them.

#### And a sixth guard passed while its rule changed

Adding `lock_farm_bins` gave the string `perform 1 from public.grain_bins` a second home, and the
guard that pinned it stayed green while the other use disappeared. Six occurrences of one mistake on
one tranche. It is counted now, like the other five.

### An eleventh round, in which both findings broke rules written the round before

Two P2s on `c231a00`, and both are violations of **the two rules round 10 had just written down.**
That is worth saying plainly: stating a rule is not the same as following it, and the round that
introduced `lock_farm_bins` also introduced the first code that ignored it.

**The void took the load row before its bins.** (P2) `lock_farm_bins` exists so that everything
touching more than one bin queues in one order — bins, then `grain_loads`. `void_grain_load` called
it, but *after* its `select ... for update` on the load row. So an idempotent retry of a save held
the bins and waited for the load row while a void held the load row and waited for the bins: the
exact deadlock shape the helper was written to end, reintroduced in the commit that wrote it.

**A blocked void skipped the lot refresh.** (P2) The blocked branch returns from inside the `try`,
before the refresh the success path runs. This is the same success-only asymmetry the save path had
and had already been fixed for — applied there, not carried across. And the blocked outcome is
precisely the case that most needs a fresh list: a void is *blocked* because later movements changed
those bins. The refresh now lives in the `finally`, so it happens after any attempt.

#### A repair had silently broken a farm fence, and nothing noticed

Moving the lock revealed something worse than either finding. Round 10 had inserted
`perform public.lock_farm_bins(...)` **between** the load's `select ... into v_load` and the
`if not found then raise exception 'that load does not belong to this farm'` that reads its result.
`FOUND` then answered for the `perform`, which always succeeds — so **every load id looked like it
belonged to the calling farm.** RLS still stopped the write, so nothing leaked; but the specific,
farmer-readable refusal had become unreachable, and a void of another farm's id would have failed
with something else entirely.

No suite caught it, because **no suite had ever asserted that fence.** Ten rounds of review had
read past it. Section 10j exists now for exactly that reason, and so does
`ld4:the-void-fence-reads-its-own-select`, which fails if anything at all sits between that select
and the check that reads its `FOUND`.

The lesson is not "be careful near `FOUND`". It is that **a rule with no assertion behind it is a
comment**, and the fence had been a comment for the whole tranche.

### A twelfth round: the stand-in did not stand in

Two P2s, both raised against `ef8a29e` while round 11 was being written. **One of them was the
farm fence** — Codex found independently what moving the lock had already revealed, which is a
useful cross-check on that repair rather than new work.

**The other is real and was not fixed by round 11.** `MockGrainRepository.saveLoad` stands in for
`save_grain_load`, and it passed **no lot list at all** to either `validateGrainLoad` or
`loadLotFor`. Both therefore fell through to `binLotsOnHand`, which drops emptied lots. So a
ticket-only load naming a lot the bin has already emptied was **refused by the mock while the real
RPC accepts it** — and the path repaired two rounds earlier, for exactly that case, could not be
reached by any mock-backed test. The repair to `listBinLots` in round 9 had fixed the reader and
left the writer beside it still narrowing the list on its own.

#### Reading the server settled a rule nobody had written down

The fix needed the server's actual rule, so `save_grain_load` was read rather than recalled. It
keys on **whether a crop year was named, and on nothing else**:

- **A named year** is looked up among every lot the bin has a *record* of — `where lots.crop_year =
  v_crop_year`, no balance filter. That is why `bin_lots` keeps emptied rows at all.
- **An unnamed year** is defaulted from what the bin still *holds* — the count reads
  `bushels > 0.000001`.

That is two lists, chosen between by one property of the draft, and it existed only as a shape
inside a PL/pgSQL function. It is now `lotsSaveResolvesAgainst` in `src/data/grain.ts`, with
`recordedBinLots` beside `originBinLots` as the unfiltered twin of `public.bin_lots`.

**The form's list is deliberately wider than the server's, and that is not a defect.** For display
and defaulting the form uses `movesBushels ? onHand : recorded`, so a bin whose only record is an
emptied lot shows one line rather than an empty picker. It closes the gap by always naming the year
it showed, so what reaches the server is a *named* year and resolves against the recorded list.
Three lists across two layers is more than anyone wants; the reason there are three is written at
each one, and the regression pins all of them against one fixture.

#### And a seventh guard that would have passed while its rule changed

Moving the filter out of the mock and into `recordedBinLots` left the mock's absence check —
written two rounds ago precisely *because* `requireText` keeps failing this way — **guarding an
empty shell.** It stayed green on a body that no longer contained the thing it was checking for.
The check now follows the derivation into `grain.ts` and additionally pins that the mock delegates
rather than re-deriving.

The new save guard is written the same way round for the same reason: as the **absence** of the
no-list calls, not the presence of the two-argument ones. Either call reverting alone is the bug,
and a `requireText` on one stays green while the other goes back.

### Proof observed for this tranche

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together**, including
  `LD4_BIN_ORIGIN_LOT_DISPOSABLE_PASS` with sections 10j (a void refuses a load id this farm does
  not own) and 10k (the installed `save_grain_load` and `void_grain_load` bodies both take their
  bins before the load row, read back from `pg_proc.prosrc`).
- Static guards PASS; **mutation drill 364/364**, count changed in both files that pin it. Four new
  controlled mutations, one of which — moving the void's refresh from the `finally` back into the
  success path — **passed against the first version of its own guard.** The guard checked that the
  refresh came before the lock release, which the bug also satisfies. It pins the refresh *between*
  the `finally` and the release now.
- **Browser: 123 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### A thirteenth round, and the first finding that was wrong

Two more P2s. **One of them does not reproduce**, and saying so is part of the record.

**"Retry the lot read after a transient failure" — not a defect.** The claim was that pressing Save
while the lot read is unavailable "always returns here without incrementing `lotsRefresh`", stranding
the farmer behind a message that says to try again. But that refusal returns from *inside the try*,
and the refresh sits in the `finally` — put there two rounds ago, for this exact class of problem.
So Save does re-issue the read.

That said, "I read the code and it looked fine" is the reasoning this tranche has punished eleven
times. A browser journey now proves it instead: the lot read is made to fail, the form refuses and
says so, the read is allowed to succeed, and **the test asserts the read counter moved** on the next
Save. The claim is evidence now rather than my assertion.

**"Unfreeze the lot after a definitive save rejection" — real, and mine.** `ticketOutstanding` is
round 10's rule: a draft's chosen lot is frozen while a ticket id is outstanding, so a retry cannot
reach the server under a different lot and be refused as a reused id. It was cleared only on
success. But a **definitive** refusal — an `FR001`, say — rolled the transaction back, so no ticket
exists and nothing needs protecting. Staying frozen then strands the farmer in the way the rule was
invented to prevent: the refreshed list shows the lot that replaced theirs, the auto-select and
clear-vanished effects are both disabled, and every retry resubmits the stale lot until they switch
bins.

The freeze is only ever right while the outcome is **unknown**.

#### The classifier already existed, which is the whole point

The first fix I wrote was a new `serverRefusedDefinitively` that sniffed SQLSTATEs. It was thrown
away unused, because the codebase already answers exactly this question: `isTransportFailure`, which
decides "confirmation needed" from "needs attention" on a bin movement and on a delivery. A second
classifier would have been a second thing to keep in step — the mistake this tranche has now made
twice, once with the lot lists and once here. There is one classifier, and the catch clause is the
negation of it.

One consequence is accepted deliberately: offline counts as unknown, so the lot stays frozen even
though the queued repository refused before sending and nothing was committed. It costs nothing —
there is nowhere for that lot to go until the signal is back.

#### Proved by reverting it

The journey was run against the unrepaired code, with the lot kept frozen. It fails there: after the
refusal the retry never reaches the server at all. That is the farmer's experience of this bug, and
it is what the test now holds.

### A fourteenth round, and the one finding on this tranche that could have leaked data

One P2, and it is the most serious thing review has found here.

**`listBinLots` was not fenced after its response landed.** `SupabaseGrainRepository` verifies the
operation context *before* the request, via `operationFarmId`, and then — unlike **every other read
and write in that file** — never again. `operationWorkspace`, `appendBinTransactionOperation`,
`recordContractDeliveryOperation`, `editContractOperation` and the rest all do the same thing after
the gateway resolves: `await this.dependencies.verifyOperationContext(context)`.

So a lot read still in flight when the account, the selected farm, or the access epoch changed could
resolve into `authoritativeLots` and **put the previous farm's bin quantities on screen** — private
financial figures, on a form that would then offer them as lots to haul.

Nothing was written and RLS was never bypassed, so this is a display leak rather than a breach of
the database. That is not a reason to rank it lower. Farm Rx's whole access story is that a farm's
numbers are visible only while you are in that farm, and the epoch fence exists because a token and
a selected farm can change mid-request. **A read is not exempt from that fence because it writes
nothing** — and this was the only grain read that behaved as though it were.

#### It had no coverage at all, which is how it survived fourteen rounds

`FakeGateway` in `SupabaseGrainRepository.regression.ts` had no `listBinLots` at all. Not a weak
test — **no test**. The method was added in this tranche and every proof around it went through the
browser journeys and the SQL suite, so nothing ever exercised the repository layer's own contract
for it.

It has a fake and a coverage group now: the ordinary read returns every recorded lot including the
emptied one, and a context that changes **while the read is in flight** makes the call reject rather
than hand back the old farm's bushels. The group also asserts the context is checked *twice* — once
before the request and once after it lands — because a fence that only ran before is exactly the bug.

**Run against the unfenced code, it fails**, printing the previous farm's bushels in the failure
message. That is the leak, reproduced.

The guard is positional rather than textual: the verify call has to sit *after* the gateway read.
Pinning the string alone would stay green with the call moved back above the request, which is the
same shape that has now failed seven times on this tranche.

### A fifteenth round: the third mock-against-server divergence

One P2. `MockGrainRepository.lotBalance` summed **every** matching movement, with no baseline cutoff
at all, while `assign_bin_movement_crop_year` excludes movements the baseline already measured:

```sql
and (not v_baseline_covers_commodity or occurred_on > v_inventory.measured_at::date)
```

So an older outbound movement was subtracted twice in the mock, and it refused a crop-year
assignment the real function accepts.

This is the **third** time on this tranche the mock has disagreed with the server, after
`listBinLots` dropping emptied lots (round 9) and `saveLoad` resolving against the wrong list
(round 12). The rule was already written down once — `isLotMovementSuperseded`, which `bin_lots`
derives through — and `lotBalance` was simply never pointed at it. So the fix points it there rather
than adding a fourth copy of the predicate.

The guard is written **both ways** for the same reason: it requires the delegation, and it fails if
the string `measured_at` appears anywhere in `lotBalance` at all. An inline copy of the rule is how
these drift apart again, and it would leave the required line perfectly intact — the shape that has
now failed seven times here.

**On proof, stated plainly rather than implied:** this repair is held by the guard and two drill
mutations, not by a behavioural test. `MockGrainRepository.regression.ts` does not instantiate the
repository — the mock reads and writes `localStorage`, which Node does not have — so exercising
`assignBinMovementCropYear` end to end would mean standing up that seam first. That is worth doing
and is not done here. The two mutations do cover both directions (the cutoff removed, and the
predicate inlined), and every one of the six earlier divergences of this shape was caught by the
drill rather than by a test.

### A sixteenth round, in which writing the test found two more bugs than the review did

One P2 came in: hauling a one-lot bin dry left the emptied year in the draft. `originLots` goes
empty, the screen says the bin holds no crop year, and the draft still names the year just emptied --
which resolves against the **recorded** list, passes validation, and reaches the RPC only to come
back `FR001`, with no picker on screen to repair it. The early return on `originLots.length === 0`
was the hole.

That return existed to stop a transient empty list from wiping a real choice, and that danger is
real: every refresh clears the stored answer first, so the truncated fallback derivation stands in
for a moment. The fix is the gate its twin already had — **wait for a settled list**, and then an
empty one means what it says. The two effects now read the same list under the same condition
instead of one trusting it and the other guessing around it.

#### The journey passed against the bug, and that was the real finding

The browser journey written for this repair **went green on the unrepaired code**. It is the trap
this tranche has been producing all along, and this time it was mine.

The cause: the browser fixture's `bin_lots` mock filtered to `bushels > 0`, dropping exactly the
emptied rows `public.bin_lots` keeps on purpose. So after the save the fixture reported *no* lots,
validation refused for a different reason, and the assertion passed either way.

**That is the fourth stand-in on this tranche that disagreed with the server**, after the repository
mock's `listBinLots`, its `saveLoad`, and its `lotBalance` — and the worst of the four, because the
other three produced wrong behaviour while this one produced *false confidence*. A fixture that is
wrong in the same direction as the code does not test the code; it agrees with it.

With the fixture corrected the journey fails against the bug, as it should have from the start.

#### And correcting the fixture exposed a defect nothing had ever seen

With emptied lots present, an **older journey started failing** — the two-crop-year one. Not a
fixture problem: it had been passing for the wrong reason, and the reason was a real bug.

`authoritativeLots` and `lotsState` were two independent pieces of state. Selecting a different bin
changes `originBinId` immediately, but both of those are only corrected in an effect that runs
*after* the render. For that one render the status still said `ready` and the lots still belonged to
the bin just left — so **the form auto-selected a lot from another bin's list.** The old journey had
been passing because the ungated clearing effect happened to wipe that selection using the truncated
fallback list, which is the very list this feature exists to stop trusting.

So: a bug hidden by a second bug, and both invisible while a third (the fixture) kept the evidence
away.

The answer is not another gate. The lot answer is now stored **with the bin it is about and the
refresh it was fetched for**, and the status is derived from that single piece of state rather than
set beside it. A stale answer cannot be read at all, rather than being corrected soon afterwards.
That is the same move round 10 made with the lock order: replace a timing rule with a structural one.

It is the defect this whole feature exists to prevent — a lot chosen from a list that is not the
bin's — one layer above the truncation it was built for.

### A seventeenth round: the audit, rather than waiting for the fifth one to be reported

No review finding drove this one. Round 16 ended with four stand-ins found disagreeing with the
server, one per round, each discovered only when it happened to break something. That is not a
process; it is luck with a good hit rate. So the remaining grain stand-ins were read against the
server deliberately.

**The audit found one more, and it was the one holding a repair's only possible coverage.**

`void_grain_load`'s browser fixture returned `status: 'voided'` for `moduleRows.grain_loads[0]`
**whatever load id was asked for**, always with `blocked_by: []`. Two consequences:

- The **blocked** branch was unreachable in every journey that could ever be written. So round 11's
  repair — a blocked void must re-read the bin's lots, because a blocked void is *precisely* the
  case where later movements changed those bins — had no browser coverage and could not have had
  any.
- The farm fence could not be exercised either, since the id was ignored.

The fixture answers like the function now: it finds the load by `p_load_id`, refuses one this farm
does not own, returns `blocked` when the fixture declares blockers, and on a successful void puts
the bushels back into the declared lots — the mirror of the save decrementing them. The blocking
*rule* stays declared by each test rather than re-derived in the mock, because simulating it here
would be a fourth evaluator of it, which is the mistake this tranche has paid for repeatedly.

#### Writing that journey took four attempts, and each failure was the fixture being honest

Worth recording, because each one is the system working:

1. The seeded load used a **field origin with no crop assignment**, which the client rejects — it
   mirrors a real check constraint. The workspace refused to load at all.
2. The **reason prompt is the app's own dialog**, not the browser's. No journey had ever answered
   it: the void path had *no* browser coverage before this one, not merely no blocked-path coverage.
3. The blocker rows carried **no `id`**, so the parser dropped them and the generic message appeared
   instead of the named one. The parser drops anything not in the expected shape rather than
   guessing, which is exactly right.
4. **The journey passed without the repair.** The lot figures never changed in the fixture, so
   "the lots were read again" was unobservable — a decoration, not an assertion. The fixture now has
   another truck empty the bin to 500 bu *before* the void, which is also why the void is blocked.
   Without the refresh the screen keeps showing 5,000 bu that are not there, and the journey fails.

That fourth one is the same mistake as round 16's, made again one round later, and caught only
because reverting the repair is now a step rather than an afterthought.

### An eighteenth round: the rule was right, the mechanism was a render late

One P2, and it is a good one. **"The form states the lot it showed"** has been the rule since round
"a bin holding a single lot sends nothing and lets the server decide" was found to be wrong. But it
was implemented by an *effect* that writes the resolved year into the draft, and an effect runs
after its render commits.

So between the authoritative read landing and that effect flushing, the screen said *"this bin holds
one crop year: 2026 Corn"*, Save was enabled, and the payload still carried **nothing**. A farmer
saving in that window let the server default instead:

- to a **replacement lot**, if another device had swapped it before the RPC took its bin lock --
  recording a crop the screen never named, which is the silent guess this initiative exists to stop;
- or to **nothing at all** for a lone emptied lot, refusing a ticket the screen was offering, since
  the server defaults only from lots with bushels in them.

The fix puts the lot on the wire from the render that resolved it. `lot` is already computed during
render by `loadLotFor`, from the same list the screen drew, so the payload cannot disagree with what
the farmer was looking at and no longer depends on effect timing at all. The effect still fills the
picker in; it is simply no longer load-bearing.

#### Proved by deleting the effect

The proof is the shape of the claim: **disable the auto-fill effect entirely and the payload must
still carry the lot.**

- With the effect disabled and the OLD payload: the two-crop-year journey fails on
  `expect(next.crop_year).toBe(2025)` with **`Received: undefined`** -- the payload carried no lot,
  exactly as the finding says.
- With the effect disabled and the new payload: the journey passes.

That is the race made deterministic. The window itself is a few milliseconds and could not be
reproduced honestly in a browser; removing the thing the payload used to depend on tests the same
property without pretending to time it.

### A nineteenth round: the mock refused the retry the whole design exists for

One P2. `MockGrainRepository.saveLoad` validated the draft **before** checking whether the ticket id
already existed. So a retry of a blank-year load that had drained the bin's sole lot found no
on-hand lot to default from, was refused outright, and never reached the replay.

The real function does the opposite, and deliberately: round "the replay lookup reads inside the
lock" moved that lookup *inside* the bin lock precisely so an overlapping retry recovers the stored
lot rather than failing on a bin the first call had emptied. So the mock refused the exact
lost-response path LD-1 keeps the ticket id for, and could not exercise it.

The replay check runs first now. The guard is positional, because both lines exist either way and
only their order carries the rule.

**One gap left open and named rather than papered over:** the mock returns the existing load for any
reused id, where the server raises `FARM_RX_LOAD_ID_REUSED` when the id comes back with *different*
details. Implementing that faithfully means matching the server's definition of "different", and
guessing at it is how every divergence on this tranche started. It belongs with the
`MockGrainRepository` test seam that round 15 already recorded as missing, not with a 5am edit.

### A twentieth round, which corrects round 19 rather than extending it

One P2, and it lands on the gap round 19 named and left open. It is right, and the framing there was
wrong twice over.

**First, round 19 made the gap worse, not neutral.** Moving the replay check ahead of the lot
resolution left it an *unconditional return* — so it now bypassed shape validation too. A reused
ticket id with a cleared net amount, a changed origin or different effects came back as a
**successful save**, where the server refuses the payload or raises `FARM_RX_LOAD_ID_REUSED`. Round
19 fixed one step of the sequence and broke another, which is the third time on this tranche a
repair has done that.

**Second, the reason for deferring it does not survive contact with the file.** Round 19 recorded
that implementing the comparison "means matching the server's definition of *different*, and
guessing at it is how every divergence on this tranche started." But the server's definition is not
a matter of guesswork — it is written out plainly, sixteen columns of `and v_existing.x = y`, and it
took one `grep` to find. The deferral was reasoning from an assumption about the code instead of
reading it, on a tranche whose entire history is that mistake.

#### The whole sequence, the server's, step for step

```
shape  ->  lot (recovered from the stored load when no year is named)  ->  replay comparison  ->  save
```

Each of the last three rounds fixed one of those steps in isolation and disturbed its neighbour. The
guard is positional across all of them now, rather than pinning any one step, and it iterates the
sixteen compared columns so a field quietly dropped from the check fails.

The recovery step is the one that matters for the farmer: a retry naming no crop year, whose ticket
id is already saved, resolves to the lot that load was recorded under. That is what stops a bin the
first call emptied from failing the retry, and it is why the comparison has to come after the lot
rather than before it.

### A twenty-first round: the gap the ordering argument did not cover

One P2, in `void_grain_load`, and it is the sharpest of the lock findings because it is not an
ordering mistake at all — the order is right. The bin discovery and the load lookup are **two
statements**, so under read committed they read **two snapshots**:

```sql
v_locked_bins := array(select ... from bin_transactions where grain_load_id = p_load_id);
perform public.lock_farm_bins(p_farm_id, v_locked_bins);   -- snapshot A: no movements, no bins
select * into v_load from public.grain_loads ... for update; -- snapshot B: the load is there
```

If the save commits between them, the void holds the load row having locked **nothing** — and
`append_bin_movement` then waits for a bin that a retry of that save is holding, while that retry
waits for the load row. Exactly the deadlock `lock_farm_bins` exists to prevent, through the one gap
the ordering argument does not reach.

**Locking the missing bin at that point is not the fix — it *is* the violation**, a bin lock taken
while holding the load row. So the function confirms its set instead and refuses, and the farmer
retries; the retry's discovery sees the committed movements and locks them in order.

The signal is deliberately not "the set is empty": a ticket-only load legitimately moves nothing.
What cannot be true is a movement of this load in a bin **outside** the set that was locked.

Reachability is narrow — it needs a void issued for a load id whose save commits inside a
microsecond window — and the repair is ten lines that add a refusal rather than move a lock. Given
this module has produced four deadlocks already, a checkable invariant is worth more than an
argument that the window is small.

### A twenty-second round, which corrects the round-17 audit

One P2: a load's bin-out effect was pushed straight into `bin_transactions` with **no balance check
at all**. Name an emptied lot with the effect on, and a mock-backed workflow creates negative
inventory — a save the real `append_bin_movement` refuses with `FR001`.

**This is the sixth stand-in found disagreeing with the server, and it corrects what round 17
claimed.** That round audited the grain stand-ins and reported the remaining ones "read and sound".
It checked what they *return*. It did not check what they *refuse*. A read that answers correctly
and a write that enforces nothing are different kinds of fidelity, and only one of them was looked
at. The audit's conclusion was too broad, and this finding is the proof.

#### One refusal path, rather than a second copy of four guards

`append_bin_movement` makes four refusals before it writes. The mock's *manual* movement path had
three of them; the *load* path had none. Writing the missing ones into the load path would have
been a second copy of arithmetic that has already drifted three times on this tranche.

So they now live in one function, `binMovementRefusal`, and both writers go through it. The guard
counts the **call sites**, not the string, so a writer that stops using it fails.

The fourth refusal — the **lot** balance, the same arithmetic narrowed to one crop year — was
missing from the manual path too. It is in the shared function now, so the manual movement form
gained a guard it never had, matching the server. Nothing broke when it did: the browser suite and
all regression files pass unchanged, which is the evidence that the manual path had simply never
exercised the case.

### Proof observed for round 22

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together.**
- Static guards PASS; **mutation drill 392/392**. Two added: the load writing its movements
  unchecked, and the refusal path stopping at the commodity balance.
- **Browser: 129 passed, 15 skipped**, unchanged by giving the manual path a guard it lacked.
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

#### What the corrected audit now says

Six stand-ins found disagreeing with the server on this tranche, all fixed: `listBinLots`,
`saveLoad`'s lot list, `lotBalance`, the browser fixture's `bin_lots`, its `void_grain_load`, and
now the load's movement writes. **Five were reads or returns. The sixth was a refusal**, and it was
the one the audit's method could not have found.

An audit of what stand-ins refuse — every write path in the grain mock against its RPC's guards —
has not been done. It is the obvious next thing, and it is not done here.

### Proof observed for round 21

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together**, with a new **section 10l**: the confirmation
  exists, sits after the load row is taken, and does not key on an empty set. **Run with the
  confirmation removed it fails**, naming it.
- Static guards PASS; **mutation drill 390/390**. Two added — the confirmation removed, and the
  void confirming a second read rather than the set it holds — and **two retargeted**, because they
  pinned the inline array this change replaced with a captured variable.
- **Browser: 129 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 20

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together.**
- Static guards PASS; **mutation drill 388/388**. Three added — the comparison removed, a compared
  column dropped, and the shape check removed — and **three existing mutations retargeted**, because
  they pinned expressions this restructure renamed and would have failed to apply rather than
  failing to detect.
- **Browser: 129 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 19

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together.**
- Static guards PASS; **mutation drill 385/385**, one added for the ordering.
- **Browser: 129 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 18

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together.**
- Static guards PASS; **mutation drill 384/384**. One added for the synchronous payload; one
  existing mutation rewritten, because it pinned the old expression and would otherwise have failed
  to apply rather than failing to detect.
- **Browser: 128 passed, 15 skipped**, plus one rerun. The phone journey "two tabs append
  notification work" failed once and passed on rerun -- the notification-queue flake recorded
  earlier in this initiative, not Grain, and not the Soil Rx one.
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 17

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together.**
- Static guards PASS; **mutation drill 383/383**, count changed in both files that pin it. Two
  added: the fixture voiding the first load rather than the one asked for, and the fixture unable to
  answer `blocked` at all.
- **Browser: 129 passed, 15 skipped.** The new journey was run with the blocked-void refresh removed
  and **fails there**, showing the stale 5,000 bu.
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

#### The audit's standing result

Five grain stand-ins have now been found disagreeing with the server on this tranche, and all five
are fixed and guarded: `MockGrainRepository.listBinLots`, its `saveLoad`, its `lotBalance`, the
browser fixture's `bin_lots`, and the browser fixture's `void_grain_load`. The remaining grain RPC
fixtures — `save_grain_load`, `edit_grain_contract`, `delete_grain_contract` — were read in the same
pass and **do** mirror their functions on the points this tranche depends on.

The rule this leaves behind, and the reason the count is written down: **a stand-in is part of the
contract, not scaffolding around it.** Four of the five were found by accident. The fifth was found
by looking.

### Proof observed for round 16

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together.**
- Static guards PASS; **mutation drill 381/381**, count changed in both files that pin it. Five
  added, including both halves of the new key and the fixture filter itself — the browser spec is in
  the drill's file set now, which it was not before.
- **Browser: 127 passed, 15 skipped.** The new journey was run against the unrepaired code and
  **fails there**; the two-crop-year journey was run against the unkeyed state and **fails there**.
  Neither is a test that passes beside its repair.
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 15

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together**, unchanged by this round and run to confirm.
- Static guards PASS; **mutation drill 376/376**, count changed in both files that pin it.
- **Browser: 125 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 14

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together**, unchanged by this round and run to confirm.
- Static guards PASS; **mutation drill 374/374**, count changed in both files that pin it. Two
  added: the fence removed, and the queued path reaching past the writer that carries it.
- **A new repository coverage group**, on a method that had none, proved by reverting the fence.
- **Browser: 125 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

#### What this round says about the tranche

Fourteen rounds, twenty-four findings, twenty-three of them real. The three that matter most for
what to do next were all found in the last four rounds, and all three were in code **this tranche
added**: a mock that could not exercise the path it was built for, a rule of mine that stranded the
farmer it was written to protect, and a read that skipped the fence every other read takes.

The pattern is not carelessness in any one edit. It is that **new surface arrives without the
obligations the surrounding code already has** — a new repository method that nobody thought to
fence, a new mock method that nobody thought to cover, a new state flag whose lifecycle nobody
thought through. Each was correct in the small and wrong in the context it joined.

### Proof observed for round 13

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together**, unchanged by this round and run to confirm.
- Static guards PASS; **mutation drill 372/372**, count changed in both files that pin it. Three
  added, including both directions of the rule: a refusal that keeps its lot frozen, and a lost
  response that lets it go.
- **Browser: 125 passed, 15 skipped** — one new journey, on desktop and phone, covering both
  findings. **Run against the unrepaired code first, where it fails.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Proof observed for round 12

Re-run in full rather than assumed, because this round changed a derivation the form shares.

- `npx tsc -b --force`; `npm run build`; `npm audit --audit-level=high` — 0 vulnerabilities;
  `git diff --check` clean.
- **Eleven disposable SQL suites pass together**, unchanged by this round and run to confirm.
- Static guards PASS; **mutation drill 369/369**, count changed in both files that pin it. Six new
  controlled mutations, and **one earlier mutation removed rather than kept**: its rule moved out of
  the mock into `grain.ts`, and it is mutated there now in both directions — dropping the emptied
  lots, and collapsing either branch of the named/unnamed split.
- **Twenty browser regression groups**, the twentieth pinning the server's two-list rule. It
  includes an assertion on the behaviour being replaced, so it fails against the old code rather
  than passing beside it.
- **Browser: 123 passed, 15 skipped.**
- **All regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`; the three PowerShell lanes are not runnable in this sandbox.

### Live steps

**One migration to apply: `20260921180000_ld4_bin_origin_lot.sql`**, after LD-2's. It now also
replaces `append_bin_movement`, `assign_bin_movement_crop_year` and `void_grain_load`, and adds `lock_farm_bins`, for the baseline and locking corrections above — every other guard,
message and error code in that function is LD-2's, unchanged.

Until it is applied the
capability probe reports false, the form offers no crop year choice, and the derivation answers
exactly as LD-1 did — because that is what the installed `save_grain_load` will accept. This is
LD-006 finding 1's lesson applied in the other direction, and it is guarded and mutation-tested
rather than assumed.

## LD-008 — three more findings Codex raised on the merged LD-3

**Branch:** `claude/ld3-codex-fixes`, cut from `main` `8716da0`.
**Numbering:** LD-007 is LD-4 (`claude/ld4-bin-origin-lot`, PR #54), open at the same time as this.
It landed on `main` first, as #55, and LD-007 followed in the merge that resolved
their conflict -- so the numbers read in order here and out of order in the history.
**Context:** Codex reviewed PR #52 twice — once when the draft was marked ready, once on the merge
commit — and both reviews finished after the merge. **This is the second time in one evening that
findings have landed on `main` rather than on an open PR**, and the cause is the same: marking a PR
ready is part of merging it, so the review has no window in which to gate. LD-006 recorded this as
a process note. It is now a pattern, and the remedy is the same: mark a PR ready several minutes
before merging it.

All three findings were verified against the code rather than taken at face value. **All three are
real.** Two are fixed here. The third is a P1 that needs its own tranche and is recorded with a
proposal rather than half-fixed.

### Fixed here

**1. Unresolved movements that cancel out stopped being named at all.** (P2)

`CommittedFreeLine` filtered the unknown-crop-year bucket on its **net bushels**. An unresolved
1,000 bushels in and 1,000 out net to zero, so the bucket vanished — but those are still two
movements with no crop year, and naming their years can put a thousand bushels into one year and
take a thousand out of another. **The filter hid exactly the rows whose resolution moves the figures
most.** A member who cannot open the owner-and-manager reconciliation screen got no hint they
existed.

The bucket is now kept by `movementCount`, which `UnknownCropYearBushels` has carried since LD-3 —
the right field was already there and the wrong one was being read. The sentence names movements
rather than a net: *"Corn in 2 movements that cancel out today"*, and it now says plainly that
naming their crop year **can change the figures above even where the movements cancel out today**.

**2. An empty state that could never be true.** (P2)

When there were no crop-year figures the component printed *"Nothing stored or contracted yet."* —
directly above a paragraph listing unresolved bushels. A farmer whose bin was filled entirely by
pre-LD-2 movements was told their farm held nothing.

The finding is sharper than it was reported. This component **returns null when it has neither lots
nor unknown movements**, so reaching that branch always meant unknown movements existed. The
sentence was not merely sometimes wrong: **it could never be right.** It is deleted rather than
reworded, and a guard keeps the string out of the file.

### Not fixed here, and why

**3. Farm totals are derived from a workspace that may be truncated.** (P1)

`loadWorkspace` reads `bin_transactions`, `grain_contracts` and `grain_contract_deliveries` with no
bound and no pagination. PostgREST caps rows, and this codebase already knows it: the cash-bid slice
carries a comment saying so, and **GL-2's defect was this exact shape.** `bin_transactions` is
ordered newest-first, so under a cap **the oldest movements drop first** — and an old post-baseline
movement is precisely what a lot balance depends on. A farm with enough history would be shown
wrong stored, committed and free bushels, silently.

Verified as real. Two things worth stating precisely:

- **It is older than LD-3.** `binLedger` and the per-bin figures have always read this table the
  same way. LD-3 did not introduce the exposure; it widened what depends on it, and LD-4 widens it
  again by feeding the load form's lot picker from the same rows.
- **The database is still the authority.** `save_grain_load` reads `public.bin_lots` server-side and
  `append_bin_movement` guards the balance under a row lock, so a truncated browser view can show a
  wrong figure but cannot write a wrong movement. That bounds the damage to display, which is bad
  enough — showing a farmer bushels they do not have is what this initiative exists to stop.
- **Whether the cap actually bites on this project is unverified.** The sandbox cannot reach
  Supabase, so `db-max-rows` could not be read. The finding stands on the codebase's own recorded
  experience of the cap, not on a measurement.

**Proposed fix, for its own tranche.** Paging the whole ledger into the browser on every workspace
load is the wrong shape: `bin_transactions` is append-only and grows forever, and this runs on a
phone in a truck. The lot figures should be computed **in the database** — a farm-level aggregate
beside `public.bin_lots`, behind a capability probe, with the current derivation kept as the
offline fallback and the disposable suite proving the two agree. That is a migration, a gateway
read, a capability and its proof: a tranche, not a repair.

### Proof observed

- `npx tsc -b --force`; `npm run build`; `git diff --check` clean.
- **Ten disposable suites pass together** (unchanged by this branch; run to confirm).
- Static guards PASS with **two new guards**; **mutation drill 329/329**, count changed in both
  files that pin it.
- **A new browser journey** on a bin with no baseline, no contracts and two unresolved movements
  that net to zero. **Both fixes were reverted in the working tree and the journey failed**, so it
  proves the repair rather than merely passing beside it.
- **Browser: 120 passed, 15 skipped.** One unrelated phone journey — "two tabs append notification
  work" — failed once and passed on rerun. It touches the notification queue, not Grain, and is not
  the Soil Rx flake.
- **All 65 regression files run individually.** Only `programInventoryCW2` fails, identically to
  `origin/main`.

### Live steps

**None.** This is display-only: no migration, no write path, no schema. Merging deploys the client.

## LD-009 — LD-5: a hand-entered bin movement names its crop year

**Branch:** `claude/app-improvement-strategy-kzqk6s`, on `main` `daef330`.
**Authority:** the limit LD-004, LD-005 and LD-007 each recorded and each called the recommended next
change. Mason asked for it to be built on 2026-09-26.

### What was actually wrong

The form was not the only gap. **`binTransactionColumns` in `SupabaseGrainDataGateway.ts` never sent
`crop_year`**, although `append_bin_movement` has read it since LD-2. So even a form that asked would
have saved every hand-entered movement into the unknown-year bucket. Both are fixed here.

### What changed

- **The movement form asks "Crop year".** Out offers only the lots the bin still holds for that crop;
  in offers the bin's own lots, the years the crop is planted, and this year and last. A year is
  filled in only when the bin holds exactly one lot of that crop, and only from a settled read.
  Saving without one is refused before any id is spent, in the farmer's words.
- **The rule is one pure function**, `manualMovementCropYears` in `src/data/grain.ts`.
- **The bin's lots are asked of `public.bin_lots`**, with the answer keyed to its bin and refresh --
  the load form's LD-4 repairs, reused rather than rediscovered. Out fails closed while that read is
  loading or unavailable, as the load form does.
- **A bin holding only pre-LD-2 grain offers nothing to take out**, and says to name those movements
  under "Which crop year were these?" first. That is the load form's rule too; neither guesses.
- **The repository refuses a response that lost the crop year** ("could not confirm the movement
  saved"), so an old server silently dropping the key is not reported as a save.
- **The mock compares crop year on a replayed id**, as the server does.
- **Gated on both `grain_load_effects` and `grain_load_bin_lot`.** Written with `??` rather than
  `!== false` because the load form's identical checks are pinned by exact text; a second copy above
  them shadowed an existing mutation, which the drill caught.
- **Season fence:** `bin_lots` added to `readOnlySeasonAccessRpcs`. The Grain page has probed it on
  load since LD-4, so the season lanes would already have flagged it; the maple and harvest-ridge
  journeys now pick 2027 on their inbound movements and wait for the lone lot on their outbound ones.

### Proof observed

- `npx tsc -b --force`; `npm run build`; `git diff --check` clean.
- Static guards PASS with **three new guards**; **mutation drill 395/395**, count changed in both
  files that pin it.
- **A new browser journey** on a bin whose second lot exists only in `bin_lots`. It passes on desktop
  and phone. **With `crop_year` removed from the gateway column list it fails** — *Expected 2025,
  Received undefined* — so it proves the gateway fix, not only the form.
- **Browser: 130 passed, 15 skipped, 1 failed** with the new journey included, against the
  sandbox's Chromium 1194 through a throwaway config, as in LD-004. The failure was the known Soil Rx
  custody flake ("drains custody after lost Storage and row-delete responses", desktop); it touches
  no Grain code and **passed 6 of 6** when rerun three times on each project.
- **All 67 non-PowerShell regression files run.** Only `programInventoryCW2` fails, identically to
  `main`. The receipt regression now proves an unanswered year saves nothing and every saved
  movement carries its year; `loadOriginLot` gains a coverage group for the rule.
- **Season lanes not run**: they need PowerShell and Docker, which this sandbox has neither of.

### Live state, recorded because the ledger said otherwise

On 2026-09-26 the live database was found **eight migrations behind** `main` (Soil Rx storage,
FS persist, GL-1, GL-2, GL-3, LD-1, LD-2, LD-4), not two. All eight were applied that day under
Mason's approval through the Supabase connector, each fingerprinted and recorded under its real
version (`scripts/live-migration-sql.mjs`, PR #58); the live history now lists all 60 files.
`deliver-grain-alert` was redeployed as version 7 so its re-check uses `latest_eligible_cash_bid`.

### Live steps

**None.** No migration. `append_bin_movement` already stores `crop_year`. Merging deploys the client.

### Limits, stated rather than implied

- **Existing unknown-year movements stay unknown** until an owner or manager names them. This stops
  the bucket growing; it does not empty it.
- **"In" to an empty bin always asks**, even at harvest when the answer is usually this year. That is
  one tap, and the alternative is the guess this initiative exists to prevent.
