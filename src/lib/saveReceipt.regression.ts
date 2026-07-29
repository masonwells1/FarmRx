function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const nativeSetTimeout = globalThis.setTimeout
const scheduled: Array<() => void> = []
Object.defineProperty(globalThis, 'setTimeout', { configurable: true, writable: true, value: ((callback: () => void) => { scheduled.push(callback); return scheduled.length }) as unknown as typeof setTimeout })

try {
  const { getSaveReceipt, setSaveReceipt } = await import('./saveReceipt')
  const id = 'save-receipt-stale-timer-regression'
  setSaveReceipt(id, 'saved')
  setSaveReceipt(id, 'saved')
  assert(scheduled.length === 2, 'Each Saved publication must schedule its own expiry callback.')
  scheduled[0]!()
  assert(getSaveReceipt(id) === 'saved', 'An older Saved expiry must not clear a newer Saved publication for the same record.')
  scheduled[1]!()
  assert(getSaveReceipt(id) === null, 'The current Saved expiry must clear its own publication.')
  console.log('Save receipt stale-timer regression passed.')
} finally {
  Object.defineProperty(globalThis, 'setTimeout', { configurable: true, writable: true, value: nativeSetTimeout })
}
