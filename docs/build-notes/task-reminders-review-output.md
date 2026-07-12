## Findings

### P1

- [src/sw.ts:2](C:/FarmRx/src/sw.ts:2), [vite.config.ts:9](C:/FarmRx/vite.config.ts:9) — Switching to `injectManifest` removed two behaviors previously supplied by `generateSW`:

  - No navigation fallback to cached `index.html`, so offline reload/direct launch of `/weather`, `/notifications`, etc. can fail.
  - No `skipWaiting()` or `clientsClaim()`, so `registerType: 'autoUpdate'` cannot promptly activate updates.

  Fix: register a Workbox `NavigationRoute` backed by precached `index.html`, and add `self.skipWaiting()` plus `clientsClaim()`.

### P2

- [NotificationsModule.tsx:25](C:/FarmRx/src/NotificationsModule.tsx:25), [SupabaseNotificationsRepository.ts:26](C:/FarmRx/src/data/SupabaseNotificationsRepository.ts:26) — A valid `{updated_count: 0}` response is discarded, then every requested notification is marked read locally. An own-only server no-op can therefore appear successful. Fix: propagate the count; only apply the optimistic change when all requested rows were confirmed, otherwise reload canonical server state. Offline writes should display pending rather than confirmed-read.

- [NotificationsModule.tsx:13](C:/FarmRx/src/NotificationsModule.tsx:13) — The bell reloads only when the route changes. “Mark all read” leaves the badge showing the old unread count until navigation or refresh. Fix: share notification state or explicitly refresh/invalidate the bell after mark-read.

- [NotificationsModule.tsx:26](C:/FarmRx/src/NotificationsModule.tsx:26) — If browser subscription succeeds but `save_push_subscription` fails, the catch calls `checkPush()`, which sees the local subscription and reports alerts as on even though the server cannot send to it. The inverse inconsistency can occur during turn-off. Fix: roll back a newly created subscription when saving fails and reconcile browser plus server state during on/off operations.

- [src/sw.ts:8](C:/FarmRx/src/sw.ts:8) — Missing push data assigns `undefined` to `payload`; JSON `null` does likewise. Line 10 then throws and no notification appears. Title/body are also not bounded. Fix: validate that parsed data is a plain object, retain `{}` for absent/invalid data, and cap title/body lengths. Link validation and focus-before-`openWindow` behavior are otherwise correct.

### P3

- [NotificationsModule.tsx:26](C:/FarmRx/src/NotificationsModule.tsx:26) — Dismissing the permission prompt returns `default`, but the UI labels it `denied` and says browser settings must be changed. Fix: retain an off/not-enabled state for `default`; reserve denied for actual denial.

- [app.css:76](C:/FarmRx/src/styles/app.css:76), [app.css:92](C:/FarmRx/src/styles/app.css:92) — The unread badge is 13px and list time/category text is 16px, below the stated 18px baseline. Controls are 48px and numeric text uses tabular figures.

- [SupabaseNotificationsRepository.regression.ts:17](C:/FarmRx/src/data/SupabaseNotificationsRepository.regression.ts:17) — The fake mark-read implementation returns `1` again during idempotent replay, whereas the real RPC returns `0`. The five groups pass, but do not cover zero-echo UI honesty, bell-count invalidation, two-entry FIFO ordering, transport-versus-blocked behavior, corrupt-envelope sync status, malformed push payloads, offline navigation, or failed push-subscription persistence.

The remaining scoped behavior is sound: reads rely on own-only RLS and are deterministically newest-first; unread calculation is correct; weather and scouting generation is deduped, caught, and non-blocking; notification replay runs after Fields; the queue key is versioned and corrupt envelopes fail closed; no private VAPID key is present.

Verification:

- Requested `npx`/`npm` commands encountered the broken global npm shim: missing `C:\Users\mason\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`.
- Repo-local `tsc -b --force`: passed.
- Repo-local execution of the exact `npm run regression` sequence: passed all 14 suites, including “SupabaseNotificationsRepository regression passed (5 coverage groups).”
- No files were edited, committed, or served.

**SHIP-AFTER-FIXES — P1s: restore offline navigation fallback and custom-worker auto-update activation.**