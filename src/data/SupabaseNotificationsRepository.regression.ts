import { readFileSync } from 'node:fs'
import { refreshNotificationsAfterDueGeneration, rollbackFailedPushSubscription, markReadUiAction, getNotificationBellRevision, invalidateNotificationBell, subscribeNotificationBell } from '../NotificationsModule'
import { QueuedNotificationsRepository } from './QueuedNotificationsRepository'
import type { NotificationsDataGateway } from './NotificationsDataGateway'
import { NotificationsWriteQueue, notificationsWriteQueueKey, type NotificationsQueueEntryV1 } from './notificationsWriteQueue'
import { SupabaseNotificationsRepository } from './SupabaseNotificationsRepository'
import { isTransportFailure } from './QueuedFieldsRepository'
import { getSyncStatus } from './syncStatus'
import type { NotificationCategory } from './notifications'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const actor = uid(2); const other = uid(3); const stamp = '2026-07-12T12:30:00.123456+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
function memory(): StorageLike & { values: Map<string, string> } { const values = new Map<string, string>(); return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function notification(id = uid(10), userId = actor, category: NotificationCategory = 'spray', read_at: string | null = null) { return { id, farm_id: farm, user_id: userId, category, title: 'Spray window is good', body: 'Good conditions right now.', link: '/weather', dedupe_key: `spray:${id}`, read_at, created_by: actor, created_at: stamp } }
function queueEntry(operationId: string, ids: string[]): NotificationsQueueEntryV1 { return { version: 1, module: 'notifications', kind: 'markRead', operationId, userId: actor, farmId: farm, enqueuedAt: stamp, ids } }
class FakeGateway implements NotificationsDataGateway {
  rows: unknown[] = []; marks: string[][] = []; markReply: unknown | null = null; markFailure: Error | null = null; creates: unknown[] = []
  async loadNotifications() { return structuredClone(this.rows) }
  async markRead(ids: string[]) {
    this.marks.push([...ids])
    if (this.markFailure) throw this.markFailure
    const updated = new Set(ids.filter((id) => this.rows.some((row) => { const item = row as { id: string; user_id: string; read_at: string | null }; return item.id === id && item.user_id === actor && item.read_at === null })))
    this.rows = this.rows.map((row) => updated.has((row as { id: string }).id) ? { ...(row as object), read_at: stamp } : row)
    return structuredClone(this.markReply ?? { updated_count: updated.size })
  }
  async createNotification(input: { farmId: string; recipientId: string; category: NotificationCategory; title: string; body: string; link: string; dedupeKey: string | null }) { const row = notification(uid(50), input.recipientId, input.category); this.creates.push(input); return { ...row, farm_id: input.farmId, title: input.title, body: input.body, link: input.link, dedupe_key: input.dedupeKey } }
  async savePushSubscription(input: { endpoint: string }) { return { endpoint: input.endpoint } }
  async deletePushSubscription(endpoint: string) { return { endpoint } }
}
function live(gateway: FakeGateway) { return new SupabaseNotificationsRepository({ gateway, getUserId: async () => actor }) }
function queued(gateway: FakeGateway, storage: StorageLike, offline: () => boolean) { let next = 80; return new QueuedNotificationsRepository(live(gateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'test', storage, createId: () => uid(next++), clock: () => stamp, isOffline: offline }) }

async function run() {
  // Group 1: RLS-shaped reads only accept the caller and unread count is exact.
  const reads = new FakeGateway(); reads.rows = [notification(uid(10)), notification(uid(11), actor, 'task', stamp)]; const data = await live(reads).getData(); assert(data.notifications.length === 2 && data.unreadCount === 1, 'Unread count must count only unread caller alerts.'); reads.rows = [notification(uid(12), other)]; await rejects(() => live(reads).getData(), 'A foreign notification row must fail closed even if a gateway returns it.')

  // Group 2: categories and malformed mark-read replies fail closed.
  const categories = new FakeGateway(); categories.rows = [{ ...notification(), category: 'unknown' }]; await rejects(() => live(categories).getData(), 'Unknown notification categories must fail closed.'); const wrongEcho = new FakeGateway(); wrongEcho.markReply = { updated_count: 2 }; await rejects(() => live(wrongEcho).markRead([uid(20)]), 'A mark-read reply larger than the request must be rejected.'); await rejects(() => live(wrongEcho).raiseNotification(farm, actor, 'general', 'x', 'body', 'https://bad.example', null), 'Notification links must stay inside the app.')

  // Group 3: the fake mirrors RPC semantics: only unread caller rows count, and replay returns zero.
  const ownOnly = new FakeGateway(); ownOnly.rows = [notification(uid(21)), notification(uid(22), other)]; const first = await live(ownOnly).markRead([uid(21), uid(22)]); const after = ownOnly.rows as Array<{ id: string; read_at: string | null }>; assert(first.kind === 'confirmed' && first.updatedCount === 1 && after.find((row) => row.id === uid(21))?.read_at === stamp && after.find((row) => row.id === uid(22))?.read_at === null, 'Own-only mark read must never mark another user’s alert.'); const replay = await live(ownOnly).markRead([uid(21)]); assert(replay.kind === 'confirmed' && replay.updatedCount === 0, 'An already-read replay must report zero updates.')

  // Group 4: UI honesty reloads a zero echo, leaves offline work pending, and invalidates the bell immediately.
  assert(markReadUiAction({ kind: 'confirmed', updatedCount: 0 }, 1) === 'reload', 'A zero update count must reload canonical alerts instead of marking locally read.'); assert(markReadUiAction({ kind: 'pending' }, 1) === 'pending', 'Offline mark-read must remain pending, not confirmed.'); let bellSignals = 0; const beforeBell = getNotificationBellRevision(); const unsubscribeBell = subscribeNotificationBell(() => { bellSignals += 1 }); invalidateNotificationBell(); unsubscribeBell(); assert(bellSignals === 1 && getNotificationBellRevision() === beforeBell + 1, 'Mark-read must invalidate the bell count immediately.')

  // Group 5: two queued entries replay in FIFO order and an idempotent retry drains safely.
  const fifoStore = memory(); const fifoGateway = new FakeGateway(); fifoGateway.rows = [notification(uid(30)), notification(uid(31))]; const fifoQueue = new NotificationsWriteQueue(fifoStore, notificationsWriteQueueKey('test', actor, farm)); fifoQueue.append(queueEntry(uid(70), [uid(30)])); fifoQueue.append(queueEntry(uid(71), [uid(31)])); const fifo = queued(fifoGateway, fifoStore, () => false); await fifo.inspectAndReplay(); assert(fifoGateway.marks.map((ids) => ids[0]).join(',') === `${uid(30)},${uid(31)}` && fifoQueue.read().entries.length === 0, 'Queued mark-read operations must replay in FIFO order.'); fifoQueue.append(queueEntry(uid(72), [uid(30)])); await fifo.inspectAndReplay(); assert(fifoQueue.read().entries.length === 0, 'A queued replay of an already-read alert must safely drain after a zero count.')

  // Group 6: transport failures remain pending, while authorization failures become blocked.
  assert(isTransportFailure(new TypeError('fetch failed'), false) && !isTransportFailure(new Error('permission denied'), false), 'Transport classification must not queue a definite authorization failure.'); const transportStore = memory(); const transportGateway = new FakeGateway(); transportGateway.markFailure = new TypeError('fetch failed'); const transportQueue = new NotificationsWriteQueue(transportStore, notificationsWriteQueueKey('test', actor, farm)); transportQueue.append(queueEntry(uid(73), [uid(40)])); const transport = queued(transportGateway, transportStore, () => false); await transport.inspectAndReplay(); assert(getSyncStatus().kind === 'pending' && transportQueue.read().entries.length === 1, 'Transport failure must retain a pending notification entry.'); transportGateway.markFailure = new Error('permission denied'); await transport.inspectAndReplay(); assert(getSyncStatus().kind === 'blocked' && transportQueue.read().entries.length === 1, 'A definite failure must block rather than silently queue forever.')

  // Group 7: corrupt envelopes surface a blocked sync state instead of being discarded.
  const corruptStore = memory(); corruptStore.setItem(notificationsWriteQueueKey('test', actor, farm), '{bad'); const corrupt = queued(new FakeGateway(), corruptStore, () => false); await corrupt.inspectAndReplay(); assert(getSyncStatus().kind === 'blocked', 'A corrupt notification envelope must set blocked sync status.'); await rejects(async () => { new NotificationsWriteQueue({ ...corruptStore, getItem: () => JSON.stringify({ version: 1, entries: [{ ...queueEntry(uid(74), [uid(41)]), ids: [] }] }) }, 'bad-shape').read() }, 'A queue entry without IDs must fail closed.')

  // Group 8: failed push-subscription persistence rolls the browser subscription back.
  let rollbackCalls = 0; await rollbackFailedPushSubscription({ unsubscribe: async () => { rollbackCalls += 1; return true } }); assert(rollbackCalls === 1, 'A failed server save must unsubscribe the newly-created browser subscription.')

  // Group 9: the injectManifest service worker keeps the offline navigation intent and defensive push payload guards.
  const serviceWorker = readFileSync(new URL('../sw.ts', import.meta.url), 'utf8'); assert(serviceWorker.includes("new NavigationRoute(createHandlerBoundToURL('/index.html'))") && serviceWorker.includes('self.skipWaiting()') && serviceWorker.includes('clientsClaim()'), 'The service worker must serve cached index.html for offline navigation and activate promptly.'); assert(serviceWorker.includes('plainObject(parsed) ? parsed : {}') && serviceWorker.includes('notificationText(payload.title, 160') && serviceWorker.includes('notificationText(payload.body, 500'), 'Malformed push payloads must fall back safely and cap notification text.')
  // Group 10: one refresh reads immediately, then shows an item it generated without a render-loop re-fire or stale update.
  let generated = 0; let readsAfterGeneration = 0; let applied: string[] = []; let generatedBellSignals = 0; const stopGeneratedBell = subscribeNotificationBell(() => { generatedBellSignals += 1 }); await refreshNotificationsAfterDueGeneration({ read: async () => { readsAfterGeneration += 1; return generated ? ['new due alert'] : [] }, generateDueItems: async () => { generated += 1; return 'generated' }, onData: (data) => { applied = data }, onReadError: () => { throw new Error('The controlled read should not fail.') }, onGenerated: invalidateNotificationBell, isCurrent: () => true }); stopGeneratedBell(); assert(generated === 1 && readsAfterGeneration === 2 && applied.join(',') === 'new due alert' && generatedBellSignals === 1, 'A successful due scan must trigger exactly one follow-up alerts read and one bell refresh that include its new alert.'); let staleUpdates = 0; await refreshNotificationsAfterDueGeneration({ read: async () => ['ignored'], generateDueItems: async () => 'generated', onData: () => { staleUpdates += 1 }, onReadError: () => { staleUpdates += 1 }, isCurrent: () => false }); assert(staleUpdates === 0, 'An unmounted or superseded alerts refresh must not update state.')
  console.log('SupabaseNotificationsRepository regression passed (10 coverage groups)')
}
void run()
