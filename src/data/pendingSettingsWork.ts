/** In-memory record of settings saves that are in flight or waiting behind one.
 * The farm switcher asks `hasPendingFarmWork`, which consults this, so a farmer is
 * warned before leaving a farm whose carry or sale-limit edits have not reached the
 * server (or the durable queue) yet; once they confirm, `settlePendingSettingsWork`
 * flushes unflushed edits and waits for every save to finish before the farm changes.
 * Keyed by farm only: one page session serves one signed-in user. */
type Token = { settled: Promise<void>; finish: () => void }
const pending = new Map<string, Set<Token>>()
const flushers = new Map<string, Set<() => void>>()

export function beginPendingSettingsWork(farmId: string): () => void {
  let finish: () => void = () => undefined
  const settled = new Promise<void>((resolve) => { finish = resolve })
  const token: Token = { settled, finish }
  const tokens = pending.get(farmId) ?? new Set<Token>()
  tokens.add(token); pending.set(farmId, tokens)
  let done = false
  return () => {
    if (done) return
    done = true
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
 * Saves chained behind one another finish in turn; the wait is bounded so a save that keeps re-queuing itself cannot hold the switch forever. */
export async function settlePendingSettingsWork(farmId: string, maxRounds = 50): Promise<void> {
  for (const flush of [...(flushers.get(farmId) ?? [])]) { try { flush() } catch { /* the screen reports its own save errors */ } }
  for (let round = 0; round < maxRounds; round += 1) {
    const tokens = [...(pending.get(farmId) ?? [])]
    if (tokens.length === 0) return
    await Promise.all(tokens.map((token) => token.settled))
  }
}
