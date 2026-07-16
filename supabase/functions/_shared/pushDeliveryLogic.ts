export type PushTargetOutcome = 'sent' | 'retry' | 'gone'

export interface ClaimedPushTarget {
  target_id: string
  notification_id: string
  endpoint: string
  p256dh: string
  auth: string
  title: string
  body: string | null
  link: string | null
  category: string
}

export interface PushDeliveryDatabase {
  claimTargets(notificationId: string | null, limit: number, signal: AbortSignal): Promise<ClaimedPushTarget[]>
  finishTarget(targetId: string, outcome: PushTargetOutcome, error: string | null, signal: AbortSignal): Promise<void>
  getHealth(notificationId: string | null, signal: AbortSignal): Promise<{ terminalFailed: number; retryable: number }>
}

export interface PushProvider {
  send(target: ClaimedPushTarget, payload: string, signal: AbortSignal, timeoutMs: number): Promise<void>
}

export interface PushDeliveryResult {
  claimed: number
  sent: number
  failed: number
  gone: number
  terminalFailed: number
  retryable: number
}

export interface PushDeliveryOptions { limit?: number; concurrency?: number; budgetMs?: number }

const budgetExpired = 'push delivery budget exhausted'

function providerStatus(error: unknown) {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && Number.isInteger(status) ? status : null
}

async function finishWithRetry(database: PushDeliveryDatabase, targetId: string, outcome: PushTargetOutcome, error: string | null, signal: AbortSignal) {
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await callBeforeAbort(() => database.finishTarget(targetId, outcome, error, signal), signal); return }
    catch (caught) { failure = caught }
  }
  throw failure
}

function beforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException(budgetExpired, 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DOMException(budgetExpired, 'AbortError'))
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', aborted); resolve(value) },
      (error) => { signal.removeEventListener('abort', aborted); reject(error) },
    )
  })
}

function callBeforeAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException(budgetExpired, 'AbortError'))
  try { return beforeAbort(operation(), signal) }
  catch (error) { return Promise.reject(error) }
}

export async function deliverClaimedPushTargets(
  database: PushDeliveryDatabase,
  provider: PushProvider,
  notificationId: string | null,
  options: PushDeliveryOptions | number = {},
): Promise<PushDeliveryResult> {
  const normalized = typeof options === 'number' ? { limit: options } : options
  const limit = Math.max(1, Math.min(normalized.limit ?? 12, 100))
  const concurrency = Math.max(1, Math.min(normalized.concurrency ?? 6, 12))
  const budgetMs = Math.max(100, Math.min(normalized.budgetMs ?? 20_000, 25_000))
  const deadlineAt = Date.now() + budgetMs
  const providerMaxMs = Math.min(8_000, Math.max(50, Math.floor(budgetMs / 2)))
  const completionReserveMs = Math.min(1_500, Math.max(25, Math.floor(budgetMs / 4)))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budgetMs)
  let targets: ClaimedPushTarget[]
  try { targets = await callBeforeAbort(() => database.claimTargets(notificationId, limit, controller.signal), controller.signal) }
  catch (error) { clearTimeout(timer); throw error }
  let sent = 0
  let failed = 0
  let gone = 0
  let cursor = 0

  const deliverOne = async (target: ClaimedPushTarget) => {
    const payload = JSON.stringify({
      notification_id: target.notification_id,
      title: target.title,
      body: target.body ?? '',
      link: target.link ?? '/notifications',
      category: target.category,
    })
    try {
      if (controller.signal.aborted) throw new DOMException(budgetExpired, 'AbortError')
      const providerTimeoutMs = Math.min(providerMaxMs, deadlineAt - Date.now() - completionReserveMs)
      if (providerTimeoutMs < 1) { controller.abort(); throw new DOMException(budgetExpired, 'AbortError') }
      await callBeforeAbort(() => provider.send(target, payload, controller.signal, providerTimeoutMs), controller.signal)
    } catch (error) {
      const status = providerStatus(error)
      if (status === 404 || status === 410) {
        try { await finishWithRetry(database, target.target_id, 'gone', `push provider status ${status}`, controller.signal); gone += 1 }
        catch { failed += 1 }
      } else {
        // Do not persist or log provider messages: they can include endpoints or
        // request details. A stable status is enough for retry diagnostics.
        const reason = controller.signal.aborted ? budgetExpired : status === null ? 'push provider failure' : `push provider status ${status}`
        try { await finishWithRetry(database, target.target_id, 'retry', reason, controller.signal) }
        catch { /* The invocation remains unhealthy; the sending lease expires for retry. */ }
        finally { failed += 1 }
      }
      return
    }
    // A provider success must never be reclassified as a provider failure when
    // only the database completion write fails. Retry that write in place; if
    // it stays unavailable, leave the target sending and fail the invocation.
    try { await finishWithRetry(database, target.target_id, 'sent', null, controller.signal); sent += 1 }
    catch { failed += 1 }
  }

  const worker = async () => {
    while (true) {
      if (controller.signal.aborted) return
      const index = cursor
      cursor += 1
      if (index >= targets.length) return
      await deliverOne(targets[index]!)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()))
    if (controller.signal.aborted) failed = Math.max(failed, targets.length - sent - gone)
    try {
      const health = await callBeforeAbort(() => database.getHealth(notificationId, controller.signal), controller.signal)
      return { claimed: targets.length, sent, failed, gone, terminalFailed: health.terminalFailed, retryable: health.retryable }
    } catch {
      // A timed-out health read must not extend the invocation. Every target
      // that was not durably completed remains leased/retryable in PostgreSQL.
      const retryable = Math.max(0, targets.length - sent - gone)
      return { claimed: targets.length, sent, failed: Math.max(1, failed, retryable), gone, terminalFailed: 0, retryable }
    }
  } finally { clearTimeout(timer) }
}
