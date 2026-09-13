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
      // A failed save surfaces as soon as its token settles, even while other tokens (or a retained draft's hold) are still open.
      const outcome = await Promise.race([Promise.all(tokens.map((token) => token.settled.then(() => { if (token.failure !== undefined) throw new Error(SETTINGS_SAVE_FAILED) }))).then(() => 'settled' as const), timedOut])
      if (outcome === 'timeout') throw new Error(SETTINGS_SAVE_STILL_RUNNING)
    }
    throw new Error(SETTINGS_SAVE_STILL_RUNNING)
  } finally { clearTimeout(timer) }
}

/** Drafts whose save failed after their screen was left. The screen is gone, so the draft is kept here with a retry:
 * the farm stays pending, a confirmed farm switch retries it through the flush (and is refused if that fails too),
 * and the next mount of the screen takes the draft back (`takeRetainedSettingsDrafts`) to show it dirty and pending. */
export type RetainedSettingsDraft = { payload: unknown; retry: () => Promise<void> }
const retainedDrafts = new Map<string, Map<string, RetainedSettingsDraft>>()
const retainedHolds = new Map<string, { release: () => void; unregister: () => void }>()

export function retainFailedSettingsDraft(farmId: string, key: string, draft: RetainedSettingsDraft): void {
  const drafts = retainedDrafts.get(farmId) ?? new Map<string, RetainedSettingsDraft>()
  drafts.set(key, draft); retainedDrafts.set(farmId, drafts)
  if (!retainedHolds.has(farmId)) retainedHolds.set(farmId, { release: beginPendingSettingsWork(farmId), unregister: registerPendingSettingsFlush(farmId, () => retryRetainedDrafts(farmId)) })
}

function dropRetainedDraft(farmId: string, key: string): void {
  const drafts = retainedDrafts.get(farmId); if (!drafts) return
  drafts.delete(key)
  if (drafts.size === 0) { retainedDrafts.delete(farmId); const hold = retainedHolds.get(farmId); retainedHolds.delete(farmId); hold?.unregister(); hold?.release() }
}

function retryRetainedDrafts(farmId: string): void {
  for (const [key, draft] of [...(retainedDrafts.get(farmId) ?? [])]) {
    const done = beginPendingSettingsWork(farmId)
    draft.retry().then(() => { dropRetainedDraft(farmId, key); done() }, (error: unknown) => done(error ?? new Error('Retained settings draft could not be saved.')))
  }
}

export function hasRetainedSettingsDrafts(farmId: string): boolean { return (retainedDrafts.get(farmId)?.size ?? 0) > 0 }

/** Removes and returns the retained drafts whose key starts with `prefix`; releases the hold once none remain. */
export function takeRetainedSettingsDrafts(farmId: string, prefix: string): Map<string, unknown> {
  const taken = new Map<string, unknown>()
  for (const [key, draft] of [...(retainedDrafts.get(farmId) ?? [])]) if (key.startsWith(prefix)) { taken.set(key, draft.payload); dropRetainedDraft(farmId, key) }
  return taken
}
