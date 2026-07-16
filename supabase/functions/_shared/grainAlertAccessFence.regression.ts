import { parseExpectedGrainAlertAccess, runWithRetainedExpectedOwnerAccess } from './grainAlertAccessFence'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const userId = uid(1); const farmId = uid(2)
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const headers = new Headers({ 'x-farm-rx-expected-user-id': userId, 'x-farm-rx-access-epochs': JSON.stringify({ [farmId]: 9 }) })
assert(parseExpectedGrainAlertAccess(headers, userId, farmId)?.accessEpoch === 9, 'A valid exact user/epoch header pair must parse.')
assert(parseExpectedGrainAlertAccess(headers, uid(3), farmId) === null, 'A header for another authenticated user must fail closed.')
assert(parseExpectedGrainAlertAccess(new Headers({ 'x-farm-rx-expected-user-id': userId, 'x-farm-rx-access-epochs': JSON.stringify({ [farmId]: 0 }) }), userId, farmId) === null, 'A missing/non-positive access epoch must fail closed.')

let providerCalls = 0
const denied = await runWithRetainedExpectedOwnerAccess(async () => false, async () => { providerCalls += 1; return 'sent' })
assert(!denied.allowed && providerCalls === 0, 'Revocation immediately before the provider boundary must prevent the email request.')
const allowed = await runWithRetainedExpectedOwnerAccess(async () => true, async () => { providerCalls += 1; return 'sent' })
assert(allowed.allowed && allowed.value === 'sent' && providerCalls === 1, 'Retained owner access must allow exactly one provider request.')

console.log('Grain alert Edge access-fence regression passed (header binding and final provider guard).')
