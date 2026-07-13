import { createSubmitLock, withLock } from '../lib/submitLock'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let syncCalls = 0
const syncLock = createSubmitLock()
withLock(syncLock, () => {
  syncCalls += 1
  withLock(syncLock, () => { syncCalls += 1 })
})
assert(syncCalls === 1, 'a re-entrant synchronous call must not run')

let resolveFirst: (() => void) | undefined
let asyncCalls = 0
const asyncLock = createSubmitLock()
const first = withLock(asyncLock, async () => {
  asyncCalls += 1
  await new Promise<void>((resolve) => { resolveFirst = resolve })
})
const duplicate = withLock(asyncLock, async () => { asyncCalls += 1 })
assert(asyncCalls === 1, 'a second async call while pending must not run')
assert(duplicate === undefined, 'a blocked call must return early')
assert(resolveFirst, 'the pending operation must expose its resolver')
resolveFirst()
await first

const rejectionLock = createSubmitLock()
try {
  await withLock(rejectionLock, async () => { throw new Error('expected rejection') })
} catch { /* expected */ }
let afterRejectionCalls = 0
await withLock(rejectionLock, async () => { afterRejectionCalls += 1 })
assert(afterRejectionCalls === 1, 'the lock must release after an async rejection')

const throwLock = createSubmitLock()
try {
  withLock(throwLock, () => { throw new Error('expected synchronous throw') })
} catch { /* expected */ }
let afterThrowCalls = 0
withLock(throwLock, () => { afterThrowCalls += 1 })
assert(afterThrowCalls === 1, 'the lock must release after a synchronous throw')

let sequentialCalls = 0
const sequentialLock = createSubmitLock()
await withLock(sequentialLock, async () => { sequentialCalls += 1 })
await withLock(sequentialLock, async () => { sequentialCalls += 1 })
assert(sequentialCalls === 2, 'sequential async calls after settlement should both run')

console.log('submitLock regression passed')
