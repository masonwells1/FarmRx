/** In-memory record of settings saves that are in flight or waiting behind one.
 * The farm switcher asks `hasPendingFarmWork`, which consults this, so a farmer is
 * warned before leaving a farm whose carry edits have not reached the server yet.
 * Keyed by farm only: one page session serves one signed-in user. */
const pending = new Map<string, number>()

export function beginPendingSettingsWork(farmId: string): () => void {
  pending.set(farmId, (pending.get(farmId) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const next = (pending.get(farmId) ?? 1) - 1
    if (next <= 0) pending.delete(farmId); else pending.set(farmId, next)
  }
}

export function hasPendingSettingsWork(farmId: string): boolean { return (pending.get(farmId) ?? 0) > 0 }
