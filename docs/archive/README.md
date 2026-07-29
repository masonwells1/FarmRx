# Archive

Docs for work that is **finished** — shipped, merged, and live, or a review whose
findings are all dispositioned. Moved out of the active `docs/` folders so the live
folders only hold in-flight work.

⚠️ **Verify current live behavior in code and the live database before acting on
anything in here.** Statuses inside these files are frozen at their last edit.
Nothing is deleted — everything below is still in git history and readable in place.

## What is here

- **`goals/`** — the 2026-07-11 first-customer-ship goal.

### Moved 2026-07-26

- **`audits/2026-07-16-farmer-simplicity-loop/`** (280 files, from `docs/audits/`) —
  the full prompt/output transcript of the Farmer Simplicity multi-agent loop
  (Sol / Terra / Luna tranche reviews plus their runner scripts). Its
  `ORCHESTRATOR-LEDGER.md` records the close: no HIGH or MEDIUM finding remained,
  Mason authorized the release on 2026-07-17, and the work merged and shipped.
  - Note: the ledger carries one open LOW follow-up — direct browser coverage of the
    auth local-storage fallback.
- **`audits/2026-07-15-sol-foundation-review/`** (83 files, from `docs/audits/`) —
  Sol's foundation review and its repair loop. Verdict went NOT SOLID →
  CONDITIONALLY SOLID pending deployment of migrations `0036`–`0037`; both are now on
  `main` and applied live (the live ledger sits at `20260720233500`), so the
  conditional has been met and this folder is closed history.
- **`build-notes/`** (127 files, from `docs/build-notes/`) — raw per-agent design and
  implementation output dumps from the original module build. Nothing outside this
  folder referenced them.

Kept live on purpose: `docs/audits/2026-07-13-foundation/` (its REPAIR-LEDGER still
has open onboarding-gate checks that need Mason), the two 2026-07-18 audit notes, and
every design/schema/review doc at the root of `docs/`.
