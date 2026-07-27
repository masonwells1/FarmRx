# TASK — Feature E build: notification center + push client (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, then report with proof. Do NOT git commit. Do NOT run a dev server.
You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`. IMPORTANT: after adding
code, RUN `npx tsc -b --force` yourself and FIX every error before reporting (a prior task
reported "clean" with 4 real tsc errors — do not repeat that).

## Read first
`docs/reminders-design.md` (authoritative) §2/§3/§4 + `docs/design-brief-codex.md`. Mirror the
field-log/scouting module pattern for the data layer + queue.

## Database is READY (migration 0023 applied)
Tables `notifications` (RLS: read/update only your own rows; direct UPDATE limited to read_at;
NO direct insert) and `push_subscriptions` (own-only). RPCs:
- `create_notification(p_farm_id, p_recipient, p_category, p_title, p_body, p_link, p_dedupe_key)
  returns jsonb` — category in spray|rain|scouting|harvest|service|task|general; dedupe-idempotent;
  caller must can_edit_farm OR be the recipient; recipient must be an active member.
- `mark_notifications_read(p_ids uuid[]) returns jsonb` (own-only; {updated_count}).
- `save_push_subscription(p_endpoint,p_p256dh,p_auth,p_user_agent) returns jsonb`,
  `delete_push_subscription(p_endpoint) returns jsonb` (own-only).
Reading notifications: SELECT directly from `public.notifications` (RLS returns only the caller's,
newest first) — no RPC needed for reads.

## VAPID public key (safe to ship in the client)
`BHSRggdLDW1TGtro9XAhAyr_pqT4I8AymxW6kv8T06SV4LjXAFu4lP2fVp3eKwLkhJoffhwe0Pg5CH_tOSq5otI`
Put it in a client const/module (e.g. `src/data/pushConfig.ts`). NEVER handle the private key.

## Build
### 1. Data layer (mirror field-log)
`src/data/notifications.ts` (types: Notification, NotificationCategory), `NotificationsDataGateway.ts`,
`SupabaseNotificationsDataGateway.ts`, `SupabaseNotificationsRepository.ts`,
`QueuedNotificationsRepository.ts`, `notificationsWriteQueue.ts`,
`createSupabaseNotificationsServices.ts`, `SupabaseNotificationsRepository.regression.ts`.
- getData: select the caller's notifications (RLS-scoped), newest first, with unread count.
- mark-read: one write kind `markRead` → mark_notifications_read; offline queue (versioned key,
  FIFO, idempotent replay same op/ids, blocked-vs-transport). syncStatus key 'notifications'.
- A `raiseNotification(farmId, recipientId, category, title, body, link, dedupeKey)` helper on the
  repository that calls create_notification (used by generation hooks below). It is NOT queued
  (best-effort; a missed reminder is not data loss — never block a save on it, catch+swallow).

### 2. In-app notification center UI
- A **bell** in the nav/header with an unread count badge (tabular-nums). Poll/refresh on
  navigation + a manual refresh; no realtime needed.
- `/notifications` page: list newest-first — category chip, title, body, relative time, tap the
  row → navigate to its `link`; per-row "Mark read" + a "Mark all read" action. Empty/loading/
  error states calm; never blank. 18px/48px/plain English/no medical metaphor; 375px no overflow.

### 3. Phone push subscribe flow + service worker
- In the notification center, a **"Turn on phone alerts"** control. On tap: check support
  (`'serviceWorker' in navigator && 'PushManager' in window && Notification`), request permission,
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID pub
  as Uint8Array> })`, then `save_push_subscription(endpoint, p256dh, auth, navigator.userAgent)`.
  A "Turn off" control unsubscribes + `delete_push_subscription`. Persist on/off UI state from the
  actual subscription. HONEST states: unsupported browser, permission denied, and — critically —
  **push needs a secure context (HTTPS)**: on plain http (non-localhost) `PushManager`/SW may be
  unavailable; show "Phone alerts need the secure app link — the in-app bell works here now."
  (localhost IS a secure context, so it may work in dev; a Tailscale http IP is not.)
- **Service worker**: the app uses vite-plugin-pwa. Determine its mode; add a `push` listener
  (`self.registration.showNotification(title, { body, data:{ link } })`) and a `notificationclick`
  listener (focus an existing client or openWindow at `event.notification.data.link`) WITHOUT
  breaking the existing precache/offline SW. If the plugin is in generateSW mode, switch to
  injectManifest with a custom SW that keeps the existing workbox precache AND adds these handlers
  — do it carefully and keep offline working; state exactly what you changed.

### 4. Generation hooks (wire create_notification via raiseNotification; deduped, best-effort)
- Feature A weather: when a located field's spray light turns GOOD (from not-good) for today,
  raise a 'spray' notification to the current user, dedupe_key `spray:<fieldId>:<YYYY-MM-DD>`,
  link `/weather`. Only once per field/day; only for the signed-in user.
- Feature C scouting: when a scouting note is saved WITH "add a follow-up task", ALSO raise a
  'scouting' notification to the current user, dedupe_key `scouting:<noteId>`, link `/scouting`.
  (Keep it additive; do not change the scouting save contract.)
- Do NOT block any save on a notification failure (catch + ignore). Keep hooks minimal.

### 5. Register + regression
- Add the bell/route in App.tsx (mirror module registration); wire notifications replay at
  farm-ready after Fields. Nav item "Alerts" (plain word).
- `SupabaseNotificationsRepository.regression.ts`: mark-read write + wrong-echo rejection,
  idempotent replay, own-only semantics via the fake, unread-count math, category mapping
  fail-closed, corrupt envelope. Register in package.json; state group count.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL pass incl. the new
notifications suite (state its group count). FINAL: per-item confirmation, proof output,
`git status`, deviations (esp. exactly what you changed in the service worker). Do NOT commit.
