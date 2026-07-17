import type { StorageLike } from './writeQueue'

export const maximumClockSkewMs = 5 * 60 * 1_000

type ClockStorage = Pick<StorageLike, 'getItem' | 'setItem' | 'removeItem'>
type DeviceClockScope = { projectRef: string; userId: string }
type StoredDeviceClock = DeviceClockScope & { version: 1; highWaterAt: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projectRef = /^[a-z0-9][a-z0-9-]{2,79}$/i
const blocked = 'This device clock moved backwards. Correct the date and time, then reconnect to verify farm access.'

export class DeviceClockRollbackError extends Error {
  constructor() { super(blocked); this.name = 'DeviceClockRollbackError' }
}

export function deviceClockHighWaterKey(scope: DeviceClockScope) {
  return `farm-rx-device-clock:v1:${scope.projectRef}:${scope.userId}`
}

function checkedScope(scope: DeviceClockScope) {
  if (!projectRef.test(scope.projectRef) || !uuid.test(scope.userId)) throw new DeviceClockRollbackError()
  return scope
}

function parsedHighWater(storage: Pick<ClockStorage, 'getItem'>, scope: DeviceClockScope): number | null {
  checkedScope(scope)
  const raw = storage.getItem(deviceClockHighWaterKey(scope))
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredDeviceClock>
    const highWaterMs = Date.parse(String(value.highWaterAt ?? ''))
    if (value.version !== 1 || value.projectRef !== scope.projectRef || value.userId !== scope.userId || !Number.isFinite(highWaterMs)) throw new Error()
    return highWaterMs
  } catch { throw new DeviceClockRollbackError() }
}

/** Read-only clock verification for pure snapshot paths. */
export function verifyObservedDeviceTime(storage: Pick<ClockStorage, 'getItem'>, scope: DeviceClockScope, observedAt: string, memoryHighWaterMs: number | null = null): number {
  const observedMs = Date.parse(observedAt)
  if (!Number.isFinite(observedMs) || memoryHighWaterMs !== null && !Number.isFinite(memoryHighWaterMs)) throw new DeviceClockRollbackError()
  const storedHighWaterMs = parsedHighWater(storage, scope)
  const priorHighWaterMs = Math.max(storedHighWaterMs ?? observedMs, memoryHighWaterMs ?? observedMs)
  if (observedMs < priorHighWaterMs - maximumClockSkewMs) throw new DeviceClockRollbackError()
  return Math.max(observedMs, priorHighWaterMs)
}

/** Authorization paths persist the highest observed time; snapshot paths only read it. */
export function observeDeviceTime(storage: ClockStorage, scope: DeviceClockScope, observedAt: string): number {
  const prior = parsedHighWater(storage, scope)
  const highWaterMs = verifyObservedDeviceTime(storage, scope, observedAt, prior)
  if (prior === null || highWaterMs > prior) {
    const key = deviceClockHighWaterKey(scope)
    const bytes = JSON.stringify({ version: 1, ...scope, highWaterAt: new Date(highWaterMs).toISOString() } satisfies StoredDeviceClock)
    storage.setItem(key, bytes)
    if (storage.getItem(key) !== bytes) throw new DeviceClockRollbackError()
  }
  return highWaterMs
}

export function clearDeviceClockHighWater(storage: Pick<ClockStorage, 'removeItem'>, scope: DeviceClockScope) {
  checkedScope(scope)
  storage.removeItem(deviceClockHighWaterKey(scope))
}
