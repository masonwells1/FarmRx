// Farm Rx — send-push edge function.
// Sends a Web Push notification to a recipient's registered devices for a given
// notification row. Requires three secrets (set via `supabase secrets set`, never
// committed): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto:).
//
// Security: verify_jwt is ON (only signed-in callers). The function then loads the
// notification with the SERVICE ROLE and only sends to the notification's own
// recipient's subscriptions. It never returns key material. If the VAPID secrets
// are not set, it fails closed with a clear message (no push is attempted).
//
// This function's live delivery is gated on (a) the VAPID secrets being set and
// (b) the client subscribing from a secure (HTTPS) context. Until both exist it
// deploys and 401s unauthenticated callers, but cannot deliver a real push.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) {
    return json(503, { error: 'Push is not configured yet (VAPID secrets missing).' })
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  let notificationId: string | null = null
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object' && typeof parsed.notification_id === 'string') {
      notificationId = parsed.notification_id
    }
  } catch {
    return json(400, { error: 'invalid request body' })
  }
  if (!notificationId) return json(400, { error: 'notification_id is required' })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: notification, error: nErr } = await admin
    .from('notifications')
    .select('id, user_id, category, title, body, link')
    .eq('id', notificationId)
    .single()
  if (nErr || !notification) return json(404, { error: 'notification not found' })

  const { data: subs, error: sErr } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', notification.user_id)
  if (sErr) return json(500, { error: 'could not load subscriptions' })
  if (!subs || subs.length === 0) return json(200, { sent: 0, note: 'no devices registered' })

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body ?? '',
    link: notification.link ?? '/notifications',
    category: notification.category,
  })

  let sent = 0
  const stale: string[] = []
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
      sent += 1
    } catch (err) {
      // 404/410 mean the subscription is gone — prune it.
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) stale.push(s.endpoint)
    }
  }
  if (stale.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', stale)
  }

  return json(200, { sent, pruned: stale.length })
})
