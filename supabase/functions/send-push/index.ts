// Farm Rx — durable per-device push deliverer. Provider calls occur only here;
// retry decisions and target state are isolated in injected, pure logic.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { deliverClaimedPushTargets, type ClaimedPushTarget, type PushTargetOutcome } from '../_shared/pushDeliveryLogic.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-delivery-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const rate = new Map<string, { count: number; reset: number }>()
const allow = (key: string) => { const now = Date.now(); const current = rate.get(key); if (!current || current.reset <= now) { rate.set(key, { count: 1, reset: now + 60_000 }); return true } if (current.count >= 20) return false; current.count += 1; return true }
function sameSecret(left: string, right: string) { if (left.length !== right.length) return false; let result = 0; for (let i=0;i<left.length;i++) result |= left.charCodeAt(i)^right.charCodeAt(i); return result===0 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!url || !serviceKey || !anonKey || !publicKey || !privateKey || !subject) return json(503, { error: 'Push is not configured yet (required server secrets missing).' })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return json(400, { error: 'invalid request body' }) }
  const suppliedServerKey = req.headers.get('x-server-delivery-key') ?? ''
  const serverDelivery = sameSecret(serviceKey, suppliedServerKey)
  const requestedId = typeof body.notification_id === 'string' ? body.notification_id : null
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  if (!serverDelivery) {
    const authorization = req.headers.get('Authorization')
    if (!authorization || !requestedId) return json(401, { error: 'sign in required' })
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) return json(401, { error: 'sign in required' })
    if (!allow(userData.user.id)) return json(429, { error: 'too many push requests' })
    // Ownership is checked through the caller's RLS-bound client. The privileged
    // client is used only after that check and only through server-owned RPCs.
    const { data: visible, error: visibleError } = await caller.from('notifications').select('id').eq('id', requestedId).maybeSingle()
    if (visibleError || !visible) return json(403, { error: 'notification is not yours' })
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  try {
    const result = await deliverClaimedPushTargets({
      async claimTargets(notificationId, limit, signal) {
        const { data, error } = await admin.rpc('claim_push_delivery_targets', { p_notification_id: notificationId, p_limit: limit }).abortSignal(signal)
        if (error || !Array.isArray(data)) throw new Error('could not claim push delivery targets')
        return data as ClaimedPushTarget[]
      },
      async finishTarget(targetId, outcome: PushTargetOutcome, errorText, signal) {
        const { error } = await admin.rpc('finish_push_delivery_target', { p_target_id: targetId, p_outcome: outcome, p_error: errorText }).abortSignal(signal)
        if (error) throw new Error('could not finish push delivery target')
      },
      async getHealth(notificationId, signal) {
        const { data, error } = await admin.rpc('get_push_delivery_health', { p_notification_id: notificationId }).abortSignal(signal)
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('could not read push delivery health')
        const terminalFailed = Number((data as { terminal_failed_targets?: unknown }).terminal_failed_targets)
        const retryable = Number((data as { retryable_targets?: unknown }).retryable_targets)
        if (!Number.isSafeInteger(terminalFailed) || terminalFailed < 0 || !Number.isSafeInteger(retryable) || retryable < 0) throw new Error('push delivery health was malformed')
        return { terminalFailed, retryable }
      },
    }, {
      async send(target, payload, _signal, timeoutMs) {
        const topic = target.notification_id.replaceAll('-', '').slice(0, 32)
        await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, { TTL: 3_600, urgency: 'normal', topic, timeout: Math.max(1, Math.floor(timeoutMs)) })
      },
    }, serverDelivery ? null : requestedId, { limit: 12, concurrency: 6, budgetMs: 20_000 })
    const unhealthy = result.failed > 0 || result.terminalFailed > 0 || result.retryable > 0
    return json(unhealthy ? 503 : 200, unhealthy ? { ...result, error: result.terminalFailed > 0 ? 'one or more push targets exhausted automatic retries' : 'one or more push targets remain retryable' } : result)
  } catch {
    return json(500, { error: 'push delivery failed before completion' })
  }
})
