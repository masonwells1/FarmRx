# Soil Rx initiative ledger

This file is append-only. Corrections must be recorded as later entries; prior entries are never edited, reordered, or deleted.

## SRX-000 — Initiative preflight and authority

- **Date/time:** 2026-08-10 17:25:19 (`America/Chicago`, UTC-05:00).
- **Owner authority:** Mason Wells authorized local build, test, and commit work for the three sequenced Soil Rx tranches SRX-1 through SRX-3. No push, pull-request mutation, merge, deployment, live migration, live data, secret/auth/permission change, customer action, destructive action, or other outward action is authorized.
- **Controlling scope:** `docs/GOAL.md`, section `Owner scope amendment — 2026-08-10`, and `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`.
- **Base and branch:** current `origin/main` exact SHA `e723c509f65fc82abbeafba625071207425892e0`; local branch `codex/farmrx-soil-rx`; isolated writer worktree `C:\Users\mason\.codex\worktrees\farmrx-soil-rx`.
- **Preflight result:** PR #23 was verified merged at the exact base SHA. The amendment contains SRX-1 soil test storage, SRX-2 descriptive interpretation, and SRX-3 nutrient removal. The branch and worktree were newly created from that exact `origin/main` with no pre-existing Soil Rx branch or worktree.
- **Safety boundary:** all database proof will use a disposable local backend built from repository migrations and synthetic fixtures. The Farm Rx live Supabase project and CRX Manager project are out of bounds. The Grain, Harvest, bin, contract, delivery, Weather, Programs, and Inventory implementation surfaces are fenced from writes by this initiative; SRX-3 may consume Harvest actuals read-only through existing interfaces.
- **Next gate:** inspect existing architecture and present a plain-English SRX-1 plan to Mason. No SRX-1 product code may be written until Mason approves that plan.
