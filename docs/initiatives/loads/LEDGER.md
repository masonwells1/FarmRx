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

## LD-008 — three more findings Codex raised on the merged LD-3

**Branch:** `claude/ld3-codex-fixes`, cut from `main` `8716da0`.
**Numbering:** LD-007 is LD-4 (`claude/ld4-bin-origin-lot`, PR #54), open at the same time as this.
If this entry lands on `main` first there will be a gap until #54 merges; that is the reason for it.

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
