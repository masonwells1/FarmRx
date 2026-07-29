# TASK — FOUNDATION BLOCK design (Sol, workspace-write)

PRE-APPROVED: You are authorized to write the deliverable files listed below inside this
repository. Do NOT modify any other files. Do NOT run the app, do NOT apply anything to any
database, do NOT touch git.

## Mission
Design the FOUNDATION BLOCK for Farm Rx: real Supabase auth + mock→live repository swap for
Fields, offline write-queue at the repository seam, and the employee grain/financial privacy
fix as a DRAFT migration. Terra implements from your design next, so be concrete: file names,
module boundaries, function signatures, exact behaviors.

## Read first (facts, not memory)
- docs/farm-rx-handoff.md — the three rules (18px/48px, data privacy + RLS, brand wrapper)
- supabase/migrations/0001_module1_fields.sql, 0002_module1_rls.sql, 0003_harden_bootstrap_function.sql
  (or whatever the three module-1 files are named) — these are APPLIED to the live farm-rx DB
- supabase/migrations/0004*.sql, 0005*.sql (grain), 0006*.sql, 0007*.sql (profitability) —
  DRAFTS, NOT applied; note the FOUNDATION PRIVACY HOOK comments in 0005/0007
- src/data/index.ts, src/data/MockFieldsRepository.ts, src/data/MockGrainRepository.ts —
  the repository seam the UI depends on (UI code must not change in this block)
- src/data/MockFieldsRepository.regression.ts + MockGrainRepository.regression.ts — behaviors
  any live repository must also honor (fail-closed errors, confirmed writes, grain/fields
  compartment separation)
- src/App.tsx and the current fake login/nav shell

## Database truth (verified 2026-07-11 15:06 via Supabase API — trust this over docs)
- Project: https://agvsozfbstpekuqxpqjr.supabase.co (free tier, empty of user data)
- Applied migrations: 20260711154223 module1_fields, 20260711154325 module1_rls,
  20260711154407 harden_bootstrap_function — NOTHING ELSE
- Tables (public, all RLS-enabled, 0 rows except commodities=6):
  farms, farm_memberships, farm_rep_access, entities, fields, commodities, crop_assignments, arrangements
- Grain tables DO NOT EXIST yet (0004/0005 unapplied). Profitability tables DO NOT EXIST (0006/0007 unapplied).

## Client credentials decision (already made — design around it)
Project guardrails DENY writing .env files. The Supabase URL and PUBLISHABLE key are public
by design (shipped to every browser; RLS is the real protection), so they live in a small
committed config module instead, e.g. src/lib/supabaseConfig.ts:
- url: https://agvsozfbstpekuqxpqjr.supabase.co
- publishableKey: sb_publishable_NonG7JNpCB3jqHwEq4xhLg_hY7fAwnM
Design this module with a clear comment: PUBLIC client credentials only; secrets never go in
this file or anywhere in the repo.

## Deliverables (write these files)

### 1. docs/foundation-design.md
The implementation blueprint. Must cover:
- **Auth**: supabase-js email/password sign-in wired into the existing login screen; session
  persistence + auto-refresh suitable for a PWA; signed-out redirect behavior; how the first
  real user bootstraps their farm (read what harden_bootstrap_function actually provides and
  design the client call); loading/error states in plain farmer English (18px, no jargon).
  v1 scope: sign-in + sign-out + session restore. Decide and justify whether v1 includes
  self-serve sign-up or owner-provisioned accounts (remember: Crop RX sets customers up).
- **SupabaseFieldsRepository**: implements the exact same interface as MockFieldsRepository
  (UI unchanged). Map every repository method to tables/queries. Preserve the proven mock
  behaviors: fail-closed on errors (never pretend a save succeeded — the confirmed-write
  principle), crop-assignment ID preservation, optional-field round-trips. State how each
  regression-suite behavior translates to the live implementation.
- **Repository selection seam**: how the app picks mock vs live per module. Fields → live,
  Grain → STAYS MOCK until 0004/0005 are applied (design the one-line swap for later).
  Must be impossible to accidentally point at the wrong backend.
- **Offline write-queue (design at the repository seam)**: v1 scope = a farmer's entry is
  NEVER lost on bad signal — queue writes durably (localStorage, separate key from the mock
  data envelope), replay in order on reconnect, surface honest pending/synced status, define
  the conflict policy plainly (v1 may be last-write-wins with a stated rationale). NOT full
  offline browsing. Design it so Terra can build a thin, testable version.
- **Regression plan**: what an executable regression for the live repo looks like without
  hitting the network (adapter/fake boundary), plus which checks must run against the real
  dev DB once, manually.
- Include a **"Plain English for Mason"** section at the top: what changes for the user,
  what stays the same, what stays practice-mode.

### 2. supabase/migrations/0008_employee_privacy.sql — DRAFT ONLY (never applied by you)
The employee grain/financial privacy fix promised by the hooks in 0005 and 0007:
- Grain reads + profitability reads become owner/manager-only by default.
- A per-member grant (e.g. can_view_financials on farm_memberships or a permissions table —
  your call, justify it) lets an owner deliberately share with a specific employee.
- Assumes 0004–0007 are applied before it; do NOT modify files 0001–0007 themselves.
- Keep rep-access behavior (farm_rep_access + share toggle) exactly as designed in 0005/0007.
- Follow the proven conventions from 0001–0007 (security definer helpers where already used,
  composite FK farm stamps, no policy that trusts client-supplied farm_id).

### 3. Plain-English explainer for 0008
Either a section in docs/foundation-design.md or docs/schema-foundation.md — owner-readable,
same style as docs/schema-module4.md.

## Hard constraints
- DRAFTS ONLY: nothing is applied to any database. No git commands. No app runs.
- Do not modify src/ code, existing migrations, or docs other than your deliverables.
- Never reference the live CRX-Manager database anywhere.
- FINAL chat message: a short summary (deliverables written, key decisions, open questions
  for the owner if any). The files are the deliverable, not the message.
