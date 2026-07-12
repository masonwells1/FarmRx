# Feature E — Push reminders (in-app + phone push) (design)

Fifth and final feature of the customer-value batch. Mason's decision (2026-07-12): reminders are
**in-app + phone push ONLY** (no email, no SMS). Defers to the three handoff rules. Plain English,
18px/48px, two-tap. This is the layer that ties the other features together, so it is built LAST.

## What the farmer gets
1. A **notification center** in the app (a bell + a list): "Spray window is good on North Quarter
   until 2 PM", "Oil change due on Truck 7", "Follow up: rootworm in North Quarter", "Rain logged:
   0.8 in". Tap one to jump to the relevant page. Mark read / clear.
2. **Phone push** (opt-in): the same alerts pop up on the phone when the app is installed and the
   farmer allowed notifications — even when the app isn't open (best-effort; see §4 scope).

## 1. Schema — migration 0023 (Sol drafts; review gate before apply)
- `public.notifications` (per farm + recipient): id, farm_id (fk cascade), user_id (recipient —
  plain uuid provenance, NOT an fk that blocks membership removal), category text check in
  ('spray','rain','scouting','harvest','service','task','general'), title text (<=160), body text
  (<=500), link text (<=200, an in-app route like '/weather'), dedupe_key text (nullable — for
  idempotent generation, e.g. 'service:<interval_id>:<cycle>'), read_at timestamptz null,
  created_by uuid, created_at. Partial unique index (farm_id, user_id, dedupe_key) WHERE
  dedupe_key is not null (one notification per logical event per recipient). Indexes (user_id,
  read_at, created_at desc). RLS: a user reads/updates ONLY their OWN notifications
  (user_id = auth.uid()) AND must be an active member of the farm (can_access_farm); no cross-user
  read. Insert is via SECURITY DEFINER RPC only (revoke direct insert).
- `public.push_subscriptions` (per user+device): id, user_id, endpoint text unique, p256dh text,
  auth text, user_agent text, created_at, last_seen_at. RLS: user manages only their own rows.
- RPCs (SECURITY DEFINER, search_path, 0017 lesson):
  - `create_notification(p_farm_id, p_recipient uuid, p_category, p_title, p_body, p_link,
    p_dedupe_key)` — gated: caller must be an active member who can act on the farm (can_edit_farm)
    OR the recipient themselves; validates category; ON CONFLICT (dedupe) DO NOTHING; returns the
    row (or the existing one). This is what features call to raise a reminder.
  - `mark_notifications_read(p_ids uuid[])` — sets read_at=now() for the caller's own rows only.
  - `save_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)` /
    `delete_push_subscription(p_endpoint)` — upsert/remove the caller's own subscription.
- Extend the equipment service-due generation (0016 `generate_due_service_tasks`) to ALSO
  create_notification('service', ...) for the same due interval with a dedupe_key so a service
  reminder is raised exactly once per cycle (Sol: wire it in without breaking 0016's idempotency).

## 2. Web push plumbing
- **VAPID keys**: Claude generates a VAPID keypair. PUBLIC key ships in the client (env/const);
  PRIVATE key is set as a Supabase EDGE FUNCTION SECRET (never committed, never in the bundle).
- **Service worker**: the app already registers a PWA service worker (vite-plugin-pwa). Add a
  `push` event handler (show the notification) and a `notificationclick` handler (focus/open the
  app at the notification's link). Use injectManifest or a custom SW per the plugin's mode — Sol/
  Terra confirm the vite-plugin-pwa mode in use and extend it without breaking the existing
  precache/offline setup.
- **Subscribe flow**: a "Turn on phone alerts" control in the notification center that requests
  Notification permission, subscribes via `pushManager.subscribe({applicationServerKey})`, and
  calls save_push_subscription. Honest states (blocked/unsupported/needs-HTTPS — push requires a
  secure context; over the Tailscale IP http it will be unavailable, works on the deployed HTTPS or
  a tailscale-serve https URL — say so plainly).
- **send-push edge function** (`supabase/functions/send-push`): given a notification row (or
  recipient), loads that user's push_subscriptions and sends the push with the web-push protocol +
  VAPID private key (Deno web-push). verify_jwt true; called by create_notification's flow — either
  the client calls send-push after creating a notification, OR (preferred) a Postgres trigger/
  pg_net call fires it. v1: keep it simple — the app calls send-push after create_notification
  succeeds (works when the app is open / the actor is online). Server-initiated "while app closed"
  delivery for scheduled events is §4.

## 3. In-app notification center + generation
- Data layer mirrors the module pattern (notifications repo/gateway/queue/services/regression) —
  reads the caller's notifications, mark-read via queue (idempotent). A bell in the nav with an
  unread count; a `/notifications` list page (category chip, title, body, time, tap→link, mark
  read, "turn on phone alerts").
- **Generation sources v1** (each calls create_notification with a dedupe_key):
  - service due (server-side, via the 0016 extension) — reliable.
  - task assigned to you / newly overdue — from the tasks flow.
  - spray window turns GOOD today for a located field — client evaluates (Feature A already
    computes it) and raises a notification when it flips to good (dedupe per field+day).
  - scouting follow-up created (already makes a board task; also a notification to the assignee).
  - rain logged / harvest entered confirmations — low priority, optional in v1.
- Role: everyone sees their own notifications. No cross-user leakage (RLS).

## 4. Scope / honesty (v1)
- **Push needs a secure context (HTTPS).** Over the current Tailscale http IP it is unavailable;
  it works on the deployed HTTPS app or a `tailscale serve` https URL. The UI says so and still
  delivers the full IN-APP notification center everywhere.
- **"While the app is fully closed" scheduled pushes** (e.g. a dawn spray-forecast check) need a
  server scheduler (pg_cron / a scheduled edge function). v1 delivers push for server-side events
  (service due, task assignment) and client-triggered events (spray-good, scouting) when the actor
  is online; a nightly scheduled evaluator is a documented FOLLOW-UP, not v1.
- No notification preferences UI beyond on/off phone alerts in v1 (per-category mute = later).
- Never email/SMS (Mason's decision).

## 5. Proof
Migration RPCs behaviorally proven (create_notification dedupe, mark-read own-only, RLS cross-user
denial). In-app: raise a notification (e.g. via the service-due path or a scouting follow-up),
see it in the bell/list, mark read, confirm read_at in Postgres, confirm a second user cannot see
it. Push: on an HTTPS context, subscribe + receive a test push (or prove the send-push edge
function + subscription storage end-to-end); over http, prove the honest "needs HTTPS" state +
the in-app center still works.
