export interface SubmitLock {
  acquire(): boolean
  release(): void
  readonly locked: boolean
}

export interface SubmitLockMap {
  get(key: string): SubmitLock
}

export function createSubmitLock(): SubmitLock {
  let locked = false
  return {
    acquire() {
      if (locked) return false
      locked = true
      return true
    },
    release() { locked = false },
    get locked() { return locked },
  }
}

export function createSubmitLockMap(): SubmitLockMap {
  const locks = new Map<string, SubmitLock>()
  return {
    get(key) {
      let lock = locks.get(key)
      if (!lock) {
        lock = createSubmitLock()
        locks.set(key, lock)
      }
      return lock
    },
  }
}

export function withLock<T>(lock: SubmitLock, fn: () => T): T | undefined {
  if (!lock.acquire()) return undefined
  try {
    const result = fn()
    if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
      return Promise.resolve(result).finally(() => lock.release()) as T
    }
    lock.release()
    return result
  } catch (error) {
    lock.release()
    throw error
  }
}
