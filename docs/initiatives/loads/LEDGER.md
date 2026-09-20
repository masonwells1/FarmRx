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
