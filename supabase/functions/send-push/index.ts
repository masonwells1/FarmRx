// Farm Rx — durable push deliverer. Deployed separately from draft migration 0035.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-delivery-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const rate = new Map<string, { count: number; reset: number }>()
const allow = (key: string) => { const now = Date.now(); const current = rate.get(key); if (!current || current.reset <= now) { rate.set(key, { count: 1, reset: now + 60_000 }); return true } if (current.count >= 20) return false; current.count += 1; return true }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY'); const privateKey = Deno.env.get('VAPID_PRIVATE_KEY'); const subject = Deno.env.get('VAPID_SUBJECT')
  if (!url || !serviceKey || !publicKey || !privateKey || !subject) return json(503, { error: 'Push is not configured yet (required server secrets missing).' })
  let body: Record<string, unknown>; try { body = await req.json() as Record<string, unknown> } catch { return json(400, { error: 'invalid request body' }) }
  const admin = createClient(url, serviceKey); const serverDelivery = req.headers.get('x-server-delivery-key') === serviceKey
  const authorization = req.headers.get('Authorization'); let callerId: string | null = null
  if (!serverDelivery) {
    if (!authorization) return json(401, { error: 'sign in required' })
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data, error } = await caller.auth.getUser(); if (error || !data.user) return json(401, { error: 'sign in required' }); callerId = data.user.id
    if (!allow(callerId)) return json(429, { error: 'too many push requests' })
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  const requestedId = typeof body.notification_id === 'string' ? body.notification_id : null
  // A caller-triggered send must settle the queued delivery row too, or the
  // server sweep re-sends the same notification later.
  const requestedDeliveryId = requestedId ? (await admin.from('push_deliveries').select('id').eq('notification_id', requestedId).maybeSingle()).data?.id ?? null : null
  const claimed = serverDelivery ? await admin.rpc('claim_push_deliveries', { p_limit: 25 }) : requestedId ? { data: [{ notification_id: requestedId, id: requestedDeliveryId }], error: null } : null
  if (!claimed || claimed.error || !Array.isArray(claimed.data)) return json(500, { error: 'could not claim push deliveries' })
  let sent = 0; let failed = 0
  for (const delivery of claimed.data as Array<{ id: string | null; notification_id: string }>) {
    const { data: notification, error: nErr } = await admin.from('notifications').select('id,user_id,category,title,body,link').eq('id', delivery.notification_id).maybeSingle()
    // Only the server sweep may record failures: a caller-path failure (403 or
    // lookup blip) must leave the queued row untouched so the sweep still delivers it.
    if (nErr || !notification || (!serverDelivery && notification.user_id !== callerId)) { if (serverDelivery && delivery.id) await admin.rpc('finish_push_delivery', { p_delivery_id: delivery.id, p_sent: false, p_error: 'notification unavailable' }); if (!serverDelivery) return json(403, { error: 'notification is not yours' }); failed += 1; continue }
    const { data: subs, error: sErr } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', notification.user_id)
    if (sErr) { if (delivery.id) await admin.rpc('finish_push_delivery', { p_delivery_id: delivery.id, p_sent: false, p_error: 'subscription lookup failed' }); failed += 1; continue }
    const payload = JSON.stringify({ title: notification.title, body: notification.body ?? '', link: notification.link ?? '/notifications', category: notification.category }); const stale: string[] = []
    try { for (const sub of subs ?? []) { try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload); sent += 1 } catch (error) { const status = (error as { statusCode?: number }).statusCode; if (status === 404 || status === 410) stale.push(sub.endpoint); else throw error } }; if (stale.length) await admin.from('push_subscriptions').delete().in('endpoint', stale); if (delivery.id) await admin.rpc('finish_push_delivery', { p_delivery_id: delivery.id, p_sent: true, p_error: null }) } catch (error) { failed += 1; if (delivery.id) await admin.rpc('finish_push_delivery', { p_delivery_id: delivery.id, p_sent: false, p_error: error instanceof Error ? error.message : 'push send failed' }) }
  }
  return json(200, { sent, failed, claimed: claimed.data.length })
})
