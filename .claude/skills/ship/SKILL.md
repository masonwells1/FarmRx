---
name: ship
description: Take a Farm Rx change from "build it" to "merged and live" in one pass - branch, build, prove it runs, push, pull request, green checks, merge, production spot-check. Use when Mason says "/ship", "ship it", "ship this", "land it", "get this live", or "build X and ship it". Args: the job, e.g. `/ship add a bushel total to the bins screen`. Follows AGENTS.md and docs/agent-delivery.md; it never loosens a gate.
---

# Ship a Farm Rx change

The job is everything after `/ship`. If there is none, ask Mason what to ship (or ship the work already in this session). `AGENTS.md`, then `docs/agent-delivery.md`, win over this file if they ever disagree.

Keep moving between steps without asking "should I continue?". Stop only at a gate in step 7, or when something fails twice and you have no safe next move (then `NEEDS MASON - DECISION REQUIRED`).

## 1. Branch

`git status --short --branch`. Never work on `main`: use this session's worktree branch or `git switch -c claude/<short-slug>` from current `origin/main`. Preserve anyone else's uncommitted work.

## 2. Size it and plan

- **Small** (one or two files, no database, login, sharing, or offline-save change): say in one line you're taking the light path, then build.
- **Everything else**: post the short plan from `AGENTS.md` (GOAL, DONE WHEN, PLAN, TOUCHING, RISK, `NEEDS MASON: Nothing - continuing automatically`) and keep going. The plan is Mason's chance to say stop.

## 3. Build

Follow `docs/agent-development-guide.md` (simplest complete change, existing patterns, Farm Rx invariants). A database change is a **new** file in `supabase/migrations/` with RLS for any new table.

## 4. Prove it runs

Run what the change reaches, and fix anything red before moving on:

| Change touches | Run |
|---|---|
| Any TypeScript | `npx tsc -b --force` |
| Data, queues, saves, auth, grain, inventory, money math | `npm run regression` |
| Shared UI, routing, config | `npm run build` |
| Anything a farmer sees | Start `farm-rx-dev-worktree` from `.claude/launch.json`, open the screen, use it, check the console, and check phone width |

Tests passing is not proof on its own: say what you ran and what you saw.

## 5. Review: yours, then Luna's

1. Read the whole diff once (`git diff origin/main...`) as a reviewer: wrong logic, missed callers, leftover debug code, anything outside the job. Fix what you find.
2. Commit, then run `node scripts/luna-review.mjs` (Luna, high effort, adversarial; Mason, 2026-11-06). It can take several minutes, so run it in the background.
   - Exit 0: clean. Exit 1: findings. Exit 2: Luna did not run, which is never a pass; fix the cause and rerun.
   - Check each finding against the code. Fix every real BLOCKER and HIGH, rerun step 4, commit, and run Luna again until none remains. Fix MED/LOW, or list each one you defer in the pull request.
   - A finding you reject needs evidence (file and line showing why it can't happen).
3. Tell Mason in plain English what Luna found and what you did about it.

No CodeRabbit review (Mason, 2026-10-19).

## 6. Commit, push, pull request

1. Commit with a plain message saying what changed and why.
2. `git push -u origin <branch>` (the pre-push hook rechecks TypeScript and refuses `main`).
3. `gh pr create` with auto-merge off. Body: what changed in plain English, proof observed, risk, and whether a migration rides along.
4. Wait for the `foundation` and Vercel checks. A red check or a review comment is a defect: fix it on the **same** PR, run a Luna round on the fix (step 5), push, wait again.

## 7. Merge (standing approval, Mason 2026-09-30)

You may merge your own PR without asking when **all** of these are true. Check them live first:

- `gh pr view <n> --json state,isDraft,mergeable,mergeStateStatus,headRefOid,statusCheckRollup`: open, not draft, mergeable, current with `main`, every check green.
- No unresolved review thread or change request.
- The head SHA is the one you proved, and Luna's last round on it left no BLOCKER or HIGH.

Then: `gh pr merge <n> --merge --match-head-commit <sha>`. Never `--admin`, never `--auto`.

**Stop with `READY FOR APPROVAL`** (and the exact reply Mason should send) instead of merging when the PR:
- changes secrets, logins, who can see or share a farm (RLS, grants, sharing), or permissions;
- deploys an edge function or makes any production change outside the merge;
- deletes or rewrites existing data, or contacts a customer.

## 8. After merge

1. Confirm the merge commit and the Vercel production deploy for it.
2. If the PR carried a migration: apply it with the fingerprinted route in `docs/database-migrations.md` (standing approval for migrations already on `main`). A migration that deletes or rewrites existing rows needs Mason's yes first.
3. Spot-check production with a read-only look at the changed screen. Never create, edit, or delete real farm data to test.

## 9. Close

End with `VERDICT: COMPLETE` (or `READY FOR APPROVAL`, `BLOCKED`, `PARTIAL`): what changed for the farmer, proof observed, PR link and merge commit, rollback (revert the PR), and one recommended next step.
