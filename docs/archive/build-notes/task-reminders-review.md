# TASK — Adversarial review: Feature E app-side (notifications + push client) (Sol, read-mostly)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure. Review
fully, then report. Do NOT fix, do NOT commit, do NOT run servers. You MAY read any file and run
`npx tsc -b --force` / `npm run regression` (repo-local binaries if the shim is broken).

## Scope
Feature E app-side built by Terra on applied migration 0023 (notifications + push_subscriptions;
RLS own-only read/update, direct UPDATE limited to read_at, no direct insert; RPCs
create_notification [dedupe-idempotent], mark_notifications_read [own-only], save/delete_push_
subscription). Spec: `docs/reminders-design.md`. Review NEW: `src/NotificationsModule.tsx`,
`src/data/notifications.ts`, `NotificationsDataGateway.ts`, `SupabaseNotificationsDataGateway.ts`,
`SupabaseNotificationsRepository.ts`, `QueuedNotificationsRepository.ts`,
`notificationsWriteQueue.ts`, `createSupabaseNotificationsServices.ts`, `pushConfig.ts`,
`src/sw.ts` (custom service worker), `SupabaseNotificationsRepository.regression.ts`. CHANGED:
`App.tsx`, `WeatherModule.tsx` (spray-good hook), `ScoutingModule.tsx` (follow-up hook),
`index.ts`, `backends.ts`, `syncStatus.ts`, `styles/app.css`, `vite.config.ts` (PWA→injectManifest).

## Hunt hard (rank P1/P2/P3, file:line + concrete failure)
1. **Service worker / PWA offline not broken** — vite.config switched generateSW→injectManifest.
   Confirm `src/sw.ts` KEEPS the workbox precache/offline (precacheAndRoute of the injected
   manifest) AND adds `push` + `notificationclick` handlers correctly. A broken SW would break the
   whole app's offline + updates. Does the push handler parse the payload safely (missing/oversized
   body, no data.link)? Does notificationclick focus an existing client before openWindow?
2. **Read semantics + unread count** — notifications are read via direct RLS SELECT; confirm the
   query is scoped/ordered correctly and unread count matches (read_at is null). mark-read echo
   validation ({updated_count}); idempotent replay same ids; a mark-read of someone else's id is a
   silent no-op (RPC own-only) — the UI must not show it as read locally if the server didn't.
3. **Generation hooks are best-effort + deduped + non-blocking** — spray-good
   (dedupe spray:<field>:<date>, only on not-good→good transition, only for the signed-in user)
   and scouting follow-up (dedupe scouting:<noteId>). CONFIRM a create_notification failure NEVER
   blocks/breaks the underlying save (weather render / scouting save) — must be caught+swallowed.
   Confirm the spray hook does not spam (fires once per field/day, not every render/refresh).
4. **Push subscribe flow honesty** — support check (serviceWorker+PushManager+Notification);
   permission denied / unsupported / insecure-context states are honest and do not crash; VAPID
   public key correctly converted to Uint8Array (urlBase64ToUint8Array); on/off UI reflects the
   ACTUAL subscription (getSubscription), not just a local flag; save/delete_push_subscription
   wired; never handles a private key.
5. **Write queue** — versioned key, FIFO, canonical echo, idempotent replay, blocked-vs-transport,
   corrupt envelope fail-closed; App.tsx notifications replay AFTER Fields.
6. **Brand/rules** — bell + count tabular-nums, 18px/48px, plain English, nav word not a medical
   metaphor; 375px no overflow; list empty/loading/error calm.
7. **Regression realness (5 groups)** — mark-read + wrong-echo + idempotent replay + unread-count
   + category fail-closed + corrupt envelope. Name missing critical cases (e.g. own-only mark-read
   local-state honesty). Confirm it runs.

## Output
Run `npx tsc -b --force` and `npm run regression`; state real results. Findings ranked P1/P2/P3
with file:line + failure + fix. One-line verdict: SHIP-AFTER-FIXES (list P1s) or CLEAN.
