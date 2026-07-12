# TASK — Feature E review fixes (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Fix EVERY item, then report with proof. Do NOT git commit. Do NOT run a dev server.
You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`. RUN tsc YOURSELF and fix
ALL errors before reporting.
Files in scope: `src/sw.ts`, `vite.config.ts`, `src/NotificationsModule.tsx`,
`src/data/SupabaseNotificationsRepository.ts`, `src/styles/app.css`,
`src/data/SupabaseNotificationsRepository.regression.ts`.

## P1 — the injectManifest switch broke PWA offline (a previously-proven feature). RESTORE it.
`src/sw.ts` + `vite.config.ts`: switching generateSW→injectManifest dropped two behaviors:
- No navigation fallback to cached `index.html` → offline reload / direct-launch of `/weather`,
  `/notifications`, etc. can fail (white screen offline).
- No `skipWaiting()`/`clientsClaim()` → `registerType:'autoUpdate'` can't promptly activate.
FIX in `src/sw.ts`: keep the existing `precacheAndRoute(self.__WB_MANIFEST)`, then register a
Workbox `NavigationRoute` served by `createHandlerBoundToURL(<precached index.html>)` (import from
`workbox-routing`/`workbox-precaching`), and add `self.skipWaiting()` + `clientsClaim()`. Confirm
`npm run build` still emits the SW with the full precache and the app loads offline (state what you
verified). Do NOT lose the push/notificationclick handlers.

## P2
### P2-1 — mark-read marks locally even on a server no-op ({updated_count:0})
`SupabaseNotificationsRepository.ts:26` + `NotificationsModule.tsx:25`: a valid {updated_count:0}
is discarded and every requested notification is shown read locally (an own-only server no-op looks
successful). FIX: propagate updated_count; apply the optimistic read ONLY when the count equals the
number of rows requested, otherwise reload canonical server state. Offline mark-read shows PENDING,
not confirmed-read.
### P2-2 — bell badge stale after "Mark all read"
`NotificationsModule.tsx:13`: the bell reloads only on route change, so the unread badge stays stale
after mark-all-read until navigation. FIX: share notification state or explicitly refresh/invalidate
the bell immediately after any mark-read.
### P2-3 — push subscribe reports "on" even when server save failed
`NotificationsModule.tsx:26`: if the browser subscribe succeeds but save_push_subscription fails, the
catch calls checkPush() which sees the local subscription and reports alerts ON (server can't send).
FIX: on save failure, unsubscribe the just-created browser subscription and reconcile; the on/off
state must reflect BOTH browser subscription AND a successful server save. Same care on turn-off.
### P2-4 — SW push handler throws on missing/null data
`src/sw.ts:8`: missing push data → undefined payload; JSON null likewise; line 10 then throws and NO
notification shows. FIX: validate parsed data is a plain object; use `{}` for absent/invalid; cap
title (<=160) and body (<=500). Keep the correct link-validation + focus-before-openWindow behavior.

## P3
### P3-1 — 'default' permission mislabeled as 'denied'
`NotificationsModule.tsx:26`: dismissing the prompt returns 'default' but the UI says denied / change
browser settings. FIX: 'default' = an off/not-enabled state ("Turn on phone alerts"); reserve the
denied message for actual 'denied'.
### P3-2 — text below 18px
`app.css` (~L76 unread badge 13px, ~L92 list time/category 16px): raise to 18px baseline. (Badge may
stay visually small if needed but keep >=18px per the rule — confirm nothing else is under 18px.)
### P3-3 — regression not SQL-faithful + gaps
`SupabaseNotificationsRepository.regression.ts:17`: the fake returns 1 on idempotent replay whereas
the real RPC returns 0. FIX: make the fake mirror the real mark-read (already-read/other-user ids →
not counted; replay of an already-read id → 0). Add cases: zero-echo UI honesty (P2-1), bell-count
invalidation, two-entry FIFO ordering, transport-vs-blocked, corrupt-envelope sync status, malformed
push payloads (if the SW logic is unit-testable), offline navigation intent, failed push-subscription
persistence rollback. Update the coverage-group count.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean (SW still emits full precache) · `npm run
regression` ALL pass with the enlarged notifications suite (state group count). FINAL: per-fix
confirmation, proof output incl. what you verified about the SW offline route, `git status`,
deviations. Do NOT commit.
