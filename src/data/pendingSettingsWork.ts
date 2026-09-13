/** In-memory record of settings saves that are in flight or waiting behind one.
 * The farm switcher asks `hasPendingFarmWork`, which consults this, so a farmer is
 * warned before leaving a farm whose carry or sale-limit edits have not reached the
 * server (or the durable queue) yet; once they confirm, `settlePendingSettingsWork`
 * flushes unflushed edits and waits for every save to finish before the farm changes,
 * and refuses the switch when a save failed or is still running after the time limit.
 * Keyed by farm only: one page session serves one signed-in user. */
type Token = { settled: Promise<void>; finish: () => void; failure: unknown }
const pending = new Map<string, Set<Token>>()
const flushers = new Map<string, Set<() => void>>()

export const SETTINGS_SAVE_FAILED = 'SETTINGS_SAVE_FAILED'
export const SETTINGS_SAVE_STILL_RUNNING = 'SETTINGS_SAVE_STILL_RUNNING'
/** The selected farm changed (another tab, or a switch already under way) before a settings save could run under its farm. */
export const SETTINGS_CONTEXT_CHANGED = 'SETTINGS_CONTEXT_CHANGED'

/** Marks a save as pending until the returned function runs. Pass the error to it when the save
 * failed before reaching the server or the durable queue, so a confirmed farm switch stops. */
export function beginPendingSettingsWork(farmId: string): (failure?: unknown) => void {
  let finish: () => void = () => undefined
  const settled = new Promise<void>((resolve) => { finish = resolve })
  const token: Token = { settled, finish, failure: undefined }
  const tokens = pending.get(farmId) ?? new Set<Token>()
  tokens.add(token); pending.set(farmId, tokens)
  let done = false
  return (failure?: unknown) => {
    if (done) return
    done = true
    token.failure = failure
    tokens.delete(token); if (tokens.size === 0) pending.delete(farmId)
    token.finish()
  }
}

export function hasPendingSettingsWork(farmId: string): boolean { return (pending.get(farmId)?.size ?? 0) > 0 }

/** A screen with edits that have not been sent yet registers how to send them now; returns the unregister function. */
export function registerPendingSettingsFlush(farmId: string, flush: () => void): () => void {
  const set = flushers.get(farmId) ?? new Set<() => void>()
  set.add(flush); flushers.set(farmId, set)
  return () => { set.delete(flush); if (set.size === 0) flushers.delete(farmId) }
}

/** Sends every unflushed edit for the farm and waits until each save has reached the server or the durable queue.
 * Saves chained behind one another finish in turn. Rejects with `SETTINGS_SAVE_FAILED` when any save failed, and with
 * `SETTINGS_SAVE_STILL_RUNNING` when saves are still running after `timeoutMs`; either way the unsent work stays with
 * the farm that is still selected, so the caller must not change farms. */
export async function settlePendingSettingsWork(farmId: string, options: { timeoutMs?: number; maxRounds?: number } = {}): Promise<void> {
  const { timeoutMs = 20_000, maxRounds = 50 } = options
  for (const flush of [...(flushers.get(farmId) ?? [])]) { try { flush() } catch { /* the screen reports its own save errors */ } }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs) })
  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const tokens = [...(pending.get(farmId) ?? [])]
      if (tokens.length === 0) return
      const outcome = await Promise.race([Promise.all(tokens.map((token) => token.settled)).then(() => 'settled' as const), timedOut])
      if (outcome === 'timeout') throw new Error(SETTINGS_SAVE_STILL_RUNNING)
      if (tokens.some((token) => token.failure !== undefined)) throw new Error(SETTINGS_SAVE_FAILED)
    }
    throw new Error(SETTINGS_SAVE_STILL_RUNNING)
  } finally { clearTimeout(timer) }
}
