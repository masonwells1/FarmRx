# Terra serialized implementation slice: CSP, revoked-farm recovery, and installed PWA polish

You are the only source-code writer for this slice. Work in `C:\FarmRx` on the existing branch and dirty worktree. Preserve every pre-existing change, including Sol's database/Edge work. Do not stage, commit, push, deploy, change Vercel/Supabase/GitHub state, use real accounts, or touch production. Local tests and a local browser are allowed. Use `apply_patch` for edits.

Read current requirements and source first:

- `CLAUDE.md`
- `docs/farm-rx-handoff.md`
- `docs/GOAL.md`
- `docs/audits/2026-07-15-sol-foundation-review/AUTONOMOUS-REPAIR-LOOP.md` (especially the removed-membership/revoked-grant requirement)
- `docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md`
- `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/TERRA-WORKFLOW-REVIEW.md`
- `vercel.json`
- `src/auth/farmContext.ts`
- `src/data/workspaceCache.ts`
- every versioned localStorage write queue and `needsAttentionStore.ts`
- `src/data/scoutingCleanupOutbox.ts`, `src/data/fieldLocation.ts`, and queue transaction/lease keys
- `src/App.tsx`, the Needs Attention UI, `src/sw.ts`, `vite.config.ts`, `index.html`, and PWA/icon assets
- existing queue, cache, browser, and PWA regressions

## Confirmed current failures

1. The parent-app CSP currently allows `*.tradingview.com` in `img-src`, `connect-src`, and `frame-src`, even though TradingView is intentionally isolated behind the same-origin opaque sandbox page `/market-quote-frame.html`. A read-only preview header check confirmed this deployed parent header. The parent must permit only the local frame; TradingView origins belong only in the frame document's dedicated CSP.

2. When a live membership refresh removes a farm, `fetchAccessibleFarms()` deletes IndexedDB workspace caches but leaves farm-scoped localStorage queues. Immediate replay is blocked because the context disappears, but a later re-grant can replay stale writes. The project requirement is exact: quarantine unsynced work for explicit recovery, remove readable workspace cache, and never automatically replay revoked-farm work. Do not silently delete saved work.

3. Installed iOS/PWA presentation needs a conservative local review: current manifest exposes only one SVG icon, and safe-area handling must remain usable in standalone mode. Fix only concrete gaps that can be proven locally; do not invent a redesign.

## Required outcomes

### A. CSP isolation

- In the parent-app header, remove every direct TradingView origin from `img-src`, `connect-src`, and `frame-src`; `frame-src` should allow the same-origin frame only.
- Keep the dedicated `/market-quote-frame.html` CSP narrowly capable of loading its required TradingView resources.
- Preserve all current Supabase, Open-Meteo, worker, manifest, and security directives.
- Add a deterministic guard/regression that parses `vercel.json` and fails if TradingView reappears in the parent CSP or if the isolated frame loses required restrictions.

### B. Revoked-farm quarantine and recovery

- On a successful live access refresh that removes a farm, atomically/best-effort quarantine all unsynced farm-scoped work before removing its active queue bytes. Cover all current queues, including Fields, location/weather, Field Log, Scouting, Harvest, Inventory, Grain, Profitability, Equipment Tasks, Notifications, Programs, needs-attention records, and farm-specific scouting cleanup entries. Exclude coordination leases from saved work.
- Use an explicit versioned recovery store scoped by project and user but intentionally outside any active farm queue key. Retain original key/module/farm identity, capture timestamp/reason, validate strict shapes, verify write-back, and deduplicate repeat revocation handling.
- Only clear an active queue or outbox entry after its quarantine record is durably read back. If durable quarantine fails, fail closed: do not delete the original queue/cache, and do not publish a newly validated access snapshot that could disguise incomplete cleanup.
- Delete revoked-farm IndexedDB workspace caches and prevent any later automatic replay after access is re-granted. Quarantined items must never be fed directly back to a live queue.
- Provide a visible, plain-language recovery surface that lets the farmer inspect/export or explicitly dismiss quarantined data. Do not provide a one-click automatic retry into a newly granted farm; recovery is manual review. Never silently delete it.
- On sign-out/user-wide access clearing, preserve quarantined records unless the farmer explicitly dismisses them; remove readable workspace caches and active access state.
- Add deterministic regressions for: revoke with empty queues; revoke with multiple queue kinds and needs-attention; durable-write failure; repeated refresh; later re-grant no replay; other farm/user isolation; scouting cleanup partition; IndexedDB cache deletion; explicit dismiss/export behavior.

### C. PWA/iOS concrete polish

- Add appropriate local raster manifest icon assets/sizes and an Apple touch icon using existing Farm Rx branding; do not use network image generation.
- Ensure standalone layout honors safe-area insets without double padding or breaking desktop/mobile browser layout.
- Add/extend local manifest/HTML/static guards and a focused browser assertion where practical.

## Constraints

- No user/business data or provider calls.
- No permission weakening, no auth bypass, no broader cache lifetime.
- Do not use broad `localStorage.clear()` or `indexedDB.deleteDatabase()`; clear only the exact revoked user/farm scope.
- Preserve unrelated preferences/settings unless they contain readable revoked-farm business data under an explicitly farm-scoped key.
- Preserve all existing queue validators and replay idempotency.
- Keep the implementation small and explain plain-English recovery behavior.

## Verification/report

Run focused regressions, TypeScript/build, relevant Playwright/static checks, and `git diff --check`. Append exact results, changed files, before/after behavior, browser proof, and residual physical-device limitations to:

`docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/TERRA-WORKFLOW-REVIEW.md`

Confirm no external mutation, staging, commit, push, or deployment. Stop after this slice.
