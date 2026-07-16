import { farmerError } from '../lib/farmerErrors'
import { sameOptimisticWrite, StaleWriteConflictError } from './optimisticSave'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

const canonical = { id: 'record', farm_id: 'farm', name: 'North 80', nested: { b: 2, a: 1 }, updated_at: 'server-only', created_at: 'server-only' }
assert(sameOptimisticWrite(canonical, { id: 'record', farm_id: 'farm', name: 'North 80', nested: { a: 1, b: 2 } }), 'Canonical server audit columns or object key order caused a false conflict.')
assert(!sameOptimisticWrite(canonical, { id: 'record', farm_id: 'farm', name: 'South 40' }), 'A different mutable value was mistaken for an idempotent lost-response retry.')

const conflict = new StaleWriteConflictError()
assert(conflict.code === 'FARM_RX_STALE_WRITE' && conflict.status === 409, 'Stale writes do not expose the stable conflict contract.')
assert(farmerError(conflict, 'save this record') === 'This record changed in another tab or device. Reload before saving again.', 'The stable conflict leaked a technical error or generic retry message to the farmer.')

console.log('Optimistic-save regression checks passed (3 groups).')
