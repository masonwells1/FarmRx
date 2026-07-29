import assert from 'node:assert/strict'
import { parseAccessibleFarmEpochs, parseRemovedFarmEpoch } from './farmContext'

const farm = (id: string, name: string) => ({
  id,
  name,
  share_with_rep: false,
  created_by: '00000000-0000-4000-8000-000000000001',
  created_at: '2027-08-04T19:00:00.000Z',
  updated_at: '2027-08-04T19:00:00.000Z',
})
const farmA = farm('00000000-0000-4000-8000-000000000011', 'Pine Hill')
const farmB = farm('00000000-0000-4000-8000-000000000022', 'Other Farm')

assert.deepEqual(
  parseAccessibleFarmEpochs([
    { farm_id: farmA.id, access_epoch: '2' },
    { farm_id: farmB.id, access_epoch: 7 },
  ], [farmA, farmB]),
  { [farmA.id]: 2, [farmB.id]: 7 },
)
assert.throws(
  () => parseAccessibleFarmEpochs([{ farm_id: farmA.id, access_epoch: 2 }], [farmA, farmB]),
  /did not match the accessible farms/,
)
assert.throws(
  () => parseAccessibleFarmEpochs([
    { farm_id: farmA.id, access_epoch: 2 },
    { farm_id: farmA.id, access_epoch: 2 },
  ], [farmA]),
  /malformed/,
)
assert.throws(
  () => parseAccessibleFarmEpochs([{ farm_id: farmB.id, access_epoch: 2 }], [farmA]),
  /malformed/,
)

assert.equal(parseRemovedFarmEpoch([{ farm_id: farmA.id, access_epoch: '2' }], farmA.id), 2)
assert.equal(parseRemovedFarmEpoch([], farmA.id), null)
assert.throws(
  () => parseRemovedFarmEpoch([
    { farm_id: farmA.id, access_epoch: 2 },
    { farm_id: farmA.id, access_epoch: 2 },
  ], farmA.id),
  /malformed/,
)
assert.throws(
  () => parseRemovedFarmEpoch([{ farm_id: farmB.id, access_epoch: 2 }], farmA.id),
  /malformed/,
)
assert.throws(
  () => parseRemovedFarmEpoch([{ farm_id: farmA.id, access_epoch: 2, user_id: 'unexpected' }], farmA.id),
  /malformed/,
)
for (const invalidEpoch of [0, -1, 1.5, Number.NaN, '0', 'not-an-epoch']) {
  assert.throws(
    () => parseRemovedFarmEpoch([{ farm_id: farmA.id, access_epoch: invalidEpoch }], farmA.id),
    /malformed/,
  )
}

console.log('REMOVED_FARM_EPOCH_PARSER_REGRESSION_PASS')
