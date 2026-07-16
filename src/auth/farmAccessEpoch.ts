export type FarmAccessEpochMap = Readonly<Record<string, number>>

type StoredEpochs = { version: 1; userId: string; epochs: Record<string, number>; validatedAt: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projectRefPattern = /^[a-z0-9]{8,40}$/

export function farmAccessEpochsKey(projectRef: string, userId: string) {
  return `farm-rx-server-access-epochs:v1:${projectRef}:${userId}`
}

export function farmActiveContextKey(projectRef: string) {
  return `farm-rx-active-context:v1:${projectRef}`
}

function parse(raw: string | null, userId: string): StoredEpochs | null {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredEpochs>
    if (value.version !== 1 || value.userId !== userId || !value.epochs || typeof value.epochs !== 'object' || Array.isArray(value.epochs) || typeof value.validatedAt !== 'string' || Number.isNaN(Date.parse(value.validatedAt))) return null
    const entries = Object.entries(value.epochs)
    if (entries.length > 100 || entries.some(([farmId, epoch]) => !uuid.test(farmId) || !Number.isSafeInteger(epoch) || epoch < 1)) return null
    return { version: 1, userId, epochs: Object.fromEntries(entries), validatedAt: value.validatedAt }
  } catch { return null }
}

export function readFarmAccessEpochs(storage: Pick<Storage, 'getItem'>, projectRef: string, userId: string): FarmAccessEpochMap | null {
  return parse(storage.getItem(farmAccessEpochsKey(projectRef, userId)), userId)?.epochs ?? null
}

export function writeFarmAccessEpochs(storage: Pick<Storage, 'getItem' | 'setItem'>, projectRef: string, userId: string, epochs: FarmAccessEpochMap, validatedAt = new Date().toISOString()) {
  if (!projectRefPattern.test(projectRef) || !uuid.test(userId) || Number.isNaN(Date.parse(validatedAt))) throw new Error('Farm Rx could not verify the farm access version.')
  const entries = Object.entries(epochs)
  if (entries.length > 100 || entries.some(([farmId, epoch]) => !uuid.test(farmId) || !Number.isSafeInteger(epoch) || epoch < 1)) throw new Error('Farm Rx could not verify the farm access version.')
  const key = farmAccessEpochsKey(projectRef, userId)
  const bytes = JSON.stringify({ version: 1, userId, epochs: Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))), validatedAt } satisfies StoredEpochs)
  storage.setItem(key, bytes)
  if (storage.getItem(key) !== bytes) throw new Error('Farm Rx could not retain the farm access version.')
}

export function clearFarmAccessEpochs(storage: Pick<Storage, 'removeItem'>, projectRef: string, userId: string) {
  storage.removeItem(farmAccessEpochsKey(projectRef, userId))
}

/** Read only the selected account's epoch map for PostgREST/storage writes. */
export function farmAccessEpochRequestHeader(storage: Pick<Storage, 'getItem'>, projectRef: string): string | null {
  const activeRaw = storage.getItem(farmActiveContextKey(projectRef))
  if (!activeRaw) return null
  try {
    const active = JSON.parse(activeRaw) as { version?: unknown; userId?: unknown }
    if (active.version !== 1 || typeof active.userId !== 'string' || !uuid.test(active.userId)) return null
    const epochs = readFarmAccessEpochs(storage, projectRef, active.userId)
    return epochs ? JSON.stringify(epochs) : null
  } catch { return null }
}
